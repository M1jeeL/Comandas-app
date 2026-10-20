import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateOrderDto } from './dto/create-order.dto.js';
import { AddOrderItemDto } from './dto/add-order-item.dto.js';
import {
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PreparationTicketStatus,
  Role,
} from '../../generated/prisma/enums.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { UpdateOrderItemDto } from './dto/update-order-item.dto.js';
import { RequestItemCancellationDto } from './dto/request-item-cancellation.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Verifica que la ubicación pertenezca
   * al negocio del usuario autenticado.
   */
  private async validateLocation(locationId: string, businessId: string) {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        businessId,
        status: 'ACTIVE',
      },
    });

    if (!location) {
      throw new ForbiddenException(
        'La ubicación no pertenece a tu negocio o no está activa',
      );
    }

    return location;
  }

  /**
   * Verifica que la TableSession pertenezca
   * al negocio y ubicación correctos.
   */
  private async validateTableSession(
    tableSessionId: string,
    locationId: string,
    businessId: string,
  ) {
    const session = await this.prisma.tableSession.findFirst({
      where: {
        id: tableSessionId,
        status: 'OPEN',
        table: {
          locationId,
          location: {
            businessId,
          },
        },
      },
    });

    if (!session) {
      throw new BadRequestException(
        'La sesión de mesa no existe, está cerrada o no pertenece a esta ubicación',
      );
    }

    return session;
  }

  /**
   * Valida que un waiterId corresponda al usuario autenticado.
   *
   * Por ahora solamente permitimos que el usuario autenticado
   * se asigne a sí mismo como mesero.
   *
   * La asignación administrativa de un mesero distinto se
   * habilitará posteriormente mediante las reglas de roles.
   */
  private validateWaiterAssignment(
    waiterId: string | undefined,
    user: JwtUser,
  ) {
    if (!waiterId) {
      return;
    }

    if (waiterId !== user.userId) {
      throw new ForbiddenException(
        'No puedes asignar otro mesero a este pedido',
      );
    }
  }

  private validateStatusTransition(
    currentStatus: OrderStatus,
    newStatus: OrderStatus,
  ) {
    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.DRAFT]: [OrderStatus.SENT, OrderStatus.CANCELLED],

      [OrderStatus.SENT]: [OrderStatus.IN_PROGRESS, OrderStatus.CANCELLED],

      [OrderStatus.IN_PROGRESS]: [OrderStatus.READY, OrderStatus.CANCELLED],

      [OrderStatus.READY]: [OrderStatus.DELIVERED],

      [OrderStatus.DELIVERED]: [OrderStatus.CLOSED],

      [OrderStatus.CLOSED]: [],

      [OrderStatus.CANCELLED]: [],
    };

    const allowed = allowedTransitions[currentStatus];

    if (!allowed.includes(newStatus)) {
      throw new ConflictException(
        `No se puede cambiar el pedido de ${currentStatus} a ${newStatus}`,
      );
    }
  }

  private assertWaiterOwnsOrder(user: JwtUser, waiterId: string | null) {
    if (user.role === Role.WAITER && waiterId !== user.userId) {
      throw new ForbiddenException('Solo el mesero asignado puede operar este pedido');
    }
    if (
      user.role !== Role.OWNER &&
      user.role !== Role.ADMIN &&
      user.role !== Role.MANAGER &&
      user.role !== Role.WAITER
    ) {
      throw new ForbiddenException('Tu rol no puede operar pedidos de mesa');
    }
  }

  async dispatchForPrinting(user: JwtUser, orderId: string, reprint = false) {
    return serializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, location: { businessId: user.businessId } },
        include: {
          waiter: { select: { firstName: true, lastName: true } },
          tableSession: { include: { table: { select: { name: true } } } },
          billOrders: { select: { billId: true } },
        },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      this.assertWaiterOwnsOrder(user, order.waiterId);
      if (order.billOrders.length > 0 || ['CLOSED', 'CANCELLED'].includes(order.status)) {
        throw new ConflictException('El pedido ya no admite nuevos envíos a cocina');
      }

      const pendingItems = await tx.orderItem.findMany({
        where: {
          orderId,
          status: reprint ? OrderItemStatus.SENT : OrderItemStatus.PENDING,
          cancellationStatus: { notIn: ['PENDING', 'APPROVED'] },
        },
        include: {
          modifiers: true,
          product: {
            include: {
              productWorkstations: { include: { workstation: true } },
            },
          },
        },
      });
      if (pendingItems.length === 0) {
        throw new ConflictException(
          reprint ? 'No hay productos pendientes de entrega para reimprimir' : 'No hay productos nuevos para imprimir',
        );
      }

      const grouped = new Map<string, {
        workstationId: string;
        workstationName: string;
        items: Array<{
          id: string;
          productName: string;
          quantity: string;
          notes: string | null;
          modifiers: string[];
        }>;
      }>();
      for (const item of pendingItems) {
        const assignment = item.product.productWorkstations[0];
        if (
          item.product.productWorkstations.length !== 1 ||
          !assignment ||
          assignment.workstation.locationId !== order.locationId ||
          assignment.workstation.status !== 'ACTIVE'
        ) {
          throw new ConflictException(
            `El producto «${item.productNameSnapshot}» no tiene una estación activa válida`,
          );
        }
        if (!grouped.has(assignment.workstationId)) {
          grouped.set(assignment.workstationId, {
            workstationId: assignment.workstationId,
            workstationName: assignment.workstation.name,
            items: [],
          });
        }
        grouped.get(assignment.workstationId)!.items.push({
          id: item.id,
          productName: item.productNameSnapshot,
          quantity: item.quantity.toString(),
          notes: item.notes,
          modifiers: item.modifiers.map((modifier) => modifier.nameSnapshot),
        });
      }

      if (!reprint) {
        const changed = await tx.orderItem.updateMany({
          where: { id: { in: pendingItems.map((item) => item.id) }, status: OrderItemStatus.PENDING },
          data: { status: OrderItemStatus.SENT },
        });
        if (changed.count !== pendingItems.length) {
          throw new ConflictException('Los productos cambiaron; actualiza el pedido e inténtalo nuevamente');
        }
        await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.SENT } });
      }
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_SENT',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          source: reprint ? 'PAPER_REPRINT' : 'PAPER_PRINT',
          itemIds: pendingItems.map((item) => item.id),
          itemCount: pendingItems.length,
          stations: [...grouped.values()].map((station) => station.workstationName),
        },
      });

      return {
        orderCode: order.id.slice(-6).toUpperCase(),
        tableName: order.tableSession?.table.name ?? order.customerName ?? 'Para llevar',
        waiterName: order.waiter ? `${order.waiter.firstName} ${order.waiter.lastName}` : '',
        createdAt: new Date().toISOString(),
        stations: [...grouped.values()],
      };
    });
  }

  async markItemDelivered(user: JwtUser, orderId: string, itemId: string) {
    return serializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, location: { businessId: user.businessId } },
        include: { billOrders: { select: { billId: true } } },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      this.assertWaiterOwnsOrder(user, order.waiterId);
      if (order.billOrders.length > 0 || ['CLOSED', 'CANCELLED'].includes(order.status)) {
        throw new ConflictException('El pedido ya está cerrado para cambios');
      }
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId, status: OrderItemStatus.SENT },
      });
      if (!item) throw new ConflictException('El producto no está pendiente de entrega');
      const updatedItem = await tx.orderItem.updateMany({
        where: { id: itemId, status: OrderItemStatus.SENT },
        data: { status: OrderItemStatus.DELIVERED },
      });
      if (updatedItem.count !== 1) throw new ConflictException('El producto cambió; actualiza el pedido');

      const remaining = await tx.orderItem.findMany({
        where: { orderId, status: { not: OrderItemStatus.CANCELLED } },
        select: { status: true },
      });
      const hasUndispatched = remaining.some((candidate) => candidate.status === OrderItemStatus.PENDING);
      const hasSent = remaining.some((candidate) => candidate.status === OrderItemStatus.SENT);
      const nextOrderStatus = hasSent
        ? OrderStatus.SENT
        : hasUndispatched
          ? OrderStatus.DRAFT
          : OrderStatus.DELIVERED;
      await tx.order.update({ where: { id: orderId }, data: { status: nextOrderStatus } });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_ITEM_UPDATED',
        entityType: 'OrderItem',
        entityId: itemId,
        metadata: { orderId, event: 'ITEM_DELIVERED', from: 'SENT', to: 'DELIVERED' },
      });
      return { itemId, orderStatus: nextOrderStatus };
    });
  }

  async addItem(user: JwtUser, orderId: string, dto: AddOrderItemDto) {
    // 1. Buscar la orden y comprobar que pertenece
    //    al business del usuario.
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (order.status === OrderStatus.CLOSED || order.status === OrderStatus.CANCELLED) {
      throw new ConflictException(
        'No se pueden agregar productos a un pedido cerrado o cancelado',
      );
    }
    this.assertWaiterOwnsOrder(user, order.waiterId);
    if (order.type !== OrderType.DINE_IN && order.status !== OrderStatus.DRAFT) {
      throw new ConflictException('Solo se pueden agregar productos a un pedido para llevar en borrador');
    }
    if (order.tableSessionId) {
      const session = await this.prisma.tableSession.findFirst({
        where: { id: order.tableSessionId, status: 'OPEN' },
      });
      if (!session) throw new ConflictException('La sesión de mesa ya no está abierta');
      const existingBill = await this.prisma.billOrder.findFirst({
        where: { orderId: order.id },
      });
      if (existingBill) throw new ConflictException('La cuenta ya fue solicitada; no se pueden agregar más productos');
    }

    // 3. Buscar el producto dentro de la misma ubicación.
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        locationId: order.locationId,
        status: 'ACTIVE',
      },
    });

    if (!product) {
      throw new BadRequestException(
        'El producto no existe, no está activo o no pertenece a esta ubicación',
      );
    }

    // 4. Buscar modifiers si fueron enviados.
    const modifierIds = dto.modifierIds ?? [];

    const modifiers = modifierIds.length
      ? await this.prisma.modifier.findMany({
          where: {
            id: {
              in: modifierIds,
            },
            productId: product.id,
            active: true,
          },
        })
      : [];

    // 5. Comprobar que encontramos todos los modifiers.
    if (modifiers.length !== modifierIds.length) {
      throw new BadRequestException(
        'Uno o más modifiers no existen, no están activos o no pertenecen al producto',
      );
    }

    // 6. Crear OrderItem + snapshots de modifiers
    //    dentro de una transacción.
    return serializableTransaction(this.prisma, async (tx) => {
      if (order.tableSessionId) {
        await tx.$queryRaw`SELECT "id" FROM "TableSession" WHERE "id" = ${order.tableSessionId} FOR UPDATE`;
        const activeSession = await tx.tableSession.findFirst({
          where: { id: order.tableSessionId, status: 'OPEN' },
        });
        if (!activeSession) throw new ConflictException('La sesión de mesa ya no está abierta');
        const existingBill = await tx.billOrder.findFirst({ where: { orderId: order.id } });
        if (existingBill) throw new ConflictException('La cuenta ya fue solicitada; no se pueden agregar más productos');
      }
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,

          productId: product.id,

          // Snapshot del producto.
          productNameSnapshot: product.name,
          unitPrice: product.price,

          quantity: dto.quantity,

          notes: dto.notes?.trim(),

          status: OrderItemStatus.PENDING,

          modifiers: {
            create: modifiers.map((modifier) => ({
              modifierId: modifier.id,
              nameSnapshot: modifier.name,
              priceDelta: modifier.priceDelta,
            })),
          },
        },

        include: {
          modifiers: true,
          product: true,
        },
      });

      const dispatchedItems = await tx.orderItem.count({
        where: { orderId: order.id, status: OrderItemStatus.SENT },
      });
      if (order.status === OrderStatus.DELIVERED) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: dispatchedItems > 0 ? OrderStatus.SENT : OrderStatus.DRAFT },
        });
      }
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_ITEM_ADDED',
        entityType: 'OrderItem',
        entityId: orderItem.id,
        metadata: { orderId: order.id, productId: product.id, quantity: dto.quantity },
      });

      return orderItem;
    });
  }

  async updateItem(
    user: JwtUser,
    orderId: string,
    itemId: string,
    dto: UpdateOrderItemDto,
  ) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId: order.id },
    });
    if (!item) throw new NotFoundException('Item no encontrado en este pedido');

    if (item.status !== OrderItemStatus.PENDING || ['CLOSED', 'CANCELLED'].includes(order.status)) {
      throw new ConflictException(
        'Solo se pueden editar productos pendientes de impresión en un pedido abierto',
      );
    }

    if (!item.productId) {
      throw new ConflictException('Este item no corresponde a un producto');
    }

    const modifierIds = dto.modifierIds;

    // Si no enviamos modifierIds, mantenemos los actuales.
    if (modifierIds === undefined) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.orderItem.update({
          where: { id: item.id },
          data: {
            ...(dto.quantity !== undefined && { quantity: dto.quantity }),
            ...(dto.notes !== undefined && { notes: dto.notes.trim() || null }),
          },
          include: { modifiers: true, product: true },
        });
        await this.audit.record(tx, {
          businessId: user.businessId,
          locationId: order.locationId,
          userId: user.userId,
          action: 'ORDER_ITEM_UPDATED',
          entityType: 'OrderItem',
          entityId: item.id,
          metadata: {
            orderId: order.id,
            source: 'DRAFT',
            before: { quantity: item.quantity, notes: item.notes },
            after: { quantity: updated.quantity, notes: updated.notes },
          },
        });
        return updated;
      });
    }

    // Validar modifiers nuevos.
    const modifiers = modifierIds.length
      ? await this.prisma.modifier.findMany({
          where: {
            id: {
              in: modifierIds,
            },
            productId: item.productId,
            active: true,
          },
        })
      : [];

    if (modifiers.length !== modifierIds.length) {
      throw new BadRequestException(
        'Uno o más modifiers no existen, no están activos o no pertenecen al producto',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Eliminamos los modifiers actuales.
      await tx.orderItemModifier.deleteMany({
        where: {
          orderItemId: item.id,
        },
      });

      // Actualizamos el item y recreamos sus modifiers.
      const updated = await tx.orderItem.update({
        where: {
          id: item.id,
        },

        data: {
          ...(dto.quantity !== undefined && {
            quantity: dto.quantity,
          }),

          ...(dto.notes !== undefined && {
            notes: dto.notes.trim() || null,
          }),

          modifiers: {
            create: modifiers.map((modifier) => ({
              modifierId: modifier.id,
              nameSnapshot: modifier.name,
              priceDelta: modifier.priceDelta,
            })),
          },
        },

        include: {
          modifiers: true,
          product: true,
        },
      });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_ITEM_UPDATED',
        entityType: 'OrderItem',
        entityId: item.id,
        metadata: {
          orderId: order.id,
          source: 'DRAFT',
          before: { quantity: item.quantity, notes: item.notes },
          after: {
            quantity: updated.quantity,
            notes: updated.notes,
            modifierIds,
          },
        },
      });
      return updated;
    });
  }

  async removeItem(user: JwtUser, orderId: string, itemId: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id: orderId,
        location: {
          businessId: user.businessId,
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const item = await this.prisma.orderItem.findFirst({
      where: {
        id: itemId,
        orderId: order.id,
      },
    });

    if (!item) {
      throw new NotFoundException('Item no encontrado en este pedido');
    }
    if (
      item.status !== OrderItemStatus.PENDING ||
      ['CLOSED', 'CANCELLED'].includes(order.status)
    ) {
      throw new ConflictException(
        'Solo se pueden quitar productos que aún no se hayan impreso',
      );
    }
    this.assertWaiterOwnsOrder(user, order.waiterId);
    if (await this.prisma.billOrder.findFirst({ where: { orderId: order.id } })) {
      throw new ConflictException('La cuenta ya fue solicitada; no se pueden quitar productos');
    }

    return this.prisma.$transaction(async (tx) => {
      const cancelled = await tx.orderItem.update({
        where: { id: item.id },
        data: { status: OrderItemStatus.CANCELLED },
        include: { modifiers: true, product: true },
      });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_ITEM_CANCELLED',
        entityType: 'OrderItem',
        entityId: item.id,
        metadata: {
          orderId: order.id,
          source: 'DRAFT',
          quantity: item.quantity,
        },
      });
      return cancelled;
    });
  }

  async requestItemCancellation(
    user: JwtUser,
    orderId: string,
    itemId: string,
    dto: RequestItemCancellationDto,
  ) {
    return serializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          location: { businessId: user.businessId },
          billOrders: { none: {} },
        },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      this.assertWaiterOwnsOrder(user, order.waiterId);
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId },
      });
      if (!item)
        throw new NotFoundException('Ítem no encontrado en este pedido');
      if (item.status === OrderItemStatus.CANCELLED)
        throw new ConflictException('El ítem ya está cancelado');
      if (item.status === OrderItemStatus.DELIVERED) {
        throw new ConflictException('No se puede cancelar un producto que ya fue entregado');
      }
      const now = new Date();
      const updated = await tx.orderItem.update({
        where: { id: item.id },
        data: {
          status: OrderItemStatus.CANCELLED,
          cancellationStatus: 'APPROVED',
          cancellationReason: dto.reason.trim(),
          cancellationRequestedAt: now,
          cancellationRequestedBy: user.userId,
          cancellationResolvedAt: now,
          cancellationResolvedBy: user.userId,
        },
        include: { modifiers: true },
      });
      const remaining = await tx.orderItem.findMany({
        where: { orderId, status: { not: OrderItemStatus.CANCELLED } },
        select: { status: true },
      });
      const hasPending = remaining.some(({ status }) => status === OrderItemStatus.PENDING);
      const hasSent = remaining.some(({ status }) => status === OrderItemStatus.SENT);
      const nextStatus = remaining.length === 0
        ? OrderStatus.CANCELLED
        : hasSent
          ? OrderStatus.SENT
          : hasPending
            ? OrderStatus.DRAFT
            : OrderStatus.DELIVERED;
      await tx.order.update({ where: { id: orderId }, data: { status: nextStatus } });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_ITEM_CANCELLED',
        entityType: 'OrderItem',
        entityId: item.id,
        metadata: {
          orderId,
          event: 'CANCELLED_BY_WAITER',
          reason: dto.reason.trim(),
          quantity: item.quantity,
          previousStatus: item.status,
          orderStatus: nextStatus,
        },
      });
      return updated;
    });
  }

  /**
   * Crear Order.
   *
   * createdBy:
   *   Siempre corresponde al usuario autenticado.
   *
   * waiterId:
   *   - DINE_IN -> obligatorio.
   *   - TAKEAWAY -> opcional.
   *
   * Esto permite distinguir:
   *
   *   TAKEAWAY de mesero:
   *     createdBy = mesero
   *     waiterId  = mesero
   *
   *   TAKEAWAY directo de caja:
   *     createdBy = cajero
   *     waiterId  = null
   */
  async create(user: JwtUser, dto: CreateOrderDto) {
    // --------------------------------------------------
    // 1. Validar ubicación
    // --------------------------------------------------

    await this.validateLocation(dto.locationId, user.businessId);

    // --------------------------------------------------
    // 2. Validar reglas según tipo de pedido
    // --------------------------------------------------

    if (dto.type === OrderType.DINE_IN) {
      if (!dto.tableSessionId) {
        throw new BadRequestException(
          'Un pedido DINE_IN requiere tableSessionId',
        );
      }

      if (!dto.waiterId) {
        throw new BadRequestException('Un pedido DINE_IN requiere waiterId');
      }
    }

    // --------------------------------------------------
    // 3. TAKEAWAY no puede utilizar una mesa
    // --------------------------------------------------

    if (dto.type === OrderType.TAKEAWAY && dto.tableSessionId) {
      throw new BadRequestException(
        'Un pedido TAKEAWAY no puede tener tableSessionId',
      );
    }

    // --------------------------------------------------
    // --------------------------------------------------
    // 5. Validar waiterId
    // --------------------------------------------------

    this.validateWaiterAssignment(dto.waiterId, user);

    // --------------------------------------------------
    // 6. Validar TableSession
    // --------------------------------------------------

    let tableSession:
      Awaited<ReturnType<typeof this.validateTableSession>> | undefined;

    if (dto.tableSessionId) {
      tableSession = await this.validateTableSession(
        dto.tableSessionId,
        dto.locationId,
        user.businessId,
      );

      // ------------------------------------------------
      // DINE_IN debe pertenecer al mesero de la sesión
      // ------------------------------------------------

      if (
        dto.type === OrderType.DINE_IN &&
        tableSession.waiterId !== dto.waiterId
      ) {
        throw new ForbiddenException(
          'El waiterId no corresponde al mesero asignado a esta mesa',
        );
      }
    }

    // --------------------------------------------------
    // 7. Crear Order
    // --------------------------------------------------

    return serializableTransaction(this.prisma, async (tx) => {
      if (tableSession) {
        await tx.$queryRaw`SELECT "id" FROM "TableSession" WHERE "id" = ${tableSession.id} FOR UPDATE`;
        const activeSession = await tx.tableSession.findFirst({
          where: { id: tableSession.id, status: 'OPEN' },
        });
        if (!activeSession) throw new ConflictException('La sesión de mesa ya no está abierta');
        const existingOrder = await tx.order.findFirst({
          where: {
            tableSessionId: activeSession.id,
            status: { notIn: [OrderStatus.CLOSED, OrderStatus.CANCELLED] },
          },
          orderBy: { updatedAt: 'desc' },
          include: { billOrders: true },
        });
        if (existingOrder) {
          if (existingOrder.billOrders.length > 0) {
            throw new ConflictException('Esta sesión ya tiene una cuenta solicitada; primero completa el cobro y cierra la mesa');
          }
          return existingOrder;
        }
      }
      const order = await tx.order.create({
        data: {
          locationId: dto.locationId,

          tableSessionId: dto.tableSessionId,

          // Usuario que realmente creó la orden.
          createdBy: user.userId,

          // Puede ser null para TAKEAWAY directo desde caja.
          waiterId: dto.waiterId,

          type: dto.type,

          status: OrderStatus.DRAFT,

          customerName: dto.customerName?.trim(),

          notes: dto.notes?.trim(),
        },
      });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_CREATED',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          type: order.type,
          status: order.status,
          tableSessionId: order.tableSessionId,
        },
      });
      return order;
    });
  }

  /**
   * Obtener pedidos de una ubicación.
   */
  async findAll(user: JwtUser, locationId: string) {
    await this.validateLocation(locationId, user.businessId);

    return this.prisma.order.findMany({
      where: {
        locationId,
        ...(user.role === Role.WAITER ? { waiterId: user.userId } : {}),
      },
      include: {
        tableSession: {
          include: {
            table: true,
          },
        },

        createdByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        waiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        items: { include: { modifiers: true } },
        billOrders: {
          include: {
            bill: {
              select: {
                id: true,
                status: true,
                total: true,
                payments: {
                  select: {
                    id: true,
                    method: true,
                    status: true,
                    amount: true,
                    cashHandover: { select: { id: true, status: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Obtener un pedido por ID.
   */
  async findOne(user: JwtUser, id: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        id,

        location: {
          businessId: user.businessId,
        },
      },

      include: {
        tableSession: {
          include: {
            table: true,
          },
        },

        createdByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        waiter: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },

        items: {
          include: {
            modifiers: true,
          },
        },
        billOrders: {
          include: {
            bill: {
              select: {
                id: true,
                status: true,
                total: true,
                payments: {
                  select: {
                    id: true,
                    method: true,
                    status: true,
                    amount: true,
                    cashHandover: { select: { id: true, status: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (user.role === Role.WAITER && order.waiterId !== user.userId) {
      throw new ForbiddenException('Solo puedes consultar pedidos de mesas asignadas a ti');
    }

    return order;
  }

  /**
   * Cancelar pedido.
   */
  async cancel(user: JwtUser, id: string) {
    return serializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, location: { businessId: user.businessId } },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      this.validateStatusTransition(order.status, OrderStatus.CANCELLED);
      if (user.role === Role.WAITER && order.waiterId !== user.userId) {
        throw new ForbiddenException(
          'Solo el mesero asignado puede operar este pedido',
        );
      }
      const itemsAlreadyDispatched = await tx.orderItem.count({
        where: {
          orderId: order.id,
          status: { in: [OrderItemStatus.SENT, OrderItemStatus.DELIVERED] },
        },
      });
      if (itemsAlreadyDispatched > 0) {
        throw new ConflictException(
          'Cancela individualmente los productos ya impresos; no se puede cancelar el pedido completo',
        );
      }
      const changed = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: OrderStatus.CANCELLED },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'El estado del pedido cambió por otra solicitud',
        );
      }
      await tx.orderItem.updateMany({
        where: { orderId: order.id, status: OrderItemStatus.PENDING },
        data: { status: OrderItemStatus.CANCELLED },
      });
      const activeTickets = await tx.preparationTicket.findMany({
        where: {
          orderId: order.id,
          status: {
            in: [
              PreparationTicketStatus.PENDING,
              PreparationTicketStatus.ACCEPTED,
              PreparationTicketStatus.IN_PROGRESS,
            ],
          },
        },
        select: { id: true, status: true },
      });
      if (activeTickets.length > 0) {
        const cancelledAt = new Date();
        await tx.preparationTicket.updateMany({
          where: {
            id: { in: activeTickets.map(({ id }) => id) },
            status: { in: activeTickets.map(({ status }) => status) },
          },
          data: { status: PreparationTicketStatus.CANCELLED, cancelledAt },
        });
        for (const ticket of activeTickets) {
          await this.audit.record(tx, {
            businessId: user.businessId,
            locationId: order.locationId,
            userId: user.userId,
            action: 'PREPARATION_TICKET_CANCELLED',
            entityType: 'PreparationTicket',
            entityId: ticket.id,
            metadata: {
              orderId: order.id,
              from: ticket.status,
              to: PreparationTicketStatus.CANCELLED,
              source: 'ORDER_CANCELLED',
            },
          });
        }
      }
      const cancelled = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_CANCELLED',
        entityType: 'Order',
        entityId: order.id,
        metadata: { from: order.status, to: OrderStatus.CANCELLED },
      });
      return cancelled;
    });
  }
}

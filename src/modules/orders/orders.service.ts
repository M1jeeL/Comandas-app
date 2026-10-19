import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
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

  private async createPreparationTickets(
    tx: Prisma.TransactionClient,
    orderId: string,
  ) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { locationId: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    // 1. Obtener los OrderItems activos de la orden.
    const orderItems = await tx.orderItem.findMany({
      where: {
        orderId,
        status: {
          not: OrderItemStatus.CANCELLED,
        },
      },
    });

    // No tiene sentido enviar una orden sin items activos.
    if (orderItems.length === 0) {
      throw new ConflictException(
        'No se puede enviar una orden sin items activos',
      );
    }

    // 2. Obtener todos los productos utilizados en la orden.
    const productIds = [...new Set(orderItems.map((item) => item.productId))];

    const products = await tx.product.findMany({
      where: {
        id: {
          in: productIds,
        },
        status: 'ACTIVE',
      },

      include: {
        productWorkstations: {
          include: {
            workstation: true,
          },
        },
      },
    });

    // 3. Crear un Map para acceder rápidamente
    //    al producto mediante productId.
    const productsMap = new Map(
      products.map((product) => [product.id, product]),
    );

    // 4. Validar que todos los productos existan
    //    y tengan al menos una workstation.
    for (const orderItem of orderItems) {
      const product = productsMap.get(orderItem.productId);

      if (!product) {
        throw new ConflictException(
          `El producto ${orderItem.productId} no existe o no está activo`,
        );
      }

      if (product.productWorkstations.length === 0) {
        throw new ConflictException(
          `El producto "${product.name}" no tiene una workstation configurada`,
        );
      }
      if (product.productWorkstations.length !== 1) {
        throw new ConflictException(
          `El producto "${product.name}" tiene más de una estación. Corrige su asignación antes de enviar el pedido`,
        );
      }
      if (
        product.productWorkstations[0].workstation.locationId !==
        order.locationId
      ) {
        throw new ConflictException(
          `La estación del producto "${product.name}" pertenece a otro local`,
        );
      }
    }

    // 5. Agrupar los OrderItems por workstation.
    const workstationItems = new Map<
      string,
      {
        workstationId: string;
        items: {
          orderItemId: string;
          quantity: number;
        }[];
      }
    >();

    for (const orderItem of orderItems) {
      const product = productsMap.get(orderItem.productId)!;

      const productWorkstation = product.productWorkstations[0];
      if (productWorkstation.workstation.status !== 'ACTIVE') {
        throw new ConflictException(
          `La estación del producto "${product.name}" está inactiva`,
        );
      }
      const workstationId = productWorkstation.workstationId;

      if (!workstationItems.has(workstationId)) {
        workstationItems.set(workstationId, {
          workstationId,
          items: [],
        });
      }

      workstationItems.get(workstationId)!.items.push({
        orderItemId: orderItem.id,
        quantity: orderItem.quantity,
      });
    }

    // 6. Crear un ticket por workstation.
    const tickets: Prisma.PreparationTicketGetPayload<{
      include: {
        workstation: true;
        items: {
          include: {
            orderItem: {
              include: {
                product: true;
                modifiers: true;
              };
            };
          };
        };
      };
    }>[] = [];

    for (const { workstationId, items } of workstationItems.values()) {
      const ticket = await tx.preparationTicket.create({
        data: {
          orderId,
          workstationId,
          status: PreparationTicketStatus.PENDING,

          items: {
            create: items,
          },
        },

        include: {
          workstation: true,

          items: {
            include: {
              orderItem: {
                include: {
                  product: true,
                  modifiers: true,
                },
              },
            },
          },
        },
      });

      tickets.push(ticket);
    }

    return tickets;
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

    // 2. Solo podemos modificar pedidos DRAFT.
    if (order.status !== OrderStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden modificar pedidos en estado DRAFT',
      );
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
    return this.prisma.$transaction(async (tx) => {
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

    if (order.status !== OrderStatus.DRAFT) {
      if (
        (order.status !== OrderStatus.SENT &&
          order.status !== OrderStatus.IN_PROGRESS) ||
        dto.notes === undefined ||
        dto.quantity !== undefined ||
        dto.modifierIds !== undefined
      ) {
        throw new ConflictException(
          'Después del envío solo se puede actualizar la nota del ítem, y la estación debe seguir trabajando en la comanda',
        );
      }
      if (user.role === Role.WAITER && order.waiterId !== user.userId) {
        throw new ForbiddenException(
          'Solo el mesero asignado puede modificar este pedido',
        );
      }
      if (
        user.role !== Role.WAITER &&
        user.role !== Role.OWNER &&
        user.role !== Role.ADMIN &&
        user.role !== Role.MANAGER
      ) {
        throw new ForbiddenException(
          'Tu rol no puede modificar ítems enviados a preparación',
        );
      }
      const item = await this.prisma.orderItem.findFirst({
        where: { id: itemId, orderId: order.id },
      });
      if (!item)
        throw new NotFoundException('Item no encontrado en este pedido');
      const ticketItem = await this.prisma.preparationTicketItem.findFirst({
        where: { orderItemId: item.id, ticket: { orderId: order.id } },
        include: { ticket: true },
      });
      if (
        !ticketItem ||
        ticketItem.ticket.status === PreparationTicketStatus.READY ||
        ticketItem.ticket.status === PreparationTicketStatus.CANCELLED
      ) {
        throw new ConflictException(
          'La estación ya terminó o canceló la preparación de este ítem',
        );
      }
      if (
        item.cancellationStatus === 'PENDING' ||
        item.status === OrderItemStatus.CANCELLED
      ) {
        throw new ConflictException(
          'No se puede modificar un ítem con cancelación pendiente o aprobada',
        );
      }
      return serializableTransaction(this.prisma, async (tx) => {
        const currentOrder = await tx.order.findFirst({
          where: {
            id: order.id,
            status: { in: [OrderStatus.SENT, OrderStatus.IN_PROGRESS] },
          },
        });
        const currentItem = await tx.orderItem.findUnique({
          where: { id: item.id },
        });
        const currentTicketItem = await tx.preparationTicketItem.findFirst({
          where: {
            orderItemId: item.id,
            ticket: {
              orderId: order.id,
              status: {
                notIn: [
                  PreparationTicketStatus.READY,
                  PreparationTicketStatus.CANCELLED,
                ],
              },
            },
          },
        });
        if (
          !currentOrder ||
          !currentItem ||
          !currentTicketItem ||
          currentItem.cancellationStatus === 'PENDING' ||
          currentItem.status === OrderItemStatus.CANCELLED
        ) {
          throw new ConflictException(
            'El ítem o su comanda cambiaron; actualiza y vuelve a intentar',
          );
        }
        const changed = await tx.orderItem.updateMany({
          where: { id: item.id, updatedAt: currentItem.updatedAt },
          data: { notes: dto.notes!.trim() || null },
        });
        if (changed.count !== 1)
          throw new ConflictException('El ítem cambió mientras se actualizaba');
        const updated = await tx.orderItem.findUniqueOrThrow({
          where: { id: item.id },
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
            field: 'notes',
            before: currentItem.notes,
            after: updated.notes,
            source: 'POST_SEND_AMENDMENT_VISIBLE_TO_PREPARATION',
          },
        });
        return updated;
      });
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
    if (item.status === OrderItemStatus.CANCELLED) {
      throw new ConflictException('No se puede editar un ítem cancelado');
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

    if (order.status !== OrderStatus.DRAFT) {
      throw new ConflictException(
        'Solo se pueden eliminar items de pedidos en estado DRAFT',
      );
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
        where: { id: orderId, location: { businessId: user.businessId } },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (
        order.status !== OrderStatus.SENT &&
        order.status !== OrderStatus.IN_PROGRESS
      ) {
        throw new ConflictException(
          'Solo se puede solicitar cancelación mientras la preparación sigue activa',
        );
      }
      if (user.role === Role.WAITER && order.waiterId !== user.userId) {
        throw new ForbiddenException(
          'Solo el mesero asignado puede solicitar la cancelación',
        );
      }
      if (
        user.role !== Role.WAITER &&
        user.role !== Role.OWNER &&
        user.role !== Role.ADMIN &&
        user.role !== Role.MANAGER
      ) {
        throw new ForbiddenException(
          'Tu rol no puede solicitar la cancelación de ítems',
        );
      }
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId },
      });
      if (!item)
        throw new NotFoundException('Ítem no encontrado en este pedido');
      if (item.status === OrderItemStatus.CANCELLED)
        throw new ConflictException('El ítem ya está cancelado');
      if (item.cancellationStatus === 'PENDING')
        throw new ConflictException(
          'El ítem ya tiene una cancelación pendiente',
        );
      if (item.cancellationStatus === 'APPROVED')
        throw new ConflictException('La cancelación ya fue aprobada');
      const ticketItem = await tx.preparationTicketItem.findFirst({
        where: { orderItemId: item.id, ticket: { orderId } },
        include: { ticket: true },
      });
      if (
        !ticketItem ||
        ticketItem.ticket.status === PreparationTicketStatus.READY ||
        ticketItem.ticket.status === PreparationTicketStatus.CANCELLED
      ) {
        throw new ConflictException(
          'La estación ya terminó o canceló este ítem; no se puede solicitar su cancelación',
        );
      }
      const requestedAt = new Date();
      const changed = await tx.orderItem.updateMany({
        where: {
          id: item.id,
          cancellationStatus: item.cancellationStatus,
          status: item.status,
        },
        data: {
          cancellationStatus: 'PENDING',
          cancellationReason: dto.reason.trim(),
          cancellationRequestedAt: requestedAt,
          cancellationRequestedBy: user.userId,
          cancellationResolvedAt: null,
          cancellationResolvedBy: null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'El ítem cambió mientras se solicitaba la cancelación',
        );
      const updated = await tx.orderItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { modifiers: true },
      });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: 'ORDER_ITEM_UPDATED',
        entityType: 'OrderItem',
        entityId: item.id,
        metadata: {
          orderId,
          event: 'CANCELLATION_REQUESTED',
          reason: dto.reason.trim(),
          quantity: item.quantity,
          workstationId: ticketItem.ticket.workstationId,
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
    // 4. TAKEAWAY requiere nombre del cliente
    // --------------------------------------------------

    if (dto.type === OrderType.TAKEAWAY && !dto.customerName?.trim()) {
      throw new BadRequestException('Un pedido TAKEAWAY requiere customerName');
    }

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

    return this.prisma.$transaction(async (tx) => {
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

        items: true,
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

    return order;
  }

  /**
   * Cambiar estado del pedido.
   */
  async updateStatus(user: JwtUser, id: string, dto: UpdateOrderStatusDto) {
    if (
      dto.status !== OrderStatus.SENT &&
      dto.status !== OrderStatus.DELIVERED
    ) {
      throw new BadRequestException(
        'El pedido solo puede enviarse a preparación o marcarse como entregado desde esta acción',
      );
    }

    return serializableTransaction(this.prisma, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, location: { businessId: user.businessId } },
      });
      if (!order) throw new NotFoundException('Pedido no encontrado');

      const expectedStatus =
        dto.status === OrderStatus.SENT ? OrderStatus.DRAFT : OrderStatus.READY;
      if (order.status !== expectedStatus) {
        throw new ConflictException(
          dto.status === OrderStatus.DELIVERED
            ? 'El pedido solo puede entregarse cuando preparación lo haya marcado como listo'
            : `Solo se pueden enviar pedidos en estado ${OrderStatus.DRAFT}`,
        );
      }
      if (user.role === Role.WAITER && order.waiterId !== user.userId) {
        throw new ForbiddenException(
          'Solo el mesero asignado puede operar este pedido',
        );
      }

      if (dto.status === OrderStatus.DELIVERED) {
        const activeItems = await tx.orderItem.count({
          where: {
            orderId: order.id,
            status: { not: OrderItemStatus.CANCELLED },
          },
        });
        if (activeItems === 0) {
          throw new ConflictException(
            'No se puede entregar un pedido sin ítems activos; cancela el pedido completo',
          );
        }
        const tickets = await tx.preparationTicket.findMany({
          where: { orderId: order.id },
          select: {
            status: true,
            items: { select: { orderItem: { select: { status: true } } } },
          },
        });
        if (
          tickets.length === 0 ||
          tickets.some(
            (ticket) =>
              ticket.status !== PreparationTicketStatus.READY &&
              !(
                ticket.status === PreparationTicketStatus.CANCELLED &&
                ticket.items.every(
                  ({ orderItem }) =>
                    orderItem.status === OrderItemStatus.CANCELLED,
                )
              ),
          )
        ) {
          throw new ConflictException(
            'No se puede entregar un pedido con comandas pendientes',
          );
        }
      }

      const changed = await tx.order.updateMany({
        where: { id: order.id, status: expectedStatus },
        data: { status: dto.status },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'El estado del pedido cambió por otra solicitud',
        );
      }

      const preparationTickets =
        dto.status === OrderStatus.SENT
          ? await this.createPreparationTickets(tx, order.id)
          : [];
      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action:
          dto.status === OrderStatus.SENT ? 'ORDER_SENT' : 'ORDER_DELIVERED',
        entityType: 'Order',
        entityId: order.id,
        metadata: { from: order.status, to: dto.status },
      });
      return { order: updatedOrder, preparationTickets };
    });
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
      const changed = await tx.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { status: OrderStatus.CANCELLED },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'El estado del pedido cambió por otra solicitud',
        );
      }
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

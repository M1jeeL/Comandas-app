import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import {
  OrderStatus,
  PreparationTicketStatus,
  Role,
} from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';
import { ItemCancellationDecision, ResolveItemCancellationDto } from './dto/resolve-item-cancellation.dto.js';

@Injectable()
export class PreparationTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Obtiene todos los tickets de preparación
   * pertenecientes al business del usuario.
   */
  async findAll(user: JwtUser, locationId?: string) {
    return this.prisma.preparationTicket.findMany({
      where: {
        workstation: {
          location: {
            businessId: user.businessId,
            ...(locationId ? { id: locationId } : {}),
          },
        },
      },

      include: {
        workstation: true,

        order: {
          include: {
            tableSession: {
              include: {
                table: true,
              },
            },
          },
        },

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

      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Obtiene un ticket específico.
   */
  async findOne(user: JwtUser, id: string) {
    const ticket = await this.prisma.preparationTicket.findFirst({
      where: {
        id,

        workstation: {
          location: {
            businessId: user.businessId,
          },
        },
      },

      include: {
        workstation: true,

        order: {
          include: {
            tableSession: {
              include: {
                table: true,
              },
            },
          },
        },

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

    if (!ticket) {
      throw new NotFoundException('Ticket de preparación no encontrado');
    }

    return ticket;
  }

  /**
   * Actualiza el estado de un ticket.
   */
  async updateStatus(
    user: JwtUser,
    id: string,
    status: PreparationTicketStatus,
  ) {
    return serializableTransaction(this.prisma, async (tx) => {
      const ticket = await tx.preparationTicket.findFirst({
        where: { id, workstation: { location: { businessId: user.businessId } } },
      });
      if (!ticket) throw new NotFoundException('Ticket de preparación no encontrado');
      this.validateStatusTransition(ticket.status, status);

      const order = await tx.order.findUnique({ where: { id: ticket.orderId } });
      if (!order) throw new NotFoundException('Pedido de la comanda no encontrado');
      if ([OrderStatus.DELIVERED, OrderStatus.CLOSED, OrderStatus.CANCELLED].some((status) => status === order.status)) {
        throw new ConflictException('No se puede modificar una comanda de un pedido finalizado');
      }
      const data: {
        status: PreparationTicketStatus;
        startedAt?: Date;
        readyAt?: Date;
        cancelledAt?: Date;
      } = {
        status,
      };

      if (status === PreparationTicketStatus.IN_PROGRESS && !ticket.startedAt) {
        data.startedAt = new Date();
      }

      if (status === PreparationTicketStatus.READY && !ticket.readyAt) {
        data.readyAt = new Date();
      }

      if (status === PreparationTicketStatus.CANCELLED && !ticket.cancelledAt) {
        data.cancelledAt = new Date();
      }

      // Compare-and-set avoids two stations overwriting the same ticket state.
      const changed = await tx.preparationTicket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data,
      });
      if (changed.count !== 1) {
        throw new ConflictException('La comanda ya fue actualizada por otra solicitud');
      }
      const updatedTicket = await tx.preparationTicket.findUniqueOrThrow({
        where: { id: ticket.id },
        include: {
          workstation: true,
          items: { include: { orderItem: { include: { product: true, modifiers: true } } } },
        },
      });

      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: order.locationId,
        userId: user.userId,
        action: status === PreparationTicketStatus.READY
          ? 'PREPARATION_TICKET_READY'
          : status === PreparationTicketStatus.CANCELLED
            ? 'PREPARATION_TICKET_CANCELLED'
            : status === PreparationTicketStatus.IN_PROGRESS
              ? 'PREPARATION_TICKET_STARTED'
              : 'STATUS_CHANGE',
        entityType: 'PreparationTicket',
        entityId: ticket.id,
        metadata: { orderId: order.id, from: ticket.status, to: status },
      });

      // 2. Si el ticket NO quedó READY,
      //    no necesitamos comprobar la orden.
      if (status !== PreparationTicketStatus.READY) {
        if (status === PreparationTicketStatus.IN_PROGRESS && order.status === OrderStatus.SENT) {
          const orderChanged = await tx.order.updateMany({
            where: { id: order.id, status: OrderStatus.SENT },
            data: { status: OrderStatus.IN_PROGRESS },
          });
          if (orderChanged.count === 1) {
            await this.audit.record(tx, {
              businessId: user.businessId,
              locationId: order.locationId,
              userId: user.userId,
              action: 'STATUS_CHANGE',
              entityType: 'Order',
              entityId: order.id,
              metadata: { from: OrderStatus.SENT, to: OrderStatus.IN_PROGRESS, source: 'PREPARATION_TICKET' },
            });
          }
        }
        return {
          ticket: updatedTicket,
          orderUpdated: false,
        };
      }

      // 3. Obtener todos los tickets
      //    pertenecientes a la misma orden.
      const orderTickets = await tx.preparationTicket.findMany({
        where: {
          orderId: ticket.orderId,
        },

        select: {
          id: true,
          status: true,
          items: { select: { orderItem: { select: { status: true } } } },
        },
      });

      // 4. Comprobar si TODOS están READY.
      const allTicketsReady =
        orderTickets.length > 0 &&
        orderTickets.every(
          (ticket) => ticket.status === PreparationTicketStatus.READY || (
            ticket.status === PreparationTicketStatus.CANCELLED &&
            ticket.items.every(({ orderItem }) => orderItem.status === 'CANCELLED')
          ),
        );

      // 5. Si todos están READY,
      //    actualizar la orden.
      const activeOrderItems = allTicketsReady
        ? await tx.orderItem.count({ where: { orderId: ticket.orderId, status: { not: 'CANCELLED' } } })
        : 0;
      if (allTicketsReady && activeOrderItems > 0) {
        const orderChanged = await tx.order.updateMany({
          where: { id: ticket.orderId, status: { in: [OrderStatus.SENT, OrderStatus.IN_PROGRESS] } },
          data: {
            status: OrderStatus.READY,
          },
        });
        if (orderChanged.count === 1) {
          await this.audit.record(tx, {
            businessId: user.businessId,
            locationId: order.locationId,
            userId: user.userId,
            action: 'ORDER_READY',
            entityType: 'Order',
            entityId: order.id,
            metadata: { from: order.status, to: OrderStatus.READY, source: 'PREPARATION_TICKETS' },
          });
        }

        return {
          ticket: updatedTicket,
          orderUpdated: orderChanged.count === 1,
        };
      }

      // 6. Todavía quedan tickets pendientes.
      return {
        ticket: updatedTicket,
        orderUpdated: false,
      };
    });
  }

  async resolveItemCancellation(
    user: JwtUser,
    ticketId: string,
    ticketItemId: string,
    dto: ResolveItemCancellationDto,
  ) {
    if (user.role !== Role.KITCHEN && user.role !== Role.OWNER && user.role !== Role.ADMIN && user.role !== Role.MANAGER) {
      throw new ForbiddenException('Tu rol no puede resolver cancelaciones de preparación');
    }
    return serializableTransaction(this.prisma, async (tx) => {
      const ticketItem = await tx.preparationTicketItem.findFirst({
        where: {
          id: ticketItemId,
          ticketId,
          ticket: { workstation: { location: { businessId: user.businessId } } },
        },
        include: { ticket: { include: { workstation: { select: { locationId: true } } } }, orderItem: true },
      });
      if (!ticketItem) throw new NotFoundException('Ítem de preparación no encontrado');
      if (ticketItem.ticket.status === PreparationTicketStatus.READY || ticketItem.ticket.status === PreparationTicketStatus.CANCELLED) {
        throw new ConflictException('La comanda ya fue finalizada');
      }
      if (ticketItem.orderItem.cancellationStatus !== 'PENDING') {
        throw new ConflictException('El ítem no tiene una cancelación pendiente');
      }
      const approved = dto.decision === ItemCancellationDecision.APPROVE;
      const now = new Date();
      const changed = await tx.orderItem.updateMany({
        where: { id: ticketItem.orderItemId, cancellationStatus: 'PENDING' },
        data: {
          cancellationStatus: approved ? 'APPROVED' : 'REJECTED',
          ...(approved ? { status: 'CANCELLED' as const } : {}),
          cancellationResolvedAt: now,
          cancellationResolvedBy: user.userId,
        },
      });
      if (changed.count !== 1) throw new ConflictException('La solicitud ya fue resuelta');

      let updatedTicket = ticketItem.ticket;
      if (approved) {
        const remainingItems = await tx.preparationTicketItem.count({
          where: { ticketId, orderItem: { status: { not: 'CANCELLED' } } },
        });
        if (remainingItems === 0) {
          const ticketChanged = await tx.preparationTicket.updateMany({
            where: { id: ticketId, status: ticketItem.ticket.status },
            data: { status: PreparationTicketStatus.CANCELLED, cancelledAt: now },
          });
          if (ticketChanged.count !== 1) throw new ConflictException('La comanda cambió mientras se resolvía la cancelación');
        }
        updatedTicket = await tx.preparationTicket.findUniqueOrThrow({
          where: { id: ticketId },
          include: { workstation: { select: { locationId: true } } },
        });
        const activeItems = await tx.orderItem.count({
          where: { orderId: ticketItem.ticket.orderId, status: { not: 'CANCELLED' } },
        });
        const remainingTickets = await tx.preparationTicket.findMany({
          where: { orderId: ticketItem.ticket.orderId },
          select: { status: true },
        });
        if (
          activeItems > 0 &&
          remainingTickets.length > 0 &&
          remainingTickets.every(({ status }) => status === PreparationTicketStatus.READY || status === PreparationTicketStatus.CANCELLED)
        ) {
          await tx.order.updateMany({
            where: { id: ticketItem.ticket.orderId, status: { in: [OrderStatus.SENT, OrderStatus.IN_PROGRESS] } },
            data: { status: OrderStatus.READY },
          });
        }
      }

      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: ticketItem.ticket.workstation.locationId,
        userId: user.userId,
        action: approved ? 'ORDER_ITEM_CANCELLED' : 'ORDER_ITEM_UPDATED',
        entityType: 'OrderItem',
        entityId: ticketItem.orderItemId,
        metadata: {
          orderId: ticketItem.ticket.orderId,
          ticketId,
          decision: dto.decision,
          reason: ticketItem.orderItem.cancellationReason,
          requestedBy: ticketItem.orderItem.cancellationRequestedBy,
        },
      });
      return { ticket: updatedTicket, orderItemId: ticketItem.orderItemId, decision: dto.decision };
    });
  }

  /**
   * Máquina de estados del PreparationTicket.
   */
  private validateStatusTransition(
    currentStatus: PreparationTicketStatus,
    newStatus: PreparationTicketStatus,
  ) {
    const allowedTransitions: Record<
      PreparationTicketStatus,
      PreparationTicketStatus[]
    > = {
      [PreparationTicketStatus.PENDING]: [
        PreparationTicketStatus.ACCEPTED,
        PreparationTicketStatus.CANCELLED,
      ],

      [PreparationTicketStatus.ACCEPTED]: [
        PreparationTicketStatus.IN_PROGRESS,
        PreparationTicketStatus.CANCELLED,
      ],

      [PreparationTicketStatus.IN_PROGRESS]: [
        PreparationTicketStatus.READY,
        PreparationTicketStatus.CANCELLED,
      ],

      [PreparationTicketStatus.READY]: [],

      [PreparationTicketStatus.CANCELLED]: [],
    };

    const allowed = allowedTransitions[currentStatus];

    if (!allowed.includes(newStatus)) {
      throw new ConflictException(
        `No se puede cambiar el ticket de ${currentStatus} a ${newStatus}`,
      );
    }
  }
}

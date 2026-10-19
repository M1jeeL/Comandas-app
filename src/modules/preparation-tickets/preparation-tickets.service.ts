import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import {
  OrderStatus,
  PreparationTicketStatus,
} from '../../generated/prisma/client.js';

@Injectable()
export class PreparationTicketsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const ticket = await this.prisma.preparationTicket.findFirst({
      where: {
        id,

        workstation: {
          location: {
            businessId: user.businessId,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket de preparación no encontrado');
    }

    this.validateStatusTransition(ticket.status, status);

    return this.prisma.$transaction(async (tx) => {
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

      // 1. Actualizar el PreparationTicket
      const updatedTicket = await tx.preparationTicket.update({
        where: {
          id: ticket.id,
        },

        data,

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

      // 2. Si el ticket NO quedó READY,
      //    no necesitamos comprobar la orden.
      if (status !== PreparationTicketStatus.READY) {
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
        },
      });

      // 4. Comprobar si TODOS están READY.
      const allTicketsReady =
        orderTickets.length > 0 &&
        orderTickets.every(
          (ticket) => ticket.status === PreparationTicketStatus.READY,
        );

      // 5. Si todos están READY,
      //    actualizar la orden.
      if (allTicketsReady) {
        await tx.order.update({
          where: {
            id: ticket.orderId,
          },

          data: {
            status: OrderStatus.READY,
          },
        });

        return {
          ticket: updatedTicket,
          orderUpdated: true,
        };
      }

      // 6. Todavía quedan tickets pendientes.
      return {
        ticket: updatedTicket,
        orderUpdated: false,
      };
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

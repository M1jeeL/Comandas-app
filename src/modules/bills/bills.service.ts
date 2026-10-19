import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { CreateBillDto } from './dto/create-bill.dto.js';
import { UpdateBillTipDto } from './dto/update-bill-tip.dto.js';

import { BillStatus, OrderStatus } from '../../generated/prisma/enums.js';

import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

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
   * Calcula el subtotal de una orden utilizando
   * los snapshots almacenados en OrderItem.
   *
   * unitPrice * quantity
   *
   * +
   *
   * modifiers.priceDelta * quantity
   */
  private calculateOrderSubtotal(order: {
    items: Array<{
      unitPrice: Prisma.Decimal;
      quantity: number;
      status: string;
      modifiers: Array<{
        priceDelta: Prisma.Decimal;
      }>;
    }>;
  }): Prisma.Decimal {
    let subtotal = new Prisma.Decimal(0);

    for (const item of order.items) {
      if (item.status === 'CANCELLED') {
        continue;
      }

      let itemTotal = item.unitPrice.mul(item.quantity);

      for (const modifier of item.modifiers) {
        itemTotal = itemTotal.add(modifier.priceDelta.mul(item.quantity));
      }

      subtotal = subtotal.add(itemTotal);
    }

    return subtotal;
  }

  /**
   * Crea una cuenta a partir de una o varias órdenes.
   */
  async create(user: JwtUser, dto: CreateBillDto) {
    try {
      return await serializableTransaction(this.prisma, async (tx) => {
      const orders = await tx.order.findMany({
        where: {
          id: {
            in: dto.orderIds,
          },

          location: {
            businessId: user.businessId,
          },
        },

        include: {
          items: {
            where: {
              status: {
                not: 'CANCELLED',
              },
            },

            include: {
              modifiers: true,
            },
          },

          billOrders: true,
        },
      });

      // -------------------------------------------------------
      // 1. Verificar que encontramos todas las órdenes
      // -------------------------------------------------------

      if (orders.length !== dto.orderIds.length) {
        throw new NotFoundException(
          'Una o más órdenes no existen o no pertenecen a tu negocio',
        );
      }

      // -------------------------------------------------------
      // 2. Todas deben pertenecer a la misma ubicación
      // -------------------------------------------------------

      const locationId = orders[0]?.locationId;

      if (!locationId) {
        throw new BadRequestException(
          'No se pudo determinar la ubicación de las órdenes',
        );
      }

      const differentLocation = orders.some(
        (order) => order.locationId !== locationId,
      );

      if (differentLocation) {
        throw new BadRequestException(
          'Todas las órdenes de una cuenta deben pertenecer a la misma ubicación',
        );
      }

      // -------------------------------------------------------
      // 3. Verificar ubicación activa
      // -------------------------------------------------------

      await this.validateLocation(locationId, user.businessId);

      // -------------------------------------------------------
      // 4. Verificar estados de las órdenes
      // -------------------------------------------------------

      for (const order of orders) {
        const billableStatuses: OrderStatus[] = [OrderStatus.DELIVERED];

        if (!billableStatuses.includes(order.status)) {
          throw new ConflictException(
            `La orden ${order.id} no puede ser facturada mientras esté en estado ${order.status}`,
          );
        }
      }

      // -------------------------------------------------------
      // 5. Verificar que ninguna orden ya esté asociada
      //    a otra cuenta
      // -------------------------------------------------------

      const alreadyBilled = orders.find((order) => order.billOrders.length > 0);

      if (alreadyBilled) {
        throw new ConflictException(
          `La orden ${alreadyBilled.id} ya está asociada a una cuenta`,
        );
      }

      // -------------------------------------------------------
      // 6. Verificar que las órdenes tengan items
      // -------------------------------------------------------

      for (const order of orders) {
        if (order.items.length === 0) {
          throw new BadRequestException(
            `La orden ${order.id} no contiene items facturables`,
          );
        }
      }

      // -------------------------------------------------------
      // 7. Calcular subtotal
      // -------------------------------------------------------

      let subtotal = new Prisma.Decimal(0);

      for (const order of orders) {
        subtotal = subtotal.add(this.calculateOrderSubtotal(order));
      }

      if (subtotal.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'El subtotal de la cuenta debe ser mayor que cero',
        );
      }

      // -------------------------------------------------------
      // 8. Crear Bill + BillOrder
      // -------------------------------------------------------

      const bill = await tx.bill.create({
        data: {
          locationId,

          status: BillStatus.OPEN,

          subtotal,

          discountTotal: new Prisma.Decimal(0),

          tipAmount: new Prisma.Decimal(0),

          total: subtotal,

          orders: {
            create: orders.map((order) => ({
              orderId: order.id,
            })),
          },
        },

        include: {
          orders: {
            include: {
              order: {
                include: {
                  items: {
                    include: {
                      modifiers: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      await this.audit.record(tx, {
        businessId: user.businessId, locationId, userId: user.userId,
        action: 'BILL_CREATED', entityType: 'Bill', entityId: bill.id,
        metadata: { orderIds: orders.map((order) => order.id), total: bill.total.toString() },
      });

      return bill;
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException(
          'Una o más órdenes ya fueron asociadas a una cuenta por otra solicitud',
        );
      }
      throw error;
    }
  }

  /**
   * Obtener todas las cuentas de una ubicación
   * perteneciente al negocio del usuario.
   */
  async findAll(user: JwtUser, locationId?: string) {
    if (locationId) {
      await this.validateLocation(locationId, user.businessId);
    }

    return this.prisma.bill.findMany({
      where: {
        ...(locationId && {
          locationId,
        }),

        location: {
          businessId: user.businessId,
        },
      },

      include: {
        orders: {
          include: {
            order: true,
          },
        },

        discounts: true,

        payments: {
          include: {
            cashHandover: {
              select: {
                id: true,
                status: true,
                cashSessionId: true,
                confirmedAt: true,
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
   * Obtener una cuenta específica.
   */
  async findOne(user: JwtUser, id: string) {
    const bill = await this.prisma.bill.findFirst({
      where: {
        id,

        location: {
          businessId: user.businessId,
        },
      },

      include: {
        orders: {
          include: {
            order: {
              include: {
                items: {
                  include: {
                    modifiers: true,
                  },
                },
              },
            },
          },
        },

        discounts: true,

        payments: true,

        location: true,
      },
    });

    if (!bill) {
      throw new NotFoundException('Cuenta no encontrada');
    }

    return bill;
  }

  /**
   * Actualiza la propina.
   *
   * Todavía no permite modificar una cuenta
   * que ya fue pagada o anulada.
   */
  async updateTip(user: JwtUser, id: string, dto: UpdateBillTipDto) {
    return serializableTransaction(this.prisma, async (tx) => {
    const bill = await tx.bill.findFirst({
      where: {
        id,

        location: {
          businessId: user.businessId,
        },
      },

      include: {
        payments: true,
      },
    });

    if (!bill) {
      throw new NotFoundException('Cuenta no encontrada');
    }

    if (bill.status === BillStatus.PAID || bill.status === BillStatus.VOID) {
      throw new ConflictException(
        'No se puede modificar la propina de una cuenta pagada o anulada',
      );
    }

    const confirmedPayment = bill.payments.some(
      (payment) => payment.status === 'CONFIRMED',
    );

    const pendingPayment = bill.payments.some(
      (payment) => payment.status === 'PENDING',
    );

    if (confirmedPayment) {
      throw new ConflictException(
        'No se puede modificar la propina de una cuenta que tiene pagos confirmados',
      );
    }

    if (pendingPayment) {
      throw new ConflictException(
        'Confirma o cancela los pagos pendientes antes de modificar la propina',
      );
    }

    const tipAmount = new Prisma.Decimal(dto.tipAmount);

    const total = bill.subtotal.sub(bill.discountTotal).add(tipAmount);

    if (total.lessThan(0)) {
      throw new BadRequestException(
        'El total de la cuenta no puede ser negativo',
      );
    }

      const updated = await tx.bill.update({
        where: { id: bill.id },
        data: { tipAmount, total },
        include: {
        orders: {
          include: {
            order: true,
          },
        },

        discounts: true,

        payments: true,
        },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, locationId: bill.locationId, userId: user.userId,
        action: 'BILL_UPDATED', entityType: 'Bill', entityId: bill.id,
        metadata: { field: 'tipAmount', from: bill.tipAmount.toString(), to: tipAmount.toString(), total: total.toString() },
      });
      return updated;
    });
  }

  /**
   * Anula una cuenta.
   */
  async void(user: JwtUser, id: string) {
    return serializableTransaction(this.prisma, async (tx) => {
    const bill = await tx.bill.findFirst({
      where: {
        id,

        location: {
          businessId: user.businessId,
        },
      },

      include: {
        payments: true,
      },
    });

    if (!bill) {
      throw new NotFoundException('Cuenta no encontrada');
    }

    if (bill.status === BillStatus.VOID) {
      throw new ConflictException('La cuenta ya está anulada');
    }

    if (bill.status === BillStatus.PAID) {
      throw new ConflictException(
        'No se puede anular una cuenta que ya fue pagada',
      );
    }

    const confirmedPayment = bill.payments.some(
      (payment) => payment.status === 'CONFIRMED',
    );

    if (confirmedPayment) {
      throw new ConflictException(
        'No se puede anular una cuenta que tiene pagos confirmados',
      );
    }

      const voided = await tx.bill.update({
        where: { id: bill.id },
        data: { status: BillStatus.VOID },
        include: {
        orders: {
          include: {
            order: true,
          },
        },

        discounts: true,

        payments: true,
        },
      });
      await this.audit.record(tx, {
        businessId: user.businessId, locationId: bill.locationId, userId: user.userId,
        action: 'BILL_CANCELLED', entityType: 'Bill', entityId: bill.id,
        metadata: { from: bill.status, to: BillStatus.VOID },
      });
      return voided;
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto.js';

import {
  BillStatus,
  CashHandoverStatus,
  CashSessionStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../generated/prisma/enums.js';

import { Prisma } from '../../generated/prisma/client.js';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}
  private async findCashResponsibleWaiter(
    tx: Prisma.TransactionClient,
    billId: string,
  ) {
    const billOrders = await tx.billOrder.findMany({
      where: {
        billId,
      },

      include: {
        order: {
          select: {
            waiterId: true,
          },
        },
      },
    });

    const waiterIds = [
      ...new Set(
        billOrders
          .map((billOrder) => billOrder.order.waiterId)
          .filter((waiterId): waiterId is string => Boolean(waiterId)),
      ),
    ];

    if (waiterIds.length === 0) {
      return null;
    }

    if (waiterIds.length > 1) {
      throw new ConflictException(
        'No se puede determinar el mesero responsable del pago en efectivo porque la cuenta contiene órdenes de distintos meseros',
      );
    }

    return waiterIds[0];
  }

  private async findOpenCashSession(
    tx: Prisma.TransactionClient,
    locationId: string,
  ) {
    const cashSession = await tx.cashSession.findFirst({
      where: {
        locationId,
        status: CashSessionStatus.OPEN,
      },
    });

    if (!cashSession) {
      throw new ConflictException(
        'No existe una sesión de caja abierta para esta ubicación',
      );
    }

    return cashSession;
  }

  /**
   * Busca una Bill perteneciente al negocio
   * del usuario autenticado.
   */
  private async findBillForUser(user: JwtUser, billId: string) {
    const bill = await this.prisma.bill.findFirst({
      where: {
        id: billId,

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

    return bill;
  }

  /**
   * Calcula cuánto dinero ya está confirmado.
   */
  private calculateConfirmedTotal(
    payments: Array<{
      status: PaymentStatus;
      amount: Prisma.Decimal;
    }>,
  ) {
    return payments
      .filter((payment) => payment.status === PaymentStatus.CONFIRMED)
      .reduce(
        (total, payment) => total.add(payment.amount),
        new Prisma.Decimal(0),
      );
  }

  /**
   * Crea un Payment en estado PENDING.
   */
  async create(user: JwtUser, billId: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findFirst({
        where: {
          id: billId,

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
        throw new ConflictException(
          'No se puede agregar un pago a una cuenta anulada',
        );
      }

      if (bill.status === BillStatus.PAID) {
        throw new ConflictException('La cuenta ya está pagada');
      }

      const amount = new Prisma.Decimal(dto.amount);

      const confirmedTotal = this.calculateConfirmedTotal(bill.payments);

      const remaining = new Prisma.Decimal(bill.total).sub(confirmedTotal);

      if (amount.greaterThan(remaining)) {
        throw new BadRequestException(
          `El pago supera el saldo pendiente de la cuenta. Saldo disponible: ${remaining.toFixed(2)}`,
        );
      }

      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('El monto debe ser mayor que cero');
      }

      const payment = await tx.payment.create({
        data: {
          billId: bill.id,

          method: dto.method,

          status: PaymentStatus.PENDING,

          amount,

          reference: dto.reference,
        },
      });

      return {
        payment,

        bill: {
          id: bill.id,

          total: bill.total,

          confirmedPaid: confirmedTotal,

          remaining,
        },
      };
    });
  }

  /**
   * Obtener pagos de una Bill.
   */
  async findAll(user: JwtUser, billId: string) {
    const bill = await this.findBillForUser(user, billId);

    return this.prisma.payment.findMany({
      where: {
        billId: bill.id,
      },

      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Cambiar estado de un Payment.
   */
  async updateStatus(
    user: JwtUser,
    billId: string,
    paymentId: string,
    dto: UpdatePaymentStatusDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findFirst({
        where: {
          id: billId,

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
        throw new ConflictException('No se puede modificar una cuenta anulada');
      }

      const payment = await tx.payment.findFirst({
        where: {
          id: paymentId,
          billId: bill.id,
        },
      });

      if (!payment) {
        throw new NotFoundException('Pago no encontrado');
      }

      // -------------------------------------------
      // No permitir cambios sobre estados finales
      // -------------------------------------------

      if (
        payment.status === PaymentStatus.CONFIRMED ||
        payment.status === PaymentStatus.REJECTED ||
        payment.status === PaymentStatus.CANCELLED
      ) {
        throw new ConflictException(
          `El pago ya se encuentra en estado ${payment.status} y no puede modificarse`,
        );
      }

      // -------------------------------------------
      // Solo permitimos transiciones desde PENDING
      // -------------------------------------------

      if (
        dto.status !== PaymentStatus.CONFIRMED &&
        dto.status !== PaymentStatus.REJECTED &&
        dto.status !== PaymentStatus.CANCELLED
      ) {
        throw new BadRequestException(
          'Desde PENDING solo se puede cambiar a CONFIRMED, REJECTED o CANCELLED',
        );
      }

      // -------------------------------------------
      // CONFIRMAR
      // -------------------------------------------

      if (dto.status === PaymentStatus.CONFIRMED) {
        const confirmedTotal = this.calculateConfirmedTotal(bill.payments);

        const newConfirmedTotal = confirmedTotal.add(payment.amount);

        const billTotal = new Prisma.Decimal(bill.total);

        if (newConfirmedTotal.greaterThan(billTotal)) {
          throw new BadRequestException(
            'La confirmación de este pago supera el total de la cuenta',
          );
        }

        const confirmedAt = new Date();

        const updatedPayment = await tx.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: PaymentStatus.CONFIRMED,

            confirmedAt,
          },
        });

        // -----------------------------------------
        // Actualizar Bill
        // -----------------------------------------

        let newBillStatus: BillStatus;

        if (newConfirmedTotal.equals(billTotal)) {
          newBillStatus = BillStatus.PAID;
        } else {
          newBillStatus = BillStatus.PARTIALLY_PAID;
        }

        const updatedBill = await tx.bill.update({
          where: {
            id: bill.id,
          },

          data: {
            status: newBillStatus,
          },
        });

        if (payment.method === PaymentMethod.CASH) {
          const cashSession = await this.findOpenCashSession(
            tx,
            bill.locationId,
          );

          const waiterId = await this.findCashResponsibleWaiter(tx, bill.id);

          if (!waiterId) {
            throw new ConflictException(
              'No se puede generar la entrega de efectivo porque la cuenta no tiene un mesero responsable',
            );
          }

          await tx.cashHandover.create({
            data: {
              cashSessionId: cashSession.id,
              paymentId: payment.id,
              waiterId,
              createdBy: user.userId,
              amount: payment.amount,
              status: CashHandoverStatus.PENDING,
            },
          });
        }

        return {
          payment: updatedPayment,

          bill: updatedBill,
        };
      }

      // -------------------------------------------
      // REJECTED / CANCELLED
      // -------------------------------------------

      const updatedPayment = await tx.payment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: dto.status,

          confirmedAt: null,
        },
      });

      return {
        payment: updatedPayment,

        bill: {
          id: bill.id,

          status: bill.status,
        },
      };
    });
  }
}

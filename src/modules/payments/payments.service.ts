import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  CashMovementType,
  CashSessionStatus,
  PaymentMethod,
  PaymentStatus,
  OrderStatus,
  Role,
} from '../../generated/prisma/enums.js';

import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';
import { ReversePaymentDto } from './dto/reverse-payment.dto.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A waiter can handle a bill only when every order belongs to them. */
  private async assertWaiterOwnsBill(
    client: Pick<Prisma.TransactionClient, 'billOrder'>,
    user: JwtUser,
    billId: string,
  ) {
    if (user.role !== Role.WAITER) return;

    const billOrders = await client.billOrder.findMany({
      where: { billId },
      select: { order: { select: { waiterId: true } } },
    });

    if (
      billOrders.length === 0 ||
      billOrders.some(({ order }) => order.waiterId !== user.userId)
    ) {
      throw new ConflictException(
        'Solo puedes cobrar cuentas de pedidos asignados a tu usuario',
      );
    }
  }

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

    await this.assertWaiterOwnsBill(this.prisma, user, bill.id);

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
    try {
      return await serializableTransaction(this.prisma, async (tx) => {
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

      await this.assertWaiterOwnsBill(tx, user, bill.id);

      const existing = await tx.payment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (existing) {
        if (
          existing.billId !== bill.id ||
          existing.method !== dto.method ||
          !existing.amount.equals(dto.amount)
        ) {
          throw new ConflictException('La clave de reintento ya se usó para otro pago');
        }
        return { payment: existing, bill: { id: bill.id, total: bill.total } };
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
      const pendingTotal = bill.payments
        .filter((payment) => payment.status === PaymentStatus.PENDING)
        .reduce(
          (total, payment) => total.add(payment.amount),
          new Prisma.Decimal(0),
        );

      const remaining = new Prisma.Decimal(bill.total)
        .sub(confirmedTotal)
        .sub(pendingTotal);

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
          idempotencyKey: dto.idempotencyKey,
        },
      });

      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: bill.locationId,
        userId: user.userId,
        action: 'PAYMENT_CREATED',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { billId: bill.id, method: payment.method, amount: payment.amount.toString() },
      });

      return {
        payment,

        bill: {
          id: bill.id,

          total: bill.total,

          confirmedPaid: confirmedTotal,

          pendingAmount: pendingTotal,

          remaining,
        },
      };
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== 'P2002') throw error;
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
      });
      if (!existing) throw error;
      const bill = await this.findBillForUser(user, billId);
      if (
        existing.billId !== bill.id ||
        existing.method !== dto.method ||
        !existing.amount.equals(dto.amount)
      ) {
        throw new ConflictException(
          'La clave de reintento ya se usó para otro pago',
        );
      }
      return { payment: existing, bill: { id: bill.id, total: bill.total } };
    }
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
    return serializableTransaction(this.prisma, async (tx) => {
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

      await this.assertWaiterOwnsBill(tx, user, bill.id);

      if (user.role === Role.WAITER && dto.status === PaymentStatus.REJECTED) {
        throw new BadRequestException(
          'El mesero puede confirmar o cancelar el pago, pero no rechazarlo',
        );
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
        if (payment.status === dto.status) {
          return { payment, bill };
        }
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

        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, billId: bill.id, status: PaymentStatus.PENDING },
          data: {
            status: PaymentStatus.CONFIRMED,
            confirmedAt,
          },
        });
        if (claimed.count !== 1) {
          throw new ConflictException('El pago ya fue procesado por otra solicitud');
        }
        const updatedPayment = await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
        });

        await this.audit.record(tx, {
          businessId: user.businessId,
          locationId: bill.locationId,
          userId: user.userId,
          action: 'PAYMENT_CONFIRMED',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: { billId: bill.id, method: payment.method, amount: payment.amount.toString() },
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

        if (newBillStatus === BillStatus.PAID) {
          const billOrders = await tx.billOrder.findMany({
            where: { billId: bill.id },
            select: { orderId: true },
          });

          await tx.order.updateMany({
            where: {
              id: { in: billOrders.map(({ orderId }) => orderId) },
              status: OrderStatus.DELIVERED,
            },
            data: { status: OrderStatus.CLOSED },
          });
        }

        if (payment.method === PaymentMethod.CASH) {
          const cashSession = await this.findOpenCashSession(
            tx,
            bill.locationId,
          );
          const sessionLock = await tx.cashSession.updateMany({
            where: { id: cashSession.id, status: CashSessionStatus.OPEN },
            data: { status: CashSessionStatus.OPEN },
          });
          if (sessionLock.count !== 1) {
            throw new ConflictException('La sesión de caja dejó de estar abierta');
          }

          const waiterId = await this.findCashResponsibleWaiter(tx, bill.id);

          if (!waiterId) {
            // Pedidos para llevar o cobrados directamente por caja no tienen
            // entrega entre mesero y cajero: el pago confirmado entra a caja.
            const movement = await tx.cashMovement.create({
              data: {
                cashSessionId: cashSession.id,
                type: CashMovementType.SALE,
                amount: payment.amount,
                reference: payment.id,
                createdBy: user.userId,
              },
            });
            await this.audit.record(tx, {
              businessId: user.businessId,
              locationId: bill.locationId,
              userId: user.userId,
              action: 'CASH_MOVEMENT_CREATED',
              entityType: 'CashMovement',
              entityId: movement.id,
              metadata: {
                type: movement.type,
                amount: movement.amount.toString(),
                reference: payment.id,
                paymentId: payment.id,
                source: 'DIRECT_CASH_PAYMENT',
              },
            });
          } else {
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
        }

        return {
          payment: updatedPayment,

          bill: updatedBill,
        };
      }

      // -------------------------------------------
      // REJECTED / CANCELLED
      // -------------------------------------------

      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, billId: bill.id, status: PaymentStatus.PENDING },
        data: {
          status: dto.status,
          confirmedAt: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('El pago ya fue procesado por otra solicitud');
      }
      const updatedPayment = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });

      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: bill.locationId,
        userId: user.userId,
        action: dto.status === PaymentStatus.REJECTED ? 'PAYMENT_REJECTED' : 'PAYMENT_CANCELLED',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: { billId: bill.id, method: payment.method, amount: payment.amount.toString() },
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

  async reverse(user: JwtUser, billId: string, paymentId: string, dto: ReversePaymentDto) {
    if (![Role.OWNER, Role.ADMIN, Role.MANAGER, Role.CASHIER].some((role) => role === user.role)) {
      throw new ForbiddenException('Tu rol no puede revertir pagos confirmados');
    }

    return serializableTransaction(this.prisma, async (tx) => {
      const bill = await tx.bill.findFirst({
        where: { id: billId, location: { businessId: user.businessId } },
        include: { payments: true, orders: { select: { orderId: true } } },
      });
      if (!bill) throw new NotFoundException('Cuenta no encontrada');

      const payment = bill.payments.find(({ id }) => id === paymentId);
      if (!payment) throw new NotFoundException('Pago no encontrado');
      if (payment.status === PaymentStatus.REVERSED) return payment;
      if (payment.status !== PaymentStatus.CONFIRMED) {
        throw new ConflictException('Solo se pueden revertir pagos confirmados');
      }

      const handover = payment.method === PaymentMethod.CASH
        ? await tx.cashHandover.findUnique({ where: { paymentId: payment.id } })
        : null;
      let refundSessionId: string | null = null;

      if (handover?.status === CashHandoverStatus.PENDING) {
        const sessionLock = await tx.cashSession.updateMany({
          where: { id: handover.cashSessionId, status: CashSessionStatus.OPEN },
          data: { status: CashSessionStatus.OPEN },
        });
        if (sessionLock.count !== 1) {
          throw new ConflictException('La caja de la entrega ya no está abierta');
        }
        const cancelled = await tx.cashHandover.updateMany({
          where: { id: handover.id, status: CashHandoverStatus.PENDING },
          data: { status: CashHandoverStatus.CANCELLED },
        });
        if (cancelled.count !== 1) {
          throw new ConflictException('La entrega de efectivo ya fue procesada');
        }
        await this.audit.record(tx, {
          businessId: user.businessId,
          locationId: bill.locationId,
          userId: user.userId,
          action: 'CASH_HANDOVER_CANCELLED',
          entityType: 'CashHandover',
          entityId: handover.id,
          metadata: {
            paymentId: payment.id,
            amount: payment.amount.toString(),
            reason: dto.reason.trim(),
            source: 'PAYMENT_REVERSED',
          },
        });
      } else if (handover?.status === CashHandoverStatus.CONFIRMED) {
        const activeSession = await tx.cashSession.findFirst({
          where: { locationId: bill.locationId, status: CashSessionStatus.OPEN },
          select: { id: true },
        });
        if (!activeSession) {
          throw new ConflictException('Abre caja para registrar la salida de efectivo de la reversa');
        }
        const sessionLock = await tx.cashSession.updateMany({
          where: { id: activeSession.id, status: CashSessionStatus.OPEN },
          data: { status: CashSessionStatus.OPEN },
        });
        if (sessionLock.count !== 1) {
          throw new ConflictException('La sesión de caja dejó de estar abierta');
        }
        refundSessionId = activeSession.id;
      } else if (payment.method === PaymentMethod.CASH && !handover) {
        // Pago directo de caja (por ejemplo, TAKEAWAY sin mesero): la reversa
        // debe contrarrestar el SALE que se creó al confirmar el pago.
        const activeSession = await tx.cashSession.findFirst({
          where: { locationId: bill.locationId, status: CashSessionStatus.OPEN },
          select: { id: true },
        });
        if (!activeSession) {
          throw new ConflictException('Abre caja para registrar la devolución del pago en efectivo');
        }
        const sessionLock = await tx.cashSession.updateMany({
          where: { id: activeSession.id, status: CashSessionStatus.OPEN },
          data: { status: CashSessionStatus.OPEN },
        });
        if (sessionLock.count !== 1) {
          throw new ConflictException('La sesión de caja dejó de estar abierta');
        }
        refundSessionId = activeSession.id;
      }

      const reversedAt = new Date();
      const changed = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.CONFIRMED },
        data: {
          status: PaymentStatus.REVERSED,
          reversedAt,
          reversedBy: user.userId,
          reversalReason: dto.reason.trim(),
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('El pago ya fue procesado por otra solicitud');
      }

      let confirmedTotal = new Prisma.Decimal(0);
      for (const item of bill.payments) {
        if (item.id !== payment.id && item.status === PaymentStatus.CONFIRMED) {
          confirmedTotal = confirmedTotal.add(item.amount);
        }
      }
      const billTotal = new Prisma.Decimal(bill.total);
      const nextBillStatus = confirmedTotal.equals(billTotal)
        ? BillStatus.PAID
        : confirmedTotal.greaterThan(0)
          ? BillStatus.PARTIALLY_PAID
          : BillStatus.OPEN;
      await tx.bill.update({ where: { id: bill.id }, data: { status: nextBillStatus } });

      if (refundSessionId) {
        const refundMovement = await tx.cashMovement.create({
          data: {
            cashSessionId: refundSessionId,
            type: 'REFUND',
            amount: payment.amount,
            reason: `Reversa de pago: ${dto.reason.trim()}`,
            reference: payment.id,
            createdBy: user.userId,
          },
        });
        await this.audit.record(tx, {
          businessId: user.businessId,
          locationId: bill.locationId,
          userId: user.userId,
          action: 'CASH_MOVEMENT_REVERSED',
          entityType: 'CashMovement',
          entityId: refundMovement.id,
          metadata: { paymentId: payment.id, amount: payment.amount.toString(), reason: dto.reason.trim() },
        });
      }

      await this.audit.record(tx, {
        businessId: user.businessId,
        locationId: bill.locationId,
        userId: user.userId,
        action: 'PAYMENT_REVERSED',
        entityType: 'Payment',
        entityId: payment.id,
        metadata: {
          billId: bill.id,
          method: payment.method,
          amount: payment.amount.toString(),
          reason: dto.reason.trim(),
          cashMovementCreated: Boolean(refundSessionId),
          cashSessionId: refundSessionId,
        },
      });

      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
  }
}

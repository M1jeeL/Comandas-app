import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma.service.js';

import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

import { CreateDiscountDto } from './dto/create-discount.dto.js';

import { BillStatus, DiscountType } from '../../generated/prisma/enums.js';

import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { serializableTransaction } from '../../common/database/serializable-transaction.js';

@Injectable()
export class DiscountsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /**
   * Busca una Bill verificando que pertenezca
   * al negocio del usuario autenticado.
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
        discounts: true,
        payments: true,
      },
    });

    if (!bill) {
      throw new NotFoundException('Cuenta no encontrada');
    }

    return bill;
  }

  /**
   * Valida si la Bill puede ser modificada.
   */
  private validateBillCanBeModified(bill: {
    status: BillStatus;
    payments: Array<{
      status: string;
    }>;
  }) {
    if (bill.status === BillStatus.VOID) {
      throw new ConflictException('No se puede modificar una cuenta anulada');
    }

    if (bill.status === BillStatus.PAID) {
      throw new ConflictException('No se puede modificar una cuenta pagada');
    }

    const confirmedPayment = bill.payments.some(
      (payment) => payment.status === 'CONFIRMED',
    );

    if (confirmedPayment) {
      throw new ConflictException(
        'No se puede modificar una cuenta que tiene pagos confirmados',
      );
    }
  }

  /**
   * Calcula el monto real del descuento.
   */
  private calculateDiscountAmount(
    subtotal: Prisma.Decimal,
    discountTotal: Prisma.Decimal,
    type: DiscountType,
    value: Prisma.Decimal,
  ): Prisma.Decimal {
    const remainingAmount = subtotal.sub(discountTotal);

    if (remainingAmount.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'La cuenta no tiene saldo disponible para aplicar otro descuento',
      );
    }

    // -----------------------------------------------
    // PORCENTAJE
    // -----------------------------------------------

    if (type === DiscountType.PERCENTAGE) {
      if (value.greaterThan(100)) {
        throw new BadRequestException(
          'El descuento porcentual no puede superar el 100%',
        );
      }

      const amount = remainingAmount.mul(value).div(100);

      return amount.greaterThan(remainingAmount) ? remainingAmount : amount;
    }

    // -----------------------------------------------
    // MONTO FIJO
    // -----------------------------------------------

    if (type === DiscountType.FIXED_AMOUNT) {
      if (value.greaterThan(remainingAmount)) {
        throw new BadRequestException(
          'El descuento no puede superar el monto disponible de la cuenta',
        );
      }

      return value;
    }

    throw new BadRequestException('Tipo de descuento no válido');
  }

  private updateSuggestedTip(
    subtotal: Prisma.Decimal,
    oldDiscountTotal: Prisma.Decimal,
    newDiscountTotal: Prisma.Decimal,
    currentTip: Prisma.Decimal,
  ) {
    const oldSuggested = subtotal.sub(oldDiscountTotal).mul(0.1).toDecimalPlaces(0);
    if (!currentTip.equals(oldSuggested)) return currentTip;
    return subtotal.sub(newDiscountTotal).mul(0.1).toDecimalPlaces(0);
  }

  /**
   * Crear descuento.
   */
  async create(user: JwtUser, billId: string, dto: CreateDiscountDto) {
    return serializableTransaction(this.prisma, async (tx) => {
      const bill = await tx.bill.findFirst({
        where: {
          id: billId,

          location: {
            businessId: user.businessId,
          },
        },

        include: {
          discounts: true,
          payments: true,
        },
      });

      if (!bill) {
        throw new NotFoundException('Cuenta no encontrada');
      }

      this.validateBillCanBeModified(bill);

      const subtotal = new Prisma.Decimal(bill.subtotal);

      const currentDiscountTotal = new Prisma.Decimal(bill.discountTotal);

      const value = new Prisma.Decimal(dto.value);

      if (value.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          'El valor del descuento debe ser mayor que cero',
        );
      }

      // ---------------------------------------------
      // Calcular monto real
      // ---------------------------------------------

      const amount = this.calculateDiscountAmount(
        subtotal,
        currentDiscountTotal,
        dto.type,
        value,
      );

      // ---------------------------------------------
      // Nuevo total
      // ---------------------------------------------

      const newDiscountTotal = currentDiscountTotal.add(amount);

      const tipAmount = this.updateSuggestedTip(
        subtotal,
        currentDiscountTotal,
        newDiscountTotal,
        bill.tipAmount,
      );
      const newTotal = subtotal.sub(newDiscountTotal).add(tipAmount);

      if (newTotal.lessThan(0)) {
        throw new BadRequestException(
          'El total de la cuenta no puede ser negativo',
        );
      }

      // ---------------------------------------------
      // Crear Discount
      // ---------------------------------------------

      const discount = await tx.discount.create({
        data: {
          billId: bill.id,

          type: dto.type,

          value,

          amount,

          reason: dto.reason,

          appliedBy: user.userId,
        },
      });

      // ---------------------------------------------
      // Actualizar Bill
      // ---------------------------------------------

      await tx.bill.update({
        where: {
          id: bill.id,
        },

        data: {
          discountTotal: newDiscountTotal,
          tipAmount,
          total: newTotal,
        },
      });

      await this.audit.record(tx, {
        businessId: user.businessId, locationId: bill.locationId, userId: user.userId,
        action: 'DISCOUNT_APPLIED', entityType: 'Discount', entityId: discount.id,
        metadata: { billId: bill.id, type: discount.type, value: discount.value.toString(), amount: discount.amount.toString(), tipAmount: tipAmount.toString(), reason: discount.reason },
      });

      return {
        discount,

        bill: {
          id: bill.id,

          subtotal,

          discountTotal: newDiscountTotal,

          tipAmount,

          total: newTotal,

          status: bill.status,
        },
      };
    });
  }

  /**
   * Obtener descuentos de una Bill.
   */
  async findAll(user: JwtUser, billId: string) {
    const bill = await this.findBillForUser(user, billId);

    return this.prisma.discount.findMany({
      where: {
        billId: bill.id,
      },

      include: {
        appliedByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },

      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Eliminar un descuento.
   *
   * Esto recalcula nuevamente la cuenta.
   */
  async remove(user: JwtUser, billId: string, discountId: string) {
    return serializableTransaction(this.prisma, async (tx) => {
      const bill = await tx.bill.findFirst({
        where: {
          id: billId,

          location: {
            businessId: user.businessId,
          },
        },

        include: {
          discounts: true,
          payments: true,
        },
      });

      if (!bill) {
        throw new NotFoundException('Cuenta no encontrada');
      }

      this.validateBillCanBeModified(bill);

      const discount = await tx.discount.findFirst({
        where: {
          id: discountId,
          billId: bill.id,
        },
      });

      if (!discount) {
        throw new NotFoundException('Descuento no encontrado');
      }

      const discountAmount = new Prisma.Decimal(discount.amount);

      const currentDiscountTotal = new Prisma.Decimal(bill.discountTotal);

      const newDiscountTotal = currentDiscountTotal.sub(discountAmount);

      if (newDiscountTotal.lessThan(0)) {
        throw new BadRequestException(
          'El descuento acumulado no puede ser negativo',
        );
      }

      const subtotal = new Prisma.Decimal(bill.subtotal);
      const tipAmount = this.updateSuggestedTip(
        subtotal,
        currentDiscountTotal,
        newDiscountTotal,
        bill.tipAmount,
      );
      const newTotal = subtotal.sub(newDiscountTotal).add(tipAmount);

      if (newTotal.lessThan(0)) {
        throw new BadRequestException(
          'El total de la cuenta no puede ser negativo',
        );
      }

      await tx.discount.delete({
        where: {
          id: discount.id,
        },
      });

      await tx.bill.update({
        where: {
          id: bill.id,
        },

        data: {
          discountTotal: newDiscountTotal,
          tipAmount,
          total: newTotal,
        },
      });

      await this.audit.record(tx, {
        businessId: user.businessId, locationId: bill.locationId, userId: user.userId,
        action: 'DISCOUNT_REMOVED', entityType: 'Discount', entityId: discount.id,
        metadata: { billId: bill.id, type: discount.type, amount: discount.amount.toString(), tipAmount: tipAmount.toString(), reason: discount.reason },
      });

      return {
        message: 'Descuento eliminado correctamente',

        bill: {
          id: bill.id,

          subtotal: bill.subtotal,

          discountTotal: newDiscountTotal,

          tipAmount,

          total: newTotal,

          status: bill.status,
        },
      };
    });
  }
}

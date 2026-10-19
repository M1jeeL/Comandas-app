import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.service.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';

function zonedMidnight(date: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  let timestamp = Date.UTC(year, month - 1, day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const adjusted = timestamp + Date.UTC(year, month - 1, day) - representedAsUtc;
    if (adjusted === timestamp) break;
    timestamp = adjusted;
  }

  return new Date(timestamp);
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function sumDecimal(values: Array<Prisma.Decimal | null | undefined>) {
  return values.reduce<Prisma.Decimal>(
    (sum, value) => sum.add(value ?? 0),
    new Prisma.Decimal(0),
  );
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dailyClose(user: JwtUser, locationId: string, date: string) {
    if (!locationId) throw new BadRequestException('locationId es obligatorio');
    if (!date) throw new BadRequestException('date es obligatorio');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('La fecha debe tener formato YYYY-MM-DD');
    }
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('La fecha indicada no es válida');
    }

    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId: user.businessId },
      select: { id: true, name: true, timezone: true, currency: true },
    });
    if (!location) throw new NotFoundException('Sucursal no encontrada');

    let from: Date;
    let to: Date;
    try {
      from = zonedMidnight(date, location.timezone);
      to = zonedMidnight(nextDate(date), location.timezone);
    } catch {
      throw new BadRequestException('La zona horaria de la sucursal no es válida');
    }

    const period = { gte: from, lt: to };
    const [billTotals, billStatuses, paymentStatuses, confirmedPayments, cashSessions] = await Promise.all([
      this.prisma.bill.aggregate({
        where: { locationId, createdAt: period, status: { not: 'VOID' } },
        _count: { _all: true },
        _sum: { subtotal: true, discountTotal: true, tipAmount: true, total: true },
      }),
      this.prisma.bill.groupBy({
        by: ['status'], where: { locationId, createdAt: period }, _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method', 'status'], where: { bill: { locationId }, createdAt: period },
        _sum: { amount: true }, _count: { _all: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method'], where: { bill: { locationId }, status: 'CONFIRMED', confirmedAt: period },
        _sum: { amount: true }, _count: { _all: true },
      }),
      this.prisma.cashSession.findMany({
        where: { locationId, status: 'CLOSED', closedAt: period },
        select: {
          id: true, openedAt: true, closedAt: true, openingAmount: true,
          expectedAmount: true, closingAmount: true, difference: true,
          opener: { select: { firstName: true, lastName: true } },
          closer: { select: { firstName: true, lastName: true } },
        },
        orderBy: { closedAt: 'asc' },
      }),
    ]);

    return {
      date,
      timeZone: location.timezone,
      location: { id: location.id, name: location.name, currency: location.currency },
      period: { from: from.toISOString(), to: to.toISOString() },
      bills: {
        count: billTotals._count._all,
        byStatus: billStatuses.map((item) => ({ status: item.status, count: item._count._all })),
        subtotal: billTotals._sum.subtotal ?? new Prisma.Decimal(0),
        discounts: billTotals._sum.discountTotal ?? new Prisma.Decimal(0),
        tips: billTotals._sum.tipAmount ?? new Prisma.Decimal(0),
        total: billTotals._sum.total ?? new Prisma.Decimal(0),
      },
      payments: {
        registeredByStatus: paymentStatuses.map((item) => ({
          method: item.method, status: item.status,
          count: item._count._all, amount: item._sum.amount ?? new Prisma.Decimal(0),
        })),
        confirmedByMethod: confirmedPayments.map((item) => ({
          method: item.method, count: item._count._all,
          amount: item._sum.amount ?? new Prisma.Decimal(0),
        })),
        confirmedTotal: sumDecimal(confirmedPayments.map((item) => item._sum.amount)),
      },
      cash: {
        closedSessions: cashSessions,
        closedCount: cashSessions.length,
        expectedTotal: sumDecimal(cashSessions.map((session) => session.expectedAmount)),
        countedTotal: sumDecimal(cashSessions.map((session) => session.closingAmount)),
        differenceTotal: sumDecimal(cashSessions.map((session) => session.difference)),
      },
    };
  }
}

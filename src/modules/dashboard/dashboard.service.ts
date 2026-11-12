import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { Role } from '../../generated/prisma/enums.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { localDayBounds } from '../../common/date/local-day.js';
import { DashboardQueryDto } from './dashboard.dto.js';

export const dateShift = (day: string, offset: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400_000)
    .toISOString()
    .slice(0, 10);
export function dateInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
const decimalSum = (values: Array<Prisma.Decimal | number | null>) =>
  values.reduce<Prisma.Decimal>(
    (sum, value) => sum.add(value ?? 0),
    new Prisma.Decimal(0),
  );
export function percentageChange(current: number, previous: number) {
  return previous === 0
    ? null
    : Math.round(((current - previous) / previous) * 1000) / 10;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: JwtUser, query: DashboardQueryDto, now = new Date()) {
    const allowed: Role[] = [
      Role.OWNER,
      Role.ADMIN,
      Role.MANAGER,
      Role.CASHIER,
      Role.WAITER,
    ];
    if (!allowed.includes(user.role))
      throw new ForbiddenException('Tu rol no tiene acceso al dashboard');
    const management = [Role.OWNER, Role.ADMIN, Role.MANAGER] as Role[];
    const canSeeFinance = management.includes(user.role);
    const canSeeCash = canSeeFinance || user.role === Role.CASHIER;
    if (
      user.role !== Role.OWNER &&
      user.role !== Role.ADMIN &&
      query.locationId !== user.locationId
    )
      throw new ForbiddenException('No tienes acceso a este local');
    if (!['today', '7d', '30d'].includes(query.period))
      throw new BadRequestException('Período no válido');
    const location = await this.prisma.location.findFirst({
      where: {
        id: query.locationId,
        businessId: user.businessId,
        status: 'ACTIVE',
      },
      select: { id: true, name: true, timezone: true, currency: true },
    });
    if (!location) throw new NotFoundException('Sucursal no encontrada');
    const days = query.period === 'today' ? 1 : query.period === '7d' ? 7 : 30;
    let today: string;
    let from: Date;
    let to: Date;
    let previousFrom: Date;
    try {
      today = dateInZone(now, location.timezone);
      from = localDayBounds(dateShift(today, 1 - days), location.timezone).gte;
      to = localDayBounds(today, location.timezone).lt;
      previousFrom = localDayBounds(
        dateShift(today, 1 - days * 2),
        location.timezone,
      ).gte;
    } catch {
      throw new BadRequestException('Zona horaria de sucursal no válida');
    }
    const period = { gte: from, lt: to };
    const scope: Prisma.OrderWhereInput = {
      locationId: location.id,
      location: { businessId: user.businessId },
      ...(user.role === Role.WAITER ? { waiterId: user.userId } : {}),
    };
    const active: Prisma.OrderWhereInput = {
      ...scope,
      status: { notIn: ['CLOSED', 'CANCELLED'] },
    };
    const [
      rangeOrders,
      liveStatuses,
      recentOrders,
      tableStatuses,
      openSessions,
      paidTakeaway,
      pendingPayments,
      cancellationRequests,
      cashSession,
      pendingHandovers,
      invalidProducts,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { ...scope, createdAt: period },
        select: { createdAt: true, status: true, type: true },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: active,
        _count: { _all: true },
      }),
      this.prisma.order.findMany({
        where: active,
        orderBy: { createdAt: 'asc' },
        take: 8,
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          customerName: true,
          tableSession: { select: { table: { select: { name: true } } } },
          billOrders: { select: { bill: { select: { status: true } } } },
        },
      }),
      this.prisma.restaurantTable.groupBy({
        by: ['operationalStatus'],
        where: { locationId: location.id, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.tableSession.count({
        where: {
          table: { locationId: location.id },
          status: { in: ['OPEN', 'CLOSING'] },
          ...(user.role === Role.WAITER ? { waiterId: user.userId } : {}),
        },
      }),
      this.prisma.order.count({
        where: {
          ...scope,
          type: 'TAKEAWAY',
          status: { notIn: ['CLOSED', 'CANCELLED', 'DELIVERED'] },
          billOrders: { some: { bill: { status: 'PAID' } } },
        },
      }),
      this.prisma.payment.count({
        where: {
          status: 'PENDING',
          bill: {
            locationId: location.id,
            status: { not: 'VOID' },
            ...(user.role === Role.WAITER
              ? { orders: { some: { order: { waiterId: user.userId } } } }
              : {}),
          },
        },
      }),
      this.prisma.orderItem.count({
        where: { cancellationStatus: 'PENDING', order: scope },
      }),
      canSeeCash
        ? this.prisma.cashSession.findFirst({
            where: { locationId: location.id, status: 'OPEN' },
            select: {
              id: true,
              openedAt: true,
              openingAmount: true,
              opener: { select: { firstName: true, lastName: true } },
              movements: { select: { type: true, amount: true } },
            },
          })
        : null,
      canSeeCash
        ? this.prisma.cashHandover.aggregate({
            where: {
              cashSession: { locationId: location.id },
              status: 'PENDING',
            },
            _count: { _all: true },
            _sum: { amount: true },
          })
        : null,
      canSeeFinance
        ? this.prisma.product.count({
            where: {
              locationId: location.id,
              status: 'ACTIVE',
              OR: [
                { productWorkstations: { none: {} } },
                {
                  productWorkstations: {
                    some: {
                      workstation: {
                        OR: [
                          { status: { not: 'ACTIVE' } },
                          { locationId: { not: location.id } },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          })
        : null,
    ]);
    const statusCount = (status: string) =>
      liveStatuses.find((row) => row.status === status)?._count._all ?? 0;
    const timeline = Array.from({ length: days }, (_, index) => ({
      date: dateShift(today, index + 1 - days),
      orders: 0,
      sales: 0,
    }));
    for (const order of rangeOrders) {
      const bucket = timeline.find(
        (day) => day.date === dateInZone(order.createdAt, location.timezone),
      );
      if (bucket) bucket.orders++;
    }
    const tables = {
      available: 0,
      occupied: 0,
      reserved: 0,
      outOfService: 0,
      total: 0,
    };
    const tableKeys = {
      AVAILABLE: 'available',
      OCCUPIED: 'occupied',
      RESERVED: 'reserved',
      OUT_OF_SERVICE: 'outOfService',
    } as const;
    for (const group of tableStatuses) {
      tables[tableKeys[group.operationalStatus]] += group._count._all;
      tables.total += group._count._all;
    }
    const cash = canSeeCash
      ? {
          open: !!cashSession,
          openedAt: cashSession?.openedAt.toISOString() ?? null,
          opener: cashSession
            ? `${cashSession.opener.firstName} ${cashSession.opener.lastName}`
            : null,
          expected: cashSession
            ? Number(
                cashSession.movements.reduce(
                  (sum, movement) =>
                    ['WITHDRAWAL', 'REFUND'].includes(movement.type)
                      ? sum.sub(movement.amount)
                      : sum.add(movement.amount),
                  new Prisma.Decimal(cashSession.openingAmount),
                ),
              )
            : 0,
          pendingHandovers: pendingHandovers?._count._all ?? 0,
          pendingHandoverAmount: Number(pendingHandovers?._sum.amount ?? 0),
        }
      : null;
    let finance: null | {
      sales: number;
      previousSales: number;
      change: number | null;
      tickets: number;
      averageTicket: number;
      tips: number;
      discounts: number;
      collections: number;
      reversals: number;
      outstanding: number;
      outstandingBills: number;
      methods: Array<{
        method: string;
        count: number;
        collected: number;
        reversed: number;
        net: number;
      }>;
      topProducts: Array<{ id: string; name: string; units: number }>;
    } = null;
    if (canSeeFinance) {
      const [paidBills, confirmed, reversed, unpaidBills, products] =
        await Promise.all([
          this.prisma.bill.findMany({
            where: {
              locationId: location.id,
              status: 'PAID',
              createdAt: { gte: previousFrom, lt: to },
            },
            select: {
              createdAt: true,
              subtotal: true,
              discountTotal: true,
              tipAmount: true,
            },
          }),
          this.prisma.payment.groupBy({
            by: ['method'],
            where: {
              bill: { locationId: location.id },
              status: { in: ['CONFIRMED', 'REVERSED'] },
              confirmedAt: period,
            },
            _count: { _all: true },
            _sum: { amount: true },
          }),
          this.prisma.payment.groupBy({
            by: ['method'],
            where: {
              bill: { locationId: location.id },
              status: 'REVERSED',
              reversedAt: period,
            },
            _sum: { amount: true },
          }),
          this.prisma.bill.findMany({
            where: {
              locationId: location.id,
              status: { in: ['OPEN', 'PARTIALLY_PAID', 'UNPAID'] },
            },
            select: {
              total: true,
              payments: {
                where: { status: 'CONFIRMED' },
                select: { amount: true },
              },
            },
          }),
          this.prisma.orderItem.groupBy({
            by: ['productId', 'productNameSnapshot'],
            where: {
              status: { not: 'CANCELLED' },
              cancellationStatus: { notIn: ['PENDING', 'APPROVED'] },
              order: {
                ...scope,
                status: { not: 'CANCELLED' },
                billOrders: {
                  some: { bill: { status: 'PAID', createdAt: period } },
                },
              },
            },
            _sum: { quantity: true },
          }),
        ]);
      const currentBills = paidBills.filter((bill) => bill.createdAt >= from);
      const oldBills = paidBills.filter((bill) => bill.createdAt < from);
      const net = (bills: typeof paidBills) =>
        Number(
          decimalSum(
            bills.map((bill) => bill.subtotal.sub(bill.discountTotal)),
          ),
        );
      const sales = net(currentBills);
      for (const day of timeline)
        day.sales = net(
          currentBills.filter(
            (bill) =>
              dateInZone(bill.createdAt, location.timezone) === day.date,
          ),
        );
      const methods = ['CASH', 'CARD', 'TRANSFER'].map((method) => {
        const collected = Number(
          confirmed.find((row) => row.method === method)?._sum.amount ?? 0,
        );
        const refund = Number(
          reversed.find((row) => row.method === method)?._sum.amount ?? 0,
        );
        return {
          method,
          count:
            confirmed.find((row) => row.method === method)?._count._all ?? 0,
          collected,
          reversed: refund,
          net: Number(new Prisma.Decimal(collected).sub(refund)),
        };
      });
      const outstanding = unpaidBills.map((bill) =>
        Prisma.Decimal.max(
          0,
          bill.total.sub(
            decimalSum(bill.payments.map((payment) => payment.amount)),
          ),
        ),
      );
      const ranking = new Map<
        string,
        { id: string; name: string; units: number }
      >();
      for (const product of products) {
        const existing = ranking.get(product.productId);
        ranking.set(product.productId, {
          id: product.productId,
          name: existing?.name ?? product.productNameSnapshot,
          units: (existing?.units ?? 0) + Number(product._sum.quantity ?? 0),
        });
      }
      finance = {
        sales,
        previousSales: net(oldBills),
        change: percentageChange(sales, net(oldBills)),
        tickets: currentBills.length,
        averageTicket: currentBills.length
          ? Number(
              new Prisma.Decimal(sales)
                .div(currentBills.length)
                .toDecimalPlaces(2),
            )
          : 0,
        tips: Number(decimalSum(currentBills.map((bill) => bill.tipAmount))),
        discounts: Number(
          decimalSum(currentBills.map((bill) => bill.discountTotal)),
        ),
        collections: Number(decimalSum(methods.map((method) => method.net))),
        reversals: Number(decimalSum(methods.map((method) => method.reversed))),
        outstanding: Number(decimalSum(outstanding)),
        outstandingBills: outstanding.filter((amount) => amount.greaterThan(0))
          .length,
        methods,
        topProducts: [...ranking.values()]
          .sort(
            (a, b) => b.units - a.units || a.name.localeCompare(b.name, 'es'),
          )
          .slice(0, 5),
      };
    }
    return {
      location,
      updatedAt: now.toISOString(),
      period: {
        key: query.period,
        days,
        from: dateShift(today, 1 - days),
        to: today,
      },
      scope: user.role === Role.WAITER ? 'own' : 'location',
      finance,
      cash,
      timeline,
      orders: {
        total: rangeOrders.length,
        cancelled: rangeOrders.filter((order) => order.status === 'CANCELLED')
          .length,
        dineIn: rangeOrders.filter((order) => order.type === 'DINE_IN').length,
        takeaway: rangeOrders.filter((order) => order.type === 'TAKEAWAY')
          .length,
      },
      live: {
        active: liveStatuses.reduce((sum, row) => sum + row._count._all, 0),
        drafts: statusCount('DRAFT'),
        awaitingDelivery:
          statusCount('SENT') +
          statusCount('IN_PROGRESS') +
          statusCount('READY'),
        delivered: statusCount('DELIVERED'),
        paidTakeaway,
        openSessions,
        pendingPayments,
        cancellationRequests,
        invalidProducts,
      },
      tables,
      attentionOrders: recentOrders.map((order) => ({
        id: order.id,
        code: order.id.slice(-6).toUpperCase(),
        label:
          order.tableSession?.table.name ?? order.customerName ?? 'Para llevar',
        type: order.type,
        status: order.status,
        paid: order.billOrders.some((link) => link.bill.status === 'PAID'),
        ageMinutes: Math.max(
          0,
          Math.floor((now.getTime() - order.createdAt.getTime()) / 60_000),
        ),
      })),
    };
  }
}

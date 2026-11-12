import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { Role } from '../../generated/prisma/enums.js';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface.js';
import { AssistantMessageDto } from './dto/assistant-message.dto.js';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { OrderSearchDto } from './dto/order-search.dto.js';
import { localDayBounds } from './assistant-date.js';
import {
  GeminiAssistantService,
  GeminiUnavailable,
  type AssistantToolResult,
} from './gemini-assistant.service.js';

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
const money = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(value);
const managers: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];
const operators: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.MANAGER,
  Role.CASHIER,
  Role.WAITER,
];
const statusLabel: Record<string, string> = {
  DRAFT: 'pendiente de impresión',
  SENT: 'impreso · pendiente de entrega',
  IN_PROGRESS: 'en preparación',
  READY: 'listo para entregar',
  DELIVERED: 'entregado',
  CLOSED: 'cerrado',
  CANCELLED: 'cancelado',
};
const orderSelect = {
  id: true,
  locationId: true,
  type: true,
  status: true,
  customerName: true,
  waiterId: true,
  tableSession: { select: { table: { select: { name: true } } } },
  items: {
    where: { status: { not: 'CANCELLED' as const } },
    select: {
      quantity: true,
      productNameSnapshot: true,
      unitPrice: true,
      status: true,
      product: {
        select: {
          productWorkstations: {
            select: {
              workstation: { select: { locationId: true, status: true } },
            },
          },
        },
      },
      modifiers: { select: { priceDelta: true } },
    },
  },
  billOrders: {
    select: {
      bill: {
        select: {
          status: true,
          total: true,
          _count: {
            select: { payments: { where: { status: 'PENDING' as const } } },
          },
          payments: {
            where: { status: 'CONFIRMED' as const },
            select: { amount: true },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;
type AssistantOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
export interface AssistantAction {
  label: string;
  href: string;
}
export interface AssistantReply {
  text: string;
  actions: AssistantAction[];
  suggestions: string[];
  orderId?: string;
  source: 'manual' | 'live';
  checkedAt: string;
  mode?: 'gemini' | 'basic';
  notice?: string;
}

/** Curated operational help. It only reads scoped data and returns navigation links. */
@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly gemini?: GeminiAssistantService,
  ) {}

  private reply(
    text: string,
    actions: AssistantAction[] = [],
    source: 'manual' | 'live' = 'manual',
    orderId?: string,
  ): AssistantReply {
    return {
      text,
      actions,
      source,
      orderId,
      checkedAt: new Date().toISOString(),
      suggestions: orderId
        ? [
            '¿Qué falta para completar este pedido?',
            '¿Cómo reimprimo el vale de este pedido?',
          ]
        : [
            '¿Cómo hago una venta para llevar?',
            '¿Qué pedidos están pendientes de entrega?',
            'Buscar un pedido por código o cliente',
          ],
    };
  }

  async answer(
    user: JwtUser,
    dto: AssistantMessageDto,
  ): Promise<AssistantReply> {
    if (!operators.includes(user.role))
      throw new ForbiddenException(
        'Tu rol no tiene acceso al asistente operativo',
      );
    if (
      user.role !== Role.OWNER &&
      user.role !== Role.ADMIN &&
      dto.locationId !== user.locationId
    ) {
      throw new ForbiddenException('No tienes acceso a este local');
    }
    const location = await this.prisma.location.findFirst({
      where: {
        id: dto.locationId,
        businessId: user.businessId,
        status: 'ACTIVE',
      },
      select: { id: true, timezone: true },
    });
    if (!location)
      throw new ForbiddenException(
        'El local no pertenece a tu negocio o no está activo',
      );
    if (!dto.message.trim())
      return this.reply(
        'Escribe tu consulta o elige una de las preguntas sugeridas.',
      );
    if (this.gemini) {
      try {
        const response = await this.gemini.respond(
          user,
          dto,
          location.timezone || 'America/Santiago',
          (name, args) =>
            this.executeTool(
              user,
              dto,
              name,
              args,
              location.timezone || 'America/Santiago',
            ),
        );
        const dataResults = response.results.filter(
          (result) => result.kind === 'orders',
        );
        const selected = [...dataResults]
          .reverse()
          .find((result) => result.reply.orderId);
        const actions = [
          ...new Map(
            response.results
              .flatMap((result) => result.reply.actions)
              .map((action) => [action.href, action]),
          ).values(),
        ].slice(0, 12);
        const reply = this.reply(
          response.text,
          actions,
          dataResults.length ? 'live' : 'manual',
          selected?.reply.orderId,
        );
        reply.mode = 'gemini';
        return reply;
      } catch (error) {
        const fallback = await this.basicAnswer(user, dto);
        fallback.mode = 'basic';
        const reason =
          error instanceof GeminiUnavailable ? error.reason : 'unavailable';
        fallback.notice =
          reason === 'quota'
            ? 'Gemini alcanzó un límite de uso. Respuesta en modo básico; intenta de nuevo más tarde.'
            : reason === 'configuration'
              ? 'Gemini no está configurado con una clave y modelo admitidos. Respuesta en modo básico.'
              : reason === 'disabled'
                ? 'La IA está desactivada. Respuesta en modo básico.'
                : reason === 'busy'
                  ? 'El asistente de IA está atendiendo otra consulta. Respuesta en modo básico.'
                  : 'Gemini no respondió a tiempo o no está disponible. Respuesta en modo básico.';
        return fallback;
      }
    }
    return this.basicAnswer(user, dto);
  }

  private async basicAnswer(
    user: JwtUser,
    dto: AssistantMessageDto,
  ): Promise<AssistantReply> {
    const query = normalize(dto.message);
    if (!query)
      return this.reply(
        'Escribe tu consulta o elige una de las preguntas sugeridas.',
      );
    const help = /\b(como|ayuda|pasos|explica|guia)\b/.test(query);
    const contextual = /\b(este|ese|actual|seleccionado)\b/.test(query);
    const print = /imprim|impres|ticket|vale|comanda/.test(query);
    const takeaway = /para llevar|venta en caja/.test(query);

    // Financial operations are never executed through this read-only endpoint.
    if (
      !help &&
      /\b(cobra|cobrar|confirma|confirmar|anula|anular|cancela|cancelar|elimina|eliminar|devuelve|devolver|descuenta|agrega|agregar)\b/.test(
        query,
      ) &&
      !/por que|no puedo|falta/.test(query)
    ) {
      return this.reply(
        'Puedo orientarte y consultar pedidos. Para registrar pagos o modificar una venta, abre el pedido y utiliza sus controles de confirmación.',
        [{ label: 'Ver pedidos', href: '/pedidos' }],
      );
    }
    if (help && takeaway && !contextual) {
      return this.reply(
        'Venta para llevar:\n1. En Pedidos, selecciona Nuevo pedido → Para llevar. Como cajero aparece directamente esa opción.\n2. Agrega productos con cantidades enteras y revisa el detalle.\n3. Selecciona Continuar al cobro y registra y confirma el pago completo.\n4. Se abre la impresión de cocina y del vale del cliente con el mismo código de retiro.\n5. Cuando el cliente retire, marca los productos como entregados. El pedido se cierra al entregar el último.\nSi falla la impresión, usa Imprimir tickets para cocina y cliente sin volver a cobrar.',
        [{ label: 'Ir a pedidos', href: '/pedidos' }],
      );
    }
    if (help && /mesa|mesero/.test(query) && !contextual) {
      if (user.role === Role.CASHIER)
        return this.reply(
          'Como cajero puedes consultar mesas. La apertura y la atención de pedidos de mesa corresponden al personal autorizado. Para una venta directa en caja, crea un pedido para llevar.',
          [{ label: 'Ver pedidos', href: '/pedidos' }],
        );
      return this.reply(
        'Desde Mesas, abre una mesa asignada a tu usuario y crea su pedido. Agrega productos e imprime la comanda. Marca cada producto al entregarlo; después de la entrega puedes generar la cuenta y registrar el pago. Los meseros solo consultan y operan sus propios pedidos.',
        [{ label: 'Ver mesas', href: '/mesas' }],
      );
    }
    if (help && /caja|efectivo/.test(query) && !contextual && !takeaway) {
      return this.reply(
        user.role === Role.WAITER
          ? 'Registra los pagos desde la cuenta del pedido. Si recibes efectivo, la recepción física debe confirmarse en Caja por el personal autorizado.'
          : 'En Caja puedes abrir una sesión, revisar los movimientos y recibir las entregas de efectivo. Para cobrar una venta para llevar, abre el pedido y continúa al cobro. El efectivo cobrado directamente por caja ingresa a su sesión abierta.',
        user.role === Role.WAITER
          ? [{ label: 'Ver pedidos', href: '/pedidos' }]
          : [{ label: 'Abrir Caja', href: '/caja' }],
      );
    }
    if (
      /ventas|vendimos|reporte|utilidad|ganancia/.test(query) &&
      !/venta para llevar|venta en caja/.test(query)
    ) {
      return this.reply(
        managers.includes(user.role)
          ? 'En esta primera etapa consulto pedidos y explico los flujos de MesaPro. Puedes revisar las ventas y el cierre de la sucursal en Reportes.'
          : 'Tu rol no permite consultar reportes de ventas. Puedo ayudarte con tus pedidos y los procedimientos de atención.',
        managers.includes(user.role)
          ? [{ label: 'Ver reportes', href: '/reportes' }]
          : [],
      );
    }
    const uuid = dto.message.match(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    )?.[0];
    const code =
      query.match(
        /(?:#|\b(?:retiro|codigo|pedido)\s+(?:(?:numero|nro)\s+)?)([a-f0-9]{6})\b/,
      )?.[1] ?? (/^[a-f0-9]{6}$/.test(query) ? query : undefined);
    if (help && print && !contextual && !dto.orderId && !code && !uuid) {
      return this.reply(
        'Para llevar: confirma el pago completo y pulsa Imprimir tickets para cocina y cliente en la cuenta del pedido. Si necesitas reimprimir, usa el mismo botón sin volver a cobrar. Permite las ventanas emergentes y selecciona la impresora en el diálogo del navegador.',
        [{ label: 'Ver pedidos', href: '/pedidos' }],
      );
    }
    const explicitSearch =
      /\b(busca|buscar|busco|encuentra|cliente|codigo|retiro)\b/.test(query) ||
      !!uuid ||
      !!code;
    const where: Prisma.OrderWhereInput = {
      locationId: dto.locationId,
      location: { businessId: user.businessId },
      ...(user.role === Role.WAITER ? { waiterId: user.userId } : {}),
    };
    if (
      !uuid &&
      !code &&
      (contextual ||
        (!explicitSearch &&
          /pago|saldo|falta|estado|imprim|ticket|vale|comanda/.test(query)) ||
        (print && !/\b(busca|buscar|busco|encuentra|cliente)\b/.test(query))) &&
      dto.orderId
    ) {
      const order = await this.prisma.order.findFirst({
        where: { ...where, id: dto.orderId },
        select: orderSelect,
      });
      if (!order)
        return this.reply(
          'No encuentro ese pedido entre los que puedes consultar en esta sucursal.',
          [],
          'live',
        );
      return this.describe(order, user, print);
    }
    if (
      /pendiente|por entregar|mis pedidos/.test(query) &&
      !explicitSearch &&
      !contextual
    ) {
      const orders = await this.prisma.order.findMany({
        where: {
          ...where,
          status: { notIn: ['CLOSED', 'CANCELLED', 'DELIVERED'] },
        },
        select: orderSelect,
        orderBy: { createdAt: 'asc' },
        take: 11,
      });
      if (!orders.length)
        return this.reply(
          'No hay pedidos pendientes de entrega entre los que puedes consultar en esta sucursal.',
          [],
          'live',
        );
      return this.reply(
        `Pedidos pendientes de entrega${orders.length > 10 ? ' (muestro los primeros 10)' : ''}:\n${orders
          .slice(0, 10)
          .map(
            (order) =>
              `• #${order.id.slice(-6).toUpperCase()} · ${order.tableSession?.table.name ?? order.customerName ?? 'Para llevar'} · ${statusLabel[order.status] ?? order.status}`,
          )
          .join('\n')}`,
        orders.slice(0, 10).map((order) => ({
          label: `Ver #${order.id.slice(-6).toUpperCase()}`,
          href: `/pedidos?order=${order.id}`,
        })),
        'live',
      );
    }
    if (explicitSearch) {
      if (uuid) {
        const order = await this.prisma.order.findFirst({
          where: { ...where, id: uuid },
          select: orderSelect,
        });
        return order
          ? this.describe(order, user, print)
          : this.reply(
              'No encuentro ese pedido entre los que puedes consultar en esta sucursal.',
              [],
              'live',
            );
      }
      const stopwords = new Set(
        'busca buscar busco encuentra el un una los las pedido pedidos por de del para cliente nombre llamado llamada retiro codigo con'.split(
          ' ',
        ),
      );
      const name = dto.message
        .replace(/[#:¿?"']/g, '')
        .split(/\s+/)
        .filter((word) => !stopwords.has(normalize(word)))
        .join(' ')
        .trim();
      if (!code && (!name || /^(o|o cliente|y cliente)$/.test(name)))
        return this.reply(
          'Escribe el código de retiro, por ejemplo “Busca el pedido ABC123”, o el nombre: “Busca pedidos del cliente Juan”.',
        );
      // UUIDs are matched as text by a parameterized query; names never become SQL.
      const ids = code
        ? await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT o.id FROM "Order" o JOIN "Location" l ON l.id = o."locationId"
        WHERE o."locationId" = ${dto.locationId} AND l."businessId" = ${user.businessId}
        AND RIGHT(o.id::text, 6) = ${code}
        ${user.role === Role.WAITER ? Prisma.sql`AND o."waiterId" = ${user.userId}` : Prisma.empty}
        ORDER BY o."createdAt" DESC LIMIT 11
      `)
        : null;
      const orders = await this.prisma.order.findMany({
        where: {
          ...where,
          ...(ids
            ? { id: { in: ids.map((row) => row.id) } }
            : { customerName: { contains: name, mode: 'insensitive' } }),
        },
        select: orderSelect,
        orderBy: { createdAt: 'desc' },
        take: 11,
      });
      if (!orders.length)
        return this.reply(
          'No encontré pedidos con esos datos en esta sucursal y dentro de tus permisos. Revisa el código o prueba con el nombre del cliente.',
          [],
          'live',
        );
      if (orders.length === 1) return this.describe(orders[0], user, print);
      return this.reply(
        `Encontré varios pedidos${orders.length > 10 ? '; muestro los 10 más recientes' : ''}. Selecciona uno para revisar su estado:\n${orders
          .slice(0, 10)
          .map(
            (order) =>
              `• #${order.id.slice(-6).toUpperCase()} · ${order.customerName ?? order.tableSession?.table.name ?? 'Para llevar'} · ${statusLabel[order.status]}`,
          )
          .join('\n')}`,
        orders.slice(0, 10).map((order) => ({
          label: `Ver #${order.id.slice(-6).toUpperCase()}`,
          href: `/pedidos?order=${order.id}`,
        })),
        'live',
      );
    }
    if (print)
      return this.reply(
        'Para llevar: primero confirma el pago completo. Después utiliza Imprimir tickets para cocina y cliente desde la cuenta del pedido. Permite las ventanas emergentes y selecciona la impresora en el diálogo del navegador. Para una consulta concreta, abre el pedido y pregunta “¿Por qué no puedo imprimir este pedido?”.',
        [{ label: 'Ver pedidos', href: '/pedidos' }],
      );
    if (/producto|cantidad|decimal|catalogo/.test(query))
      return this.reply(
        'Las cantidades deben ser enteras y mayores que cero. Si un producto no aparece, revisa la sucursal y que esté activo. Antes de cobrar un pedido para llevar, todos sus productos deben tener una estación activa de esa sucursal. Los cambios del catálogo requieren un rol de administración.',
        [{ label: 'Ver catálogo', href: '/productos' }],
      );
    return this.reply(
      `Soy el asistente operativo de MesaPro. Puedo explicar las ventas para llevar, las mesas y la impresión; buscar pedidos por código o cliente; y revisar qué falta para completar el pedido que tienes abierto.${dto.page === '/pedidos' ? '\nAbre un pedido y pregunta “¿Qué falta para completar este pedido?”.' : ''}\nPrueba una de las preguntas sugeridas.`,
    );
  }

  private async executeTool(
    user: JwtUser,
    dto: AssistantMessageDto,
    name: string,
    args: Record<string, unknown>,
    timeZone: string,
  ): Promise<AssistantToolResult> {
    if (name === 'get_help') {
      const topics: Record<string, string> = {
        takeaway: 'Cómo hago una venta para llevar',
        tables: 'Cómo creo un pedido de mesa',
        cash: 'Cómo funciona el efectivo en caja',
        printing: 'Cómo reimprimo un vale',
        products: 'Qué hago si no aparece un producto',
        reports: 'Dónde reviso las ventas',
        capabilities: 'Ayuda',
      };
      if (
        Object.keys(args).some((key) => key !== 'topic') ||
        typeof args.topic !== 'string' ||
        !Object.hasOwn(topics, args.topic)
      )
        throw new Error('Tool arguments');
      return {
        kind: 'help',
        reply: await this.basicAnswer(user, {
          ...dto,
          orderId: undefined,
          message: topics[args.topic],
        }),
      };
    }
    if (!['get_order', 'search_orders'].includes(name))
      throw new Error('Tool not allowed');
    const filters = plainToInstance(OrderSearchDto, args);
    await validateOrReject(filters, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    const where: Prisma.OrderWhereInput = {
      locationId: dto.locationId,
      location: { businessId: user.businessId },
      ...(user.role === Role.WAITER ? { waiterId: user.userId } : {}),
    };
    if (name === 'get_order') {
      if (Object.keys(args).some((key) => key !== 'orderId'))
        throw new Error('Tool arguments');
      const id = filters.orderId || dto.orderId;
      if (!id)
        return {
          kind: 'orders',
          reply: this.reply(
            'Abre un pedido o indícame su código o cliente para consultar su detalle.',
            [],
            'live',
          ),
        };
      const order = await this.prisma.order.findFirst({
        where: { ...where, id },
        select: orderSelect,
      });
      return {
        kind: 'orders',
        reply: order
          ? this.describe(order, user, true)
          : this.reply(
              'No encuentro ese pedido entre los que puedes consultar en esta sucursal.',
              [],
              'live',
            ),
      };
    }
    if (filters.orderId) where.id = filters.orderId;
    if (filters.customerName?.trim())
      where.customerName = {
        contains: filters.customerName.trim(),
        mode: 'insensitive',
      };
    if (filters.type) where.type = filters.type;
    if (filters.createdOn)
      where.createdAt = localDayBounds(filters.createdOn, timeZone);
    if (filters.pendingDelivery === true)
      where.status = { notIn: ['CLOSED', 'CANCELLED', 'DELIVERED'] };
    else if (filters.pendingDelivery === false)
      where.status = { in: ['DELIVERED', 'CLOSED'] };
    if (filters.paymentStatus === 'PAID')
      where.billOrders = { some: { bill: { status: 'PAID' } } };
    else if (filters.paymentStatus === 'UNPAID')
      where.billOrders = { none: { bill: { status: 'PAID' } } };
    else if (filters.paymentStatus === 'PENDING')
      where.billOrders = {
        some: {
          bill: {
            status: { not: 'VOID' },
            payments: { some: { status: 'PENDING' } },
          },
        },
      };
    if (filters.pickupCode) {
      const ids = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT o.id FROM "Order" o JOIN "Location" l ON l.id = o."locationId"
        WHERE o."locationId" = ${dto.locationId} AND l."businessId" = ${user.businessId}
        AND RIGHT(o.id::text, 6) = ${filters.pickupCode.toLowerCase()}
        ${user.role === Role.WAITER ? Prisma.sql`AND o."waiterId" = ${user.userId}` : Prisma.empty}
      `);
      const allowed = ids.map((row) => row.id);
      where.id = filters.orderId
        ? { equals: filters.orderId, in: allowed }
        : { in: allowed };
    }
    const orders = await this.prisma.order.findMany({
      where,
      select: orderSelect,
      orderBy: { createdAt: 'desc' },
      take: 11,
    });
    if (!orders.length)
      return {
        kind: 'orders',
        reply: this.reply(
          'No hay pedidos que cumplan todos esos filtros dentro de tus permisos y sucursal.',
          [],
          'live',
        ),
        data: { filters, orders: [], hasMore: false },
      };
    const shown = orders.slice(0, 10);
    const details = shown.map((order) => ({
      id: order.id,
      code: order.id.slice(-6).toUpperCase(),
      customerName: order.customerName,
      type: order.type,
      status: order.status,
      diagnosis: this.describe(order, user, false).text,
    }));
    const reply =
      shown.length === 1
        ? this.describe(shown[0], user, false)
        : this.reply(
            `Encontré ${orders.length > 10 ? 'más de diez' : orders.length} pedidos. Muestro ${shown.length}:\n${shown.map((order) => `• #${order.id.slice(-6).toUpperCase()} · ${order.customerName ?? order.tableSession?.table.name ?? 'Para llevar'} · ${statusLabel[order.status]}`).join('\n')}`,
            shown.map((order) => ({
              label: `Ver #${order.id.slice(-6).toUpperCase()}`,
              href: `/pedidos?order=${order.id}`,
            })),
            'live',
          );
    return {
      kind: 'orders',
      reply,
      data: { filters, orders: details, hasMore: orders.length > 10 },
    };
  }

  private describe(order: AssistantOrder, user: JwtUser, print: boolean) {
    const code = order.id.slice(-6).toUpperCase();
    const bill = order.billOrders
      .map((link) => link.bill)
      .find((bill) => bill.status !== 'VOID');
    const paid = bill?.status === 'PAID';
    const pendingPayment = (bill?._count?.payments ?? 0) > 0;
    const confirmed =
      bill?.payments.reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      ) ?? 0;
    const subtotal = order.items.reduce(
      (sum, item) =>
        sum +
        Number(item.quantity) *
          (Number(item.unitPrice) +
            item.modifiers.reduce(
              (total, modifier) => total + Number(modifier.priceDelta),
              0,
            )),
      0,
    );
    const remaining = Math.max(0, Number(bill?.total ?? subtotal) - confirmed);
    const base = `/pedidos?order=${order.id}`;
    const actions: AssistantAction[] = [{ label: 'Ver pedido', href: base }];
    let next = '';
    if (order.status === 'CANCELLED') next = 'Este pedido está cancelado.';
    else if (order.status === 'CLOSED')
      next =
        'Este pedido está cerrado. Puedes revisar el detalle y, si es para llevar y está pagado, volver a imprimir el vale del cliente.';
    else if (!order.items.length) next = 'Falta agregar productos al pedido.';
    else if (
      order.type === 'TAKEAWAY' &&
      order.status === 'DRAFT' &&
      order.items.some(
        (item) =>
          item.product &&
          (item.product.productWorkstations.length !== 1 ||
            item.product.productWorkstations[0]?.workstation.status !==
              'ACTIVE' ||
            item.product.productWorkstations[0]?.workstation.locationId !==
              order.locationId),
      )
    )
      next =
        'Hay productos sin una estación activa válida. Un encargado debe revisar las estaciones del catálogo antes de cobrar o imprimir.';
    else if (order.type === 'TAKEAWAY' && !paid) {
      next = pendingPayment
        ? 'Hay un pago pendiente de confirmación. Confírmalo o cancélalo desde Cuenta y pago antes de registrar otro. Debes completar el pago antes de imprimir cocina.'
        : `Antes de imprimir cocina debes confirmar el pago completo.${bill ? ' Hay una cuenta pendiente.' : ' Selecciona Continuar al cobro.'}`;
      actions.push({ label: 'Ir al cobro', href: `${base}&focus=billing` });
    } else if (order.items.some((item) => item.status === 'PENDING'))
      next = paid
        ? 'El pedido está pagado. Falta imprimir cocina y el vale del cliente. Usa Imprimir tickets para cocina y cliente; no vuelvas a cobrar.'
        : 'Falta imprimir los productos nuevos para enviarlos a cocina.';
    else if (
      order.items.some(
        (item) => !['DELIVERED', 'CANCELLED'].includes(item.status),
      )
    )
      next =
        'Falta entregar los productos al cliente y marcarlos como entregados. El estado impreso no confirma que cocina haya terminado.';
    else if (!paid) {
      next = 'Los productos están entregados. Falta generar o pagar la cuenta.';
      actions.push({ label: 'Ir al cobro', href: `${base}&focus=billing` });
    } else next = 'El pedido está pagado y los productos están entregados.';
    if (
      order.type === 'TAKEAWAY' &&
      paid &&
      (user.role !== Role.WAITER || order.waiterId === user.userId)
    ) {
      actions.push({
        label: 'Ir a reimprimir vale',
        href: `${base}&focus=billing`,
      });
      if (print)
        next +=
          ' En la sección Cuenta y pago, pulsa Imprimir tickets para cocina y cliente. Se abre el diálogo del navegador; permite las ventanas emergentes si está bloqueado.';
    }
    return this.reply(
      `Pedido #${code} · ${order.type === 'TAKEAWAY' ? 'Para llevar' : 'En mesa'}${order.customerName ? ` · ${order.customerName}` : ''}\nEstado: ${statusLabel[order.status] ?? order.status}.\n${order.items
        .slice(0, 15)
        .map(
          (item) => `• ${Number(item.quantity)} × ${item.productNameSnapshot}`,
        )
        .join(
          '\n',
        )}${order.items.length > 15 ? '\nConsulta el pedido para ver el resto de productos.' : ''}\n${paid ? 'Pago completo confirmado.' : `Saldo ${bill ? 'de la cuenta' : 'estimado, sin cuenta generada'}: ${money(remaining)}.`}\n\n${next}`,
      actions,
      'live',
      order.id,
    );
  }
}

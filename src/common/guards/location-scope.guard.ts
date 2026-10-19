import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma.service.js';
import type { JwtUser } from '../interfaces/jwt-user.interface.js';

/**
 * Enforces the location assigned to a membership for operational endpoints.
 * OWNER/ADMIN are business-wide; all other roles are single-location.
 */
@Injectable()
export class LocationScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const user = request.user;
    // Controller authentication guards run before this guard.
    if (!user) return true;
    if (user.role === Role.OWNER || user.role === Role.ADMIN) return true;

    const locationId = this.explicitLocationId(request);
    if (locationId) await this.assertAssignedLocation(user, locationId);

    const resource = await this.resolveResourceLocation(request);
    if (resource) {
      await this.assertAssignedLocation(user, resource);
      if (locationId && resource !== locationId) throw new ForbiddenException('El recurso no pertenece al local solicitado');
      return true;
    }
    if (locationId) return true;

    // Collection reads/writes without an explicit local are unsafe for scoped roles.
    // Business-level account endpoints are explicitly exempted and protected by RBAC.
    const segments = request.originalUrl.split('?')[0].split('/').filter(Boolean);
    const root = this.routeRoot(segments);
    // The modifier picker currently requests the collection without a location
    // query. Scope that legacy request to the membership's assigned location.
    if (root === 'modifiers' && request.method.toUpperCase() === 'GET') {
      await this.assertAssignedLocation(user, user.locationId);
      return true;
    }
    if (root === 'locations' || root === 'users' || root === 'memberships' || root === 'businesses') {
      return true;
    }
    throw new ForbiddenException('Debes operar dentro del local asignado a tu membresía');
  }

  private explicitLocationId(request: Request): string | undefined {
    const params = request.params as Record<string, string | undefined>;
    const query = request.query as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const value = params.locationId ?? query.locationId ?? body.locationId;
    return typeof value === 'string' ? value : undefined;
  }

  private async assertAssignedLocation(user: JwtUser, locationId: string): Promise<true> {
    if (locationId !== user.locationId) {
      throw new ForbiddenException('No tienes acceso a este local');
    }
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, businessId: user.businessId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!location) throw new ForbiddenException('El local no pertenece a tu negocio o no está activo');
    return true;
  }

  private async resolveResourceLocation(request: Request & { user?: JwtUser }): Promise<string | null> {
    const segments = request.originalUrl.split('?')[0].split('/').filter(Boolean);
    const root = this.routeRoot(segments);
    const params = request.params as Record<string, string | undefined>;
    const query = request.query as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const resourceId = params.billId ?? params.orderId ?? params.cashSessionId ?? params.paymentId ?? params.discountId ?? params.itemId ?? params.comboId ?? params.productId ?? params.workstationId ?? params.tableId ?? params.id
      ?? (root === 'table-sessions' ? body.tableId as string | undefined : undefined)
      ?? (root === 'bills' ? (body.orderIds as string[] | undefined)?.[0] : undefined)
      ?? (root === 'modifiers' ? (body.productId ?? query.productId ?? body.groupId ?? query.groupId) as string | undefined : undefined)
      ?? (root === 'product-workstations' ? (body.productId ?? body.workstationId) as string | undefined : undefined);
    if (!resourceId) return null;

    switch (root) {
      case 'orders': return (await this.prisma.order.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'preparation-tickets': return (await this.prisma.preparationTicket.findFirst({ where: { id: resourceId, order: { location: { businessId: request.user!.businessId } } }, select: { order: { select: { locationId: true } } } }))?.order.locationId ?? null;
      case 'cash-sessions': return (await this.prisma.cashSession.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'cash-handovers': return (await this.prisma.cashHandover.findFirst({ where: { id: resourceId, cashSession: { location: { businessId: request.user!.businessId } } }, select: { cashSession: { select: { locationId: true } } } }))?.cashSession.locationId ?? null;
      case 'cash-movements': return (await this.prisma.cashMovement.findFirst({ where: { id: resourceId, cashSession: { location: { businessId: request.user!.businessId } } }, select: { cashSession: { select: { locationId: true } } } }))?.cashSession.locationId ?? null;
      case 'restaurant-tables': return (await this.prisma.restaurantTable.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'bills': {
        const orderId = ((request.body ?? {}) as { orderIds?: string[] }).orderIds?.[0];
        if (orderId) return (await this.prisma.order.findFirst({ where: { id: orderId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
        return (await this.prisma.bill.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      }
      case 'payments':
      case 'discounts': return (await this.prisma.bill.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'table-sessions': {
        const tableId = ((request.body ?? {}) as { tableId?: string }).tableId;
        if (tableId) return (await this.prisma.restaurantTable.findFirst({ where: { id: tableId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
        return (await this.prisma.tableSession.findFirst({ where: { id: resourceId, table: { location: { businessId: request.user!.businessId } } }, select: { table: { select: { locationId: true } } } }))?.table.locationId ?? null;
      }
      case 'products': return (await this.prisma.product.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'categories': return (await this.prisma.category.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'combos': return (await this.prisma.combo.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'combo-items': {
        const comboId = ((request.body ?? {}) as { comboId?: string }).comboId;
        if (comboId) return (await this.prisma.combo.findFirst({ where: { id: comboId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
        return (await this.prisma.comboItem.findFirst({ where: { id: resourceId, combo: { location: { businessId: request.user!.businessId } } }, select: { combo: { select: { locationId: true } } } }))?.combo.locationId ?? null;
      }
      case 'modifier-groups': return (await this.prisma.modifierGroup.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'modifiers': {
        const productId = (body.productId ?? query.productId) as string | undefined;
        if (productId) return (await this.prisma.product.findFirst({ where: { id: productId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
        const groupId = (body.groupId ?? query.groupId) as string | undefined;
        if (groupId) return (await this.prisma.modifierGroup.findFirst({ where: { id: groupId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
        return (await this.prisma.modifier.findFirst({ where: { id: resourceId, product: { location: { businessId: request.user!.businessId } } }, select: { product: { select: { locationId: true } } } }))?.product.locationId ?? null;
      }
      case 'workstations': return params.locationId ? params.locationId : (await this.prisma.workstation.findFirst({ where: { id: resourceId, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
      case 'discounts': return (await this.prisma.discount.findFirst({ where: { id: resourceId, bill: { location: { businessId: request.user!.businessId } } }, select: { bill: { select: { locationId: true } } } }))?.bill.locationId ?? null;
      case 'product-workstations': {
        const product = params.productId;
        if (product) return (await this.prisma.product.findFirst({ where: { id: product, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null;
        const workstation = params.workstationId;
        return workstation ? (await this.prisma.workstation.findFirst({ where: { id: workstation, location: { businessId: request.user!.businessId } }, select: { locationId: true } }))?.locationId ?? null : null;
      }
      default: return null;
    }
  }

  private routeRoot(segments: string[]): string {
    const roots = ['reports', 'audit-logs', 'users', 'memberships', 'businesses', 'locations', 'products', 'categories', 'combos', 'combo-items', 'modifier-groups', 'modifiers', 'product-workstations', 'workstations', 'restaurant-tables', 'table-sessions', 'orders', 'preparation-tickets', 'bills', 'discounts', 'payments', 'cash-sessions', 'cash-movements', 'cash-handovers'];
    const firstIndex = segments.findIndex((segment) => roots.includes(segment));
    if (firstIndex < 0) return '';
    const first = segments[firstIndex];
    // Nested resource paths must keep their owning module. Only use a child
    // module when the route is intentionally nested under bills or locations.
    if (first === 'bills') {
      const nested = segments.slice(firstIndex + 1).find((segment) => segment === 'payments' || segment === 'discounts');
      if (nested) return nested;
    }
    if (first === 'locations') {
      const nested = segments.slice(firstIndex + 1).find((segment) => segment === 'categories' || segment === 'workstations');
      if (nested) return nested;
    }
    return first;
  }
}

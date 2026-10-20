import { Injectable, type ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard.js';
import { LocationScopeGuard } from './location-scope.guard.js';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUser } from '../interfaces/jwt-user.interface.js';
import { Role } from '../../generated/prisma/enums.js';

/** Authenticates first, then enforces the membership's local scope. */
@Injectable()
export class ScopedJwtAuthGuard extends JwtAuthGuard {
  constructor(private readonly locationScope: LocationScopeGuard) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;
    const scoped = await this.locationScope.canActivate(context);
    if (!scoped) return false;
    this.authorizeOperation(
      context.switchToHttp().getRequest<Request & { user: JwtUser }>(),
    );
    return true;
  }

  private authorizeOperation(request: Request & { user: JwtUser }) {
    if (request.user.role === Role.KITCHEN) {
      throw new ForbiddenException(
        'El personal de cocina no tiene acceso operativo al sistema',
      );
    }
    const segments = request.originalUrl
      .split('?')[0]
      .split('/')
      .filter(Boolean);
    const root = this.routeRoot(segments);
    const action = segments.at(-1) ?? '';
    const method = request.method.toUpperCase();
    const role = request.user.role;
    const owners: Role[] = [Role.OWNER, Role.ADMIN];
    const managers: Role[] = [...owners, Role.MANAGER];
    const floor: Role[] = [...managers, Role.WAITER];
    const cash: Role[] = [...managers, Role.CASHIER];
    const operationalReaders: Role[] = [...cash, Role.WAITER];
    let allowed: Role[] | undefined;

    if (root === 'reports') allowed = managers;
    else if (root === 'audit-logs') allowed = managers;
    else if (root === 'businesses' || root === 'locations') allowed = owners;
    else if (root === 'users' || root === 'memberships') allowed = managers;
    else if (
      root === 'cash-sessions' ||
      root === 'cash-movements' ||
      root === 'cash-handovers' ||
      root === 'payments'
    )
      allowed = root === 'payments' ? [...cash, Role.WAITER] : cash;
    else if (root === 'discounts')
      allowed = method === 'GET' ? [...floor, Role.CASHIER] : managers;
    else if (root === 'bills')
      allowed =
        method === 'GET' ? [...floor, Role.CASHIER] : [...floor, Role.CASHIER];
    else if (root === 'orders')
      allowed = floor.concat(Role.CASHIER);
    else if (root === 'table-sessions') {
      if (method === 'POST') allowed = floor;
      else if (action === 'close') allowed = managers.concat(Role.WAITER);
      else if (action === 'transfer') allowed = managers;
      else allowed = floor.concat(Role.CASHIER);
    }
    else if (root === 'restaurant-tables')
      allowed = method === 'GET' ? operationalReaders : managers;
    else if (
      [
        'products',
        'categories',
        'combos',
        'combo-items',
        'modifier-groups',
        'modifiers',
        'product-workstations',
        'workstations',
      ].includes(root)
    )
      allowed = method === 'GET' ? operationalReaders : managers;

    if (allowed && !allowed.includes(role)) {
      throw new ForbiddenException(
        'Tu rol no tiene permiso para esta operación',
      );
    }

    // Waiters can request/create bills but cannot void bills or manage discounts.
    if (
      role === Role.WAITER &&
      root === 'bills' &&
      method !== 'GET' &&
      action !== 'bills' &&
      action !== 'tip'
    ) {
      throw new ForbiddenException(
        'No tienes permiso para anular cuentas o administrar descuentos',
      );
    }
  }

  private routeRoot(segments: string[]): string {
    const roots = [
      'reports', 'audit-logs', 'users', 'memberships', 'businesses', 'locations',
      'products', 'categories', 'combos', 'combo-items', 'modifier-groups',
      'modifiers', 'product-workstations', 'workstations', 'restaurant-tables',
      'table-sessions', 'orders', 'bills', 'discounts',
      'payments', 'cash-sessions', 'cash-movements', 'cash-handovers',
    ];
    const firstIndex = segments.findIndex((segment) => roots.includes(segment));
    if (firstIndex < 0) return '';
    const first = segments[firstIndex];
    if (first === 'bills') {
      return segments.slice(firstIndex + 1).find((segment) => segment === 'payments' || segment === 'discounts') ?? first;
    }
    if (first === 'locations') {
      return segments.slice(firstIndex + 1).find((segment) => segment === 'categories' || segment === 'workstations') ?? first;
    }
    return first;
  }
}

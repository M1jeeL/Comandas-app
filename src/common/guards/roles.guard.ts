import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../../modules/auth/decorators/roles.decorators.js';
import { JwtUser } from '../interfaces/jwt-user.interface.js';
import { Role } from '../../generated/prisma/enums.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    /**
     * Si el endpoint no declara roles,
     * no aplicamos restricciones RBAC.
     */
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user: JwtUser;
    }>();

    const user = request.user;

    /**
     * El endpoint requiere roles pero
     * no existe usuario autenticado.
     */
    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return requiredRoles.includes(user.role);
  }
}

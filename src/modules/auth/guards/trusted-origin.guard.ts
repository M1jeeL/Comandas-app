import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const configuredUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    const requestOrigin = request.headers.origin;

    if (!requestOrigin) {
      throw new ForbiddenException('Origen de solicitud no permitido');
    }

    try {
      const allowedOrigin = new URL(configuredUrl).origin;
      const origin = new URL(requestOrigin).origin;

      if (origin !== allowedOrigin) {
        throw new ForbiddenException('Origen de solicitud no permitido');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      throw new ForbiddenException('Origen de solicitud no permitido');
    }

    return true;
  }
}

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

    const allowedOrigin = this.config.getOrThrow<string>('FRONTEND_URL');

    const origin = request.headers.origin;

    // if (origin !== allowedOrigin) {
    //   throw new ForbiddenException('Origen de solicitud no permitido');
    // }

    return true;
  }
}

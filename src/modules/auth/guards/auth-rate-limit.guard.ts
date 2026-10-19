import {
  Injectable,
  HttpException,
  HttpStatus,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

type WindowPolicy = { limit: number; durationMs: number };
type Counter = { count: number; resetAt: number };

const policies: Record<string, WindowPolicy> = {
  // TODO: QUITAR EL COMENTARIO Y DEJARLO OPERATIVO PARA PRODUCCION
  // login: { limit: 5, durationMs: 15 * 60 * 1000 },
  // register: { limit: 3, durationMs: 60 * 60 * 1000 },
  // refresh: { limit: 30, durationMs: 60 * 1000 },
};

/** Small fixed-window limiter for public authentication endpoints. */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly counters = new Map<string, Counter>();
  private requestsSinceCleanup = 0;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const endpoint = request.path.split('/').filter(Boolean).at(-1) ?? '';
    const policy = policies[endpoint];
    if (!policy) return true;

    const now = Date.now();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const keys = [`${endpoint}:ip:${ip}`];

    if (endpoint === 'login') {
      const email = (request.body as { email?: unknown } | undefined)?.email;
      if (typeof email === 'string' && email.trim()) {
        const normalizedEmail = createHash('sha256')
          .update(email.trim().toLowerCase())
          .digest('hex');
        keys.push(`${endpoint}:account:${normalizedEmail}`);
      }
    }

    let retryAfterSeconds = 0;
    for (const key of keys) {
      const current = this.counters.get(key);
      const counter =
        !current || current.resetAt <= now
          ? { count: 0, resetAt: now + policy.durationMs }
          : current;
      if (counter.count >= policy.limit) {
        retryAfterSeconds = Math.max(
          retryAfterSeconds,
          Math.ceil((counter.resetAt - now) / 1000),
        );
      }
    }

    if (retryAfterSeconds > 0) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        'Demasiados intentos. Espera antes de volver a intentarlo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    for (const key of keys) {
      const current = this.counters.get(key);
      const counter =
        !current || current.resetAt <= now
          ? { count: 0, resetAt: now + policy.durationMs }
          : current;
      counter.count += 1;
      this.counters.set(key, counter);
    }

    this.requestsSinceCleanup += 1;
    if (this.requestsSinceCleanup >= 500) {
      this.requestsSinceCleanup = 0;
      for (const [key, counter] of this.counters) {
        if (counter.resetAt <= now) this.counters.delete(key);
      }
    }

    return true;
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly prismaService: PrismaService) {}

  async check() {
    const startedAt = Date.now();

    try {
      await this.prismaService.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        database: 'up',
        timestamp: new Date().toISOString(),
        responseTime: `${Date.now() - startedAt}ms`,
      };
    } catch {
      return {
        status: 'error',
        database: 'down',
        timestamp: new Date().toISOString(),
        responseTime: `${Date.now() - startedAt}ms`,
      };
    }
  }
}

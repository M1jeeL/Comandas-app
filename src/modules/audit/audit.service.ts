import { Injectable } from '@nestjs/common';
import { AuditAction } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.service.js';

type AuditTransaction = Prisma.TransactionClient;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: AuditTransaction,
    entry: {
      businessId: string;
      locationId?: string | null;
      userId?: string | null;
      action: AuditAction;
      entityType: string;
      entityId: string;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    await tx.auditLog.create({
      data: {
        ...entry,
        metadata: entry.metadata,
      },
    });
  }

  async findRecent(
    businessId: string,
    filters: { locationId?: string; entityType?: string; entityId?: string; limit?: number },
  ) {
    return this.prisma.auditLog.findMany({
      where: {
        businessId,
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
        ...(filters.entityType ? { entityType: filters.entityType } : {}),
        ...(filters.entityId ? { entityId: filters.entityId } : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Number.isFinite(filters.limit)
        ? Math.min(Math.max(filters.limit as number, 1), 100)
        : 50,
    });
  }
}

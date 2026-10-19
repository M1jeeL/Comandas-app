import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma.service.js';

/** Retries PostgreSQL serialization conflicts for money/state transitions. */
export async function serializableTransaction<T>(
  prisma: PrismaService,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== 'P2034') throw error;
      if (attempt === maxAttempts) {
        throw new ConflictException(
          'La operación tuvo cambios simultáneos. Revisa el estado actual e inténtalo nuevamente.',
        );
      }
    }
  }

  throw new ConflictException('No se pudo completar la operación concurrente');
}

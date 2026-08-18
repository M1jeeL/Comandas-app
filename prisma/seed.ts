import 'dotenv/config';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL no está definida');
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});
async function main() {
  console.log('Iniciando seed...');

  await prisma.plan.upsert({
    where: {
      code: 'FREE',
    },
    update: {},
    create: {
      code: 'FREE',
      name: 'Free',
      description: 'Plan gratuito con funcionalidades limitadas.',
      price: 0,
      maxLocations: 1,
      maxUsers: 2,
      maxProducts: 20,
      active: true,
    },
  });

  await prisma.plan.upsert({
    where: {
      code: 'BASIC',
    },
    update: {},
    create: {
      code: 'BASIC',
      name: 'Basic',
      description: 'Plan básico para restaurantes.',
      price: 9990,
      maxLocations: 1,
      maxUsers: 5,
      maxProducts: null,
      active: true,
    },
  });

  await prisma.plan.upsert({
    where: {
      code: 'PRO',
    },
    update: {},
    create: {
      code: 'PRO',
      name: 'Pro',
      description: 'Plan completo para restaurantes.',
      price: 19990,
      maxLocations: 1,
      maxUsers: 20,
      maxProducts: null,
      active: true,
    },
  });

  console.log('Seed completado');
}

main()
  .catch((error) => {
    console.error('Error ejecutando seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

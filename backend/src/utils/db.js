import { PrismaClient } from '@prisma/client';

function validateDatabaseUrl() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  if (process.env.NODE_ENV === 'production') {
    const unsafeMarkers = ['root:password@', 'change-me', 'localhost:3306/lms_db'];
    if (unsafeMarkers.some(marker => databaseUrl.includes(marker))) {
      throw new Error('DATABASE_URL contains a development placeholder and cannot be used in production.');
    }
  }
}

validateDatabaseUrl();

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

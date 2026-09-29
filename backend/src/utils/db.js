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

// Inject connection pool parameters into DATABASE_URL if not already present.
// The default Prisma MySQL pool is ~5 connections — far too small for 100+ concurrent
// users. With 1000 target concurrency and cluster workers sharing the pool, 100
// connections per worker process is the right starting point (tune DB_POOL_SIZE down
// if the MySQL server's max_connections is a constraint).
function getDatabaseUrl() {
  const raw = String(process.env.DATABASE_URL || '').trim();
  try {
    const url = new URL(raw);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(process.env.DB_POOL_SIZE || '100'));
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', String(process.env.DB_POOL_TIMEOUT || '20'));
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', String(process.env.DB_CONNECT_TIMEOUT || '10'));
    }
    return url.toString();
  } catch {
    return raw;
  }
}

validateDatabaseUrl();

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: { db: { url: getDatabaseUrl() } },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

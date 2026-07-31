import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

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

function createMariaDbAdapter() {
  const databaseUrl = new URL(process.env.DATABASE_URL);

  return new PrismaMariaDb({
    host: databaseUrl.hostname,
    port: databaseUrl.port ? Number(databaseUrl.port) : 3306,
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: databaseUrl.pathname.replace(/^\//, ''),
    connectionLimit: Number(databaseUrl.searchParams.get('connection_limit') || 5),
  });
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter: createMariaDbAdapter(),
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

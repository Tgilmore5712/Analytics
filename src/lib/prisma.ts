import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function getPrismaDatasourceUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  const isPostgres = rawUrl.startsWith('postgres://') || rawUrl.startsWith('postgresql://');
  if (!isPostgres) return rawUrl;

  const defaultConnectionLimit = process.env.NODE_ENV === 'production' ? '3' : '10';
  const connectionLimit = (process.env.PRISMA_CONNECTION_LIMIT || defaultConnectionLimit).trim();
  const poolTimeout = (process.env.PRISMA_POOL_TIMEOUT || '20').trim();

  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', connectionLimit);
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', poolTimeout);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['warn', 'error'],
    datasources: {
      db: {
        url: getPrismaDatasourceUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;


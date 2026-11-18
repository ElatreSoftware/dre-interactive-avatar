import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client per process.
 *
 * Next.js reloads modules on every edit in development, so without the global
 * the dev server opens a new connection pool per save and exhausts Postgres
 * in about a minute.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. See .env.example, and `pnpm db:up`.");
  }
  // Prisma 7 talks to Postgres through a driver adapter rather than its own
  // engine binary.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

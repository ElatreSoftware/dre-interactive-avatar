/**
 * One Prisma client for the command-line tools.
 *
 * Scripts run with `node --env-file=.env`, so the URL is already in the
 * environment by the time this is imported.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Start the database with `pnpm db:up`.");
  process.exit(1);
}

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

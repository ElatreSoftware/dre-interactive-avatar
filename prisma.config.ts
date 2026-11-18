import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 keeps the connection URL out of the schema: the CLI reads it from
 * here, and the application is handed a driver adapter instead.
 *
 * `PRISMA_DATABASE_URL` exists because the CLI's own engine and node-postgres
 * do not agree on TLS parameters. The app connects through node-postgres,
 * which understands `sslrootcert`; Prisma Studio does not, and fails to load
 * any metadata. Set it when those two need to differ, and the app's
 * DATABASE_URL stays untouched.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});

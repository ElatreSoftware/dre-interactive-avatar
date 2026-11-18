/**
 * Prepares a database for the end-to-end run.
 *
 * Its own database, not the development one: the tests delete footprints and
 * assert on exact counts, which would be a lottery if they shared a database
 * with whatever you were doing a moment ago.
 */
import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * A database of its own, on the same server as the application's.
 *
 * This file creates a database and deletes rows, so it must never be the one
 * the application uses. The guard below enforces that rather than trusting
 * whoever edits `.env` next — a test run that wipes the real database is a
 * bad way to learn the difference.
 */
function suffixed(name) {
  return name.endsWith("_e2e") ? name : `${name}_e2e`;
}

function urlFor(database) {
  const base = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) {
    throw new Error("Neither E2E_DATABASE_URL nor DATABASE_URL is set; the tests need a server.");
  }
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

function appDatabase() {
  // `||` rather than `??`: an empty E2E_DATABASE_URL — which is what a
  // commented-out line in .env becomes once someone uncomments it — would
  // otherwise reach `new URL("")` and fail as "Invalid URL".
  const base = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) throw new Error("Neither E2E_DATABASE_URL nor DATABASE_URL is set.");
  return new URL(base).pathname.replace(/^\//, "");
}

const E2E_DATABASE = suffixed(appDatabase());

if (E2E_DATABASE === appDatabase() && !process.env.E2E_DATABASE_URL) {
  throw new Error(`Refusing to run the tests against "${E2E_DATABASE}": it is the application's own database.`);
}

export const E2E_DATABASE_URL = urlFor(E2E_DATABASE);

export default async function globalSetup() {
  // CREATE DATABASE has no IF NOT EXISTS, and "already exists" is the happy
  // path on every run after the first.
  // `postgres` is the maintenance database every server has; CREATE DATABASE
  // cannot run from inside the database being created.
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlFor("postgres") }),
  });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${E2E_DATABASE}"`);
  } catch (error) {
    if (!String(error).includes("already exists")) throw error;
  } finally {
    await admin.$disconnect();
  }

  execFileSync("./node_modules/.bin/prisma", ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  try {
    await prisma.footprint.deleteMany({});
    await prisma.embedKey.upsert({
      where: { key: "pk_e2e_allowed" },
      update: { enabled: true, allowedOrigins: ["http://127.0.0.1:4321"] },
      create: {
        key: "pk_e2e_allowed",
        name: "Acme Corp",
        avatarId: "e2e-avatar",
        allowedOrigins: ["http://127.0.0.1:4321"],
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

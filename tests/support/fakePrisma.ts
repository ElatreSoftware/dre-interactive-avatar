/**
 * A hand-written stand-in for the Prisma client.
 *
 * The alternative — a real Postgres for every unit test — would make the
 * suite slow, order-dependent and unrunnable without Docker. Only the handful
 * of calls the application makes are implemented; anything else should fail
 * loudly rather than quietly return nothing.
 */

export interface FakeEmbedKeyRow {
  key: string;
  name: string;
  enabled: boolean;
  avatarId: string;
  allowedOrigins: string[];
  dynamicVariables: unknown;
  expiresAt: Date | null;
  maxConcurrentSessions: number | null;
}

export interface FakeActiveSessionRow {
  avatarSessionId: string;
  sessionKey: string | null;
  embedKeyValue: string;
  startedAt: Date;
  lastSeenAt: Date;
  deletedAt: Date | null;
}

export interface FakeFootprintRow {
  v: number;
  eventId: string;
  seq: number;
  sessionKey: string;
  avatarSessionId: string | null;
  type: string;
  payload: Record<string, unknown>;
  clientTs: Date;
  receivedAt: Date;
  embedKeyValue: string;
  parentOrigin: string;
  ipHash: string;
  userAgent: string;
}

export const db: {
  keys: FakeEmbedKeyRow[];
  footprints: FakeFootprintRow[];
  activeSessions: FakeActiveSessionRow[];
} = {
  keys: [],
  footprints: [],
  activeSessions: [],
};

export function resetDb(): void {
  db.keys = [];
  db.footprints = [];
  db.activeSessions = [];
}

export function seedKey(overrides: Partial<FakeEmbedKeyRow> = {}): FakeEmbedKeyRow {
  const row: FakeEmbedKeyRow = {
    key: "pk_dre_7f3a91c4",
    name: "Acme Corp",
    enabled: true,
    avatarId: "avatar-acme",
    allowedOrigins: ["https://acme.example"],
    dynamicVariables: null,
    expiresAt: null,
    maxConcurrentSessions: null,
    ...overrides,
  };
  db.keys.push(row);
  return row;
}

/** Set to make the next query reject, for the failure paths. */
export let failNext: Error | null = null;

export function failOnce(error: Error): void {
  failNext = error;
}

function checkFailure(): void {
  if (!failNext) return;
  const error = failNext;
  failNext = null;
  throw error;
}

function matchesReceivedAt(row: FakeFootprintRow, filter?: { lt?: Date; gte?: Date }): boolean {
  if (!filter) return true;
  if (filter.lt && !(row.receivedAt < filter.lt)) return false;
  if (filter.gte && !(row.receivedAt >= filter.gte)) return false;
  return true;
}

function matchesFootprint(
  row: FakeFootprintRow,
  where?: {
    receivedAt?: { lt?: Date; gte?: Date };
    embedKeyValue?: string;
    sessionKey?: string;
    type?: string;
  },
): boolean {
  if (!where) return true;
  if (where.embedKeyValue && row.embedKeyValue !== where.embedKeyValue) return false;
  if (where.sessionKey && row.sessionKey !== where.sessionKey) return false;
  if (where.type && row.type !== where.type) return false;
  return matchesReceivedAt(row, where.receivedAt);
}

export function seedActiveSession(
  overrides: Partial<FakeActiveSessionRow> = {},
): FakeActiveSessionRow {
  const row: FakeActiveSessionRow = {
    avatarSessionId: `sess-${db.activeSessions.length + 1}`,
    sessionKey: null,
    embedKeyValue: "pk_dre_7f3a91c4",
    startedAt: new Date(),
    lastSeenAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
  db.activeSessions.push(row);
  return row;
}

interface ActiveWhere {
  embedKeyValue?: string;
  sessionKey?: string;
  avatarSessionId?: string;
  lastSeenAt?: { lt?: Date };
  startedAt?: { lt?: Date };
  /** Prisma's OR: any one of these, plus everything outside it. */
  OR?: ActiveWhere[];
  /** `null` means "still running"; `{ not: null, lt }` means "closed before". */
  deletedAt?: Date | null | { not?: null; lt?: Date };
}

function matchesDeletedAt(
  row: FakeActiveSessionRow,
  filter: ActiveWhere["deletedAt"],
): boolean {
  if (filter === undefined) return true;
  if (filter === null) return row.deletedAt === null;
  if (filter instanceof Date) return row.deletedAt?.getTime() === filter.getTime();
  if ("not" in filter && filter.not === null && row.deletedAt === null) return false;
  if (filter.lt && !(row.deletedAt && row.deletedAt < filter.lt)) return false;
  return true;
}

function matchesActive(row: FakeActiveSessionRow, where?: ActiveWhere): boolean {
  if (!where) return true;
  if (where.embedKeyValue && row.embedKeyValue !== where.embedKeyValue) return false;
  if (where.sessionKey && row.sessionKey !== where.sessionKey) return false;
  if (where.avatarSessionId && row.avatarSessionId !== where.avatarSessionId) return false;
  if (where.lastSeenAt?.lt && !(row.lastSeenAt < where.lastSeenAt.lt)) return false;
  if (where.startedAt?.lt && !(row.startedAt < where.startedAt.lt)) return false;
  if (where.OR && !where.OR.some((clause) => matchesActive(row, clause))) return false;
  return matchesDeletedAt(row, where.deletedAt);
}

export const prisma = {
  activeSession: {
    async count({ where }: { where?: ActiveWhere } = {}) {
      checkFailure();
      return db.activeSessions.filter((row) => matchesActive(row, where)).length;
    },
    async deleteMany({ where }: { where?: ActiveWhere } = {}) {
      checkFailure();
      const keep = db.activeSessions.filter((row) => !matchesActive(row, where));
      const count = db.activeSessions.length - keep.length;
      db.activeSessions = keep;
      return { count };
    },
    async updateMany({
      where,
      data,
    }: {
      where?: ActiveWhere;
      data: Partial<FakeActiveSessionRow>;
    }) {
      checkFailure();
      let count = 0;
      for (const row of db.activeSessions) {
        if (!matchesActive(row, where)) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    async upsert({
      where,
      create,
      update,
    }: {
      where: ActiveWhere;
      create: Partial<FakeActiveSessionRow> & { avatarSessionId: string; embedKeyValue: string };
      update: Partial<FakeActiveSessionRow>;
    }) {
      checkFailure();
      const existing = db.activeSessions.find((row) => matchesActive(row, where));
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      return seedActiveSession(create);
    },
  },
  embedKey: {
    async findMany({ where }: { where?: { enabled?: boolean } } = {}) {
      checkFailure();
      return db.keys.filter((row) => where?.enabled === undefined || row.enabled === where.enabled);
    },
    async updateMany({
      where,
      data,
    }: {
      where?: { key?: string };
      data: Partial<FakeEmbedKeyRow>;
    }) {
      checkFailure();
      let count = 0;
      for (const row of db.keys) {
        if (where?.key && row.key !== where.key) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
    async findFirst({ where }: { where?: { name?: string } } = {}) {
      checkFailure();
      return db.keys.find((row) => !where?.name || row.name === where.name) ?? null;
    },
    async count({ where }: { where?: { enabled?: boolean } } = {}) {
      checkFailure();
      return db.keys.filter((row) => where?.enabled === undefined || row.enabled === where.enabled)
        .length;
    },
  },
  footprint: {
    async createMany({
      data,
      skipDuplicates,
    }: {
      data: FakeFootprintRow[];
      skipDuplicates?: boolean;
    }) {
      checkFailure();
      let count = 0;
      for (const row of data) {
        const exists = db.footprints.some((stored) => stored.eventId === row.eventId);
        if (exists && skipDuplicates) continue;
        db.footprints.push(row);
        count += 1;
      }
      return { count };
    },
    async deleteMany({ where }: { where?: Parameters<typeof matchesFootprint>[1] } = {}) {
      checkFailure();
      const keep = db.footprints.filter((row) => !matchesFootprint(row, where));
      const count = db.footprints.length - keep.length;
      db.footprints = keep;
      return { count };
    },
    async count({ where }: { where?: Parameters<typeof matchesFootprint>[1] } = {}) {
      checkFailure();
      return db.footprints.filter((row) => matchesFootprint(row, where)).length;
    },
    async findFirst() {
      checkFailure();
      return db.footprints[0] ?? null;
    },
  },
};

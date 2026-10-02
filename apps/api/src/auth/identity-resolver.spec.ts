import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { linkIdentity, resolveActorId, resolveIdentity, type ResolvedIdentity } from "./identity-resolver";

/**
 * `F3.78` / ADR 0089 decision 4 — the one place a token becomes a `bms.users`
 * row. OIDC matches `oidc_subject = sub`, local matches `id = sub`, and neither
 * falls back to the email. `linkIdentity` is the only email read, and it runs
 * only on a verified email (the guard decides that; these cases call it
 * directly).
 *
 * The fake records every `where` it is handed and renders it through Drizzle's
 * own `PgDialect`, so "selects by `oidc_subject`" is a statement about the SQL
 * text, not about which fake method was called.
 */

const ID = "00000000-0000-4000-8000-0000000000a1";
const SUB = "kc-subject-1";

const ROW: ResolvedIdentity = {
  id: ID,
  email: "probe@bms.local",
  displayName: "Probe",
  role: "viewer",
  organizationId: "00000000-0000-4000-8000-0000000000b1",
  oidcSubject: SUB,
  disabledAt: null,
};

type FakeDb = {
  db: BmsDb;
  selects: string[];
  updates: string[];
};

const dialect = new PgDialect();
const render = (where: SQL): string => dialect.sqlToQuery(where).sql;

/** `selectRows` answers each select in turn (the last repeats); `updateRows` answers the link UPDATE. */
function fakeDb(selectRows: ResolvedIdentity[][], updateRows: ResolvedIdentity[] = []): FakeDb {
  const selects: string[] = [];
  const updates: string[] = [];
  let call = 0;
  const select = () => {
    const chain = {
      from: () => chain,
      where: (where: SQL) => {
        selects.push(render(where));
        return chain;
      },
      limit: async () => {
        const rows = selectRows[Math.min(call, selectRows.length - 1)] ?? [];
        call += 1;
        return rows;
      },
    };
    return chain;
  };
  const update = () => {
    const chain = {
      set: () => chain,
      where: (where: SQL) => {
        updates.push(render(where));
        return chain;
      },
      returning: async () => updateRows,
    };
    return chain;
  };
  return { db: { select, update } as unknown as BmsDb, selects, updates };
}

function token(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: SUB, email: "Probe@BMS.local", name: "Probe", role: "viewer", ...overrides };
}

/** Runs `fn` under the named auth mode, restoring the two variables that decide it. */
async function inMode(mode: "oidc" | "local", fn: () => Promise<void>): Promise<void> {
  const saved = { AUTH_MODE: process.env.AUTH_MODE, OIDC_ISSUER: process.env.OIDC_ISSUER };
  process.env.AUTH_MODE = mode;
  delete process.env.OIDC_ISSUER;
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export async function assertOidcSelectsBySubjectNotEmail(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[ROW]]);
    await resolveIdentity(fake.db, token());
    expect(fake.selects).toHaveLength(1);
    expect(fake.selects[0]).toContain('"oidc_subject" = $1');
    expect(fake.selects[0]).not.toContain('"email"');
  });
}

export async function assertLocalSelectsById(): Promise<void> {
  await inMode("local", async () => {
    const fake = fakeDb([[ROW]]);
    await resolveIdentity(fake.db, token({ sub: ID }));
    expect(fake.selects).toHaveLength(1);
    expect(fake.selects[0]).toContain('"id" = $1');
    expect(fake.selects[0]).not.toContain('"email"');
    expect(fake.selects[0]).not.toContain('"oidc_subject"');
  });
}

export async function assertLinkWithNoRowReReadsAndReturnsNull(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[]], []);
    const linked = await linkIdentity(fake.db, token({ emailVerified: true }));
    expect(linked).toBeNull();
    expect(fake.updates).toHaveLength(1);
    expect(fake.selects).toHaveLength(1);
    expect(fake.selects[0]).toContain('"oidc_subject" = $1');
  });
}

export async function assertLinkWithNoRowReturnsAConcurrentLink(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[ROW]], []);
    const linked = await linkIdentity(fake.db, token({ emailVerified: true }));
    expect(linked).toEqual(ROW);
  });
}

export async function assertLinkWithOneRowReturnsIt(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[]], [ROW]);
    const linked = await linkIdentity(fake.db, token({ emailVerified: true }));
    expect(linked).toEqual(ROW);
    expect(fake.selects).toHaveLength(0);
    expect(fake.updates[0]).toContain('lower("bms"."users"."email") = $');
    expect(fake.updates[0]).toContain('"oidc_subject" is null');
  });
}

export async function assertLinkThrowsOnTwoRows(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[]], [ROW, { ...ROW, id: "00000000-0000-4000-8000-0000000000a2" }]);
    await expect(linkIdentity(fake.db, token({ emailVerified: true }))).rejects.toThrow(
      "linked 2 bms.users rows",
    );
  });
}

export async function assertLinkRefusesAnUnverifiedEmail(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[]], [ROW]);
    const linked = await linkIdentity(fake.db, token({ emailVerified: false }));
    expect(linked).toBeNull();
    expect(fake.updates).toHaveLength(0);
  });
}

export async function assertMemoSkipsTheDbOnTheSecondCall(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[ROW]]);
    const jwt = token();
    await resolveIdentity(fake.db, jwt);
    const second = await resolveIdentity(fake.db, jwt);
    expect(second).toEqual(ROW);
    expect(fake.selects).toHaveLength(1);
  });
}

export async function assertACopiedPayloadMissesTheMemo(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[ROW]]);
    const jwt = token();
    await resolveIdentity(fake.db, jwt);
    await resolveIdentity(fake.db, { ...jwt });
    expect(fake.selects).toHaveLength(2);
  });
}

export async function assertResolveActorIdReadsTheMemo(): Promise<void> {
  await inMode("oidc", async () => {
    const fake = fakeDb([[ROW]]);
    const jwt = token();
    await resolveIdentity(fake.db, jwt);
    expect(await resolveActorId(fake.db, jwt)).toBe(ID);
    expect(fake.selects).toHaveLength(1);
  });
}

export async function assertLocalNonUuidSubjectIsNullWithoutAQuery(): Promise<void> {
  await inMode("local", async () => {
    const fake = fakeDb([[ROW]]);
    expect(await resolveIdentity(fake.db, token({ sub: "not-a-uuid" }))).toBeNull();
    expect(fake.selects).toHaveLength(0);
  });
}

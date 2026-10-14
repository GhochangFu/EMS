import { randomBytes } from "node:crypto";

import { ServiceUnavailableException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { CREDENTIAL_KEY_ENV } from "@bms/shared";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { OnboardingCommitService } from "./onboarding-commit.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

/**
 * `F4.258` (ADR 0099 Amendment 2, owner option A) — the commit's own update,
 * the one that sets `status: "committed"`, also removes `_secrets` from
 * `draft`. Assertions live here (ADR 0014); the `.test` sibling runs them.
 *
 * The harness drives the real `commit()` through a recording transaction, not
 * a helper that builds the patch: a test of an extracted patch object stays
 * green when the commit stops using it. Every `.set()` argument is recorded,
 * and the claim is made about the one whose `status` is `committed`, so moving
 * the strip into a separate update reddens it too.
 *
 * The real database proof — the committed row holds no `_secrets`, the
 * `rtu_connection_configs` row holds the ciphertext, an open draft keeps its
 * own — is `onboarding-commit.strip-secrets.integration.spec.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const JWT: JwtPayload = {
  sub: "u-1",
  email: "someone@bms.local",
  name: "someone",
  role: "admin",
};

/** A location-only draft: the commit writes the location and the session, nothing else. */
const DRAFT = {
  location: {
    code: "SS-1",
    slug: "ss-1",
    name: "Strip secrets",
    type: "pump_station",
    latitude: 26.1,
    longitude: 89.4,
  },
  _secrets: { "RTU-1": { c: "Y2lwaGVy", iv: "aXY=", v: 1 } },
} as unknown as OnboardingDraft;

/**
 * A transaction whose every builder method returns itself and whose `await`
 * resolves to one stub row. Only `.set()` is recorded.
 */
function recordingTx(sets: Record<string, unknown>[]): unknown {
  const row = { id: "row-1", code: "ORG" };
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void) => resolve([row]);
        }
        return (...args: unknown[]) => {
          if (prop === "set") {
            sets.push(args[0] as Record<string, unknown>);
          }
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function buildService(
  sets: Record<string, unknown>[],
  draft: OnboardingDraft = DRAFT,
  onTransaction?: () => void,
): OnboardingCommitService {
  const session = { id: "s-1", organizationId: "org-1", status: "draft", draft };
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([session]),
  };
  const fleetDb = { select: () => chain } as never;
  const tenantDb = {
    transaction: (fn: (inner: unknown) => Promise<unknown>) => {
      onTransaction?.();
      return fn(recordingTx(sets));
    },
  } as never;
  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageOrganization: () => Promise.resolve(true),
  } as never;
  const validateService = {
    validate: () => ({ valid: true, errors: [], readyToCommit: true, suggestedPhase: "review" }),
  } as never;
  const vocabularies = {
    assertAssetDomain: () => Promise.resolve(),
    listLocationTypes: () => Promise.resolve([]),
    assertLocationType: () => Promise.resolve(),
  } as never;
  const audit = { write: () => Promise.resolve() } as never;

  return new OnboardingCommitService(
    fleetDb,
    tenantDb,
    accessControl,
    audit,
    validateService,
    vocabularies,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    // F3.22: the three template services; this draft holds no template, so none is called.
    {} as never,
    {} as never,
    {} as never,
  );
}

/** The SQL text drizzle renders for one `.set()` value. */
function rendered(value: unknown): string {
  return new PgDialect().sqlToQuery(value as SQL).sql;
}

/**
 * S1 — the update that marks the session committed also rewrites `draft` as
 * `draft - '_secrets'`, the jsonb minus-key operator on the stored column.
 */
export async function assertTheCommittedUpdateStripsTheDraftSecrets(): Promise<void> {
  const sets: Record<string, unknown>[] = [];
  await buildService(sets).commit(JWT, "s-1");
  const committed = sets.filter((set) => set.status === "committed");
  assert(committed.length === 1, `expected one committed update, got ${committed.length}`);
  const draft = committed[0].draft;
  assert(draft !== undefined, "the committed update does not set draft, so _secrets stays on the row");
  const text = rendered(draft);
  assert(
    text === `"bms"."onboarding_sessions"."draft" - '_secrets'`,
    `expected the committed update to set draft to the column minus '_secrets', got ${text}`,
  );
}

/** A draft with one RTU, `RTU-1`; `withBlob` decides whether `_secrets` holds its credential. */
function rtuDraft(withBlob: boolean): OnboardingDraft {
  return {
    location: (DRAFT as unknown as { location: unknown }).location,
    rtus: [{ code: "RTU-1", displayName: "RTU 1", protocol: "mqtt", config: {} }],
    ...(withBlob ? { _secrets: { "RTU-1": { c: "Y2lwaGVy", iv: "aXY=", v: 1 } } } : {}),
  } as unknown as OnboardingDraft;
}

const KEY_NAMES = [CREDENTIAL_KEY_ENV.current, CREDENTIAL_KEY_ENV.previous, CREDENTIAL_KEY_ENV.version];

/** Runs `body` with the credential key set (`true`) or unset (`false`), then restores the environment. */
async function withKey(loaded: boolean, body: () => Promise<void>): Promise<void> {
  const saved = KEY_NAMES.map((name) => [name, process.env[name]] as const);
  for (const name of KEY_NAMES) {
    delete process.env[name];
  }
  if (loaded) {
    process.env[CREDENTIAL_KEY_ENV.current] = randomBytes(32).toString("base64");
  }
  try {
    await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

/** The sentinel a test transaction throws once it has proved the guard let the commit through. */
const OPENED = new Error("F4.258 test: the transaction opened");

/** Commits `draft` and reports whether the transaction opened and what was thrown. */
async function commitOutcome(draft: OnboardingDraft): Promise<{ opened: boolean; error: unknown }> {
  let opened = false;
  const service = buildService([], draft, () => {
    opened = true;
    throw OPENED;
  });
  try {
    await service.commit(JWT, "s-1");
    return { opened, error: null };
  } catch (error) {
    return { opened, error };
  }
}

/**
 * S2 — with no key loaded, a draft whose RTU has a blob is refused with 503
 * before the transaction opens: the strip would otherwise erase a credential
 * the RTU loop could not copy.
 */
export async function assertAnUnkeyedCommitWithABlobIsRefused(): Promise<void> {
  await withKey(false, async () => {
    const { opened, error } = await commitOutcome(rtuDraft(true));
    assert(error instanceof ServiceUnavailableException, `expected a 503, got ${String(error)}`);
    assert(!opened, "the transaction opened before the 503");
  });
}

/** S3 — with no key loaded, a draft whose RTU has no blob still reaches the transaction. */
export async function assertAnUnkeyedCommitWithoutABlobProceeds(): Promise<void> {
  await withKey(false, async () => {
    const { opened, error } = await commitOutcome(rtuDraft(false));
    assert(opened && error === OPENED, `expected the transaction to open, got ${String(error)}`);
  });
}

/** S4 — with a key loaded, a draft whose RTU has a blob reaches the transaction. */
export async function assertAKeyedCommitWithABlobProceeds(): Promise<void> {
  await withKey(true, async () => {
    const { opened, error } = await commitOutcome(rtuDraft(true));
    assert(opened && error === OPENED, `expected the transaction to open, got ${String(error)}`);
  });
}

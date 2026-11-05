import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { MasterDataAuditService } from "../master-data-audit.service";
import { PointKeyStatesAdminService } from "./point-key-states.service";

/**
 * `F4.309` / ADR 0088 Amendment 3 decisions 2–4 (plan C7–C9) — the gate order before any read:
 * `requireGlobalAdmin` (403), then the body (400), then — on create — the seeded pair (409), and
 * on update an empty body (400). Each case runs on a database stub that fails the test if it is
 * touched at all, so "refused before the database" is the claim, not a side effect. The 404, the
 * row-level 409s and the writes need Postgres: `point-key-states.integration.spec.ts`.
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const JWT = { sub: "u", email: "someone@bms.local", role: "admin" } as unknown as JwtPayload;
const ID = "00000000-0000-4000-8000-000000000001";

function serviceWith(globalAdmin: boolean, touched: string[]): PointKeyStatesAdminService {
  const db = new Proxy(
    {},
    {
      get: (_target, prop) => {
        touched.push(`db.${String(prop)}`);
        throw new Error(`the database was touched (${String(prop)})`);
      },
    },
  ) as unknown as BmsDb;
  const accessControl = {
    requireMasterDataUser: async () => ({}),
    isGlobalAdmin: async () => globalAdmin,
  } as unknown as AccessControlService;
  const audit = {} as unknown as MasterDataAuditService;
  return new PointKeyStatesAdminService(db, accessControl, audit);
}

const outcome = (run: () => Promise<unknown>): Promise<string> =>
  run().then(
    () => "resolved",
    (err: unknown) =>
      err instanceof ForbiddenException
        ? "403"
        : err instanceof BadRequestException
          ? "400"
          : err instanceof ConflictException
            ? "409"
            : `other: ${String(err)}`,
  );

/** A non-global-admin is 403 on every route, a malformed body included, before the database. */
export async function aNonGlobalAdminIs403FirstOnEveryRoute(): Promise<void> {
  const touched: string[] = [];
  const svc = serviceWith(false, touched);
  expect(await outcome(() => svc.list(JWT))).toBe("403");
  expect(await outcome(() => svc.create(JWT, { nonsense: true }))).toBe("403");
  expect(await outcome(() => svc.update(JWT, ID, { value: 3 }))).toBe("403");
  expect(await outcome(() => svc.remove(JWT, ID))).toBe("403");
  expect(touched).toEqual([]);
}

/** A global admin's malformed body is a 400 (a `BadRequestException`), before the database. */
export async function aMalformedBodyIs400BeforeTheDatabase(): Promise<void> {
  const touched: string[] = [];
  const svc = serviceWith(true, touched);
  expect(await outcome(() => svc.create(JWT, { pointKey: "breaker_aux", value: 2, label: "", tone: "open" }))).toBe("400");
  expect(await outcome(() => svc.update(JWT, ID, { pointKey: "breaker_main" }))).toBe("400");
  expect(touched).toEqual([]);
}

/** A `POST` of a seeded pair is 409 before the database (decision 3). */
export async function aSeededPairPostIs409BeforeTheDatabase(): Promise<void> {
  const touched: string[] = [];
  const svc = serviceWith(true, touched);
  const run = svc.create(JWT, { pointKey: "breaker_main", value: 1, label: "SHUT", tone: "open" });
  await expect(run).rejects.toBeInstanceOf(ConflictException);
  await expect(run).rejects.toThrow(/breaker_main/);
  expect(touched).toEqual([]);
}

/** An empty `PATCH` body is 400 before the database (plan C9). */
export async function anEmptyPatchIs400BeforeTheDatabase(): Promise<void> {
  const touched: string[] = [];
  const svc = serviceWith(true, touched);
  await expect(svc.update(JWT, ID, {})).rejects.toBeInstanceOf(BadRequestException);
  expect(touched).toEqual([]);
}

/**
 * Review fix (security Low 2) — the update audit row carries the old label and tone beside the
 * new ones, `{ from, to }` (the `asset-groups` role-change and `organizations` colour-profile
 * idiom), and the old values are read inside the write's own transaction, locked, not from the
 * 404/409 read before it. A fake executor answers the row and records what the audit was handed.
 */
export async function theUpdateAuditCarriesTheOldValues(): Promise<void> {
  const STORED = { id: ID, pointKeyCode: "f4-309-key", value: 2, label: "EARTHED", tone: "open" };
  const events: string[] = [];
  const chainFor = (where: string, rows: () => unknown[]) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      for: (strength: string) => {
        events.push(`${where} for ${strength}`);
        return chain;
      },
      set: (values: unknown) => {
        events.push(`${where} set ${JSON.stringify(values)}`);
        return chain;
      },
      returning: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) => {
        events.push(`${where} read`);
        return Promise.resolve(rows()).then(resolve);
      },
    };
    return chain;
  };
  // Outside the transaction the row reads as it was; inside, a concurrent edit has landed: the
  // audit must name the label the transaction actually replaced.
  const tx = {
    select: () => chainFor("tx.select", () => [{ ...STORED, label: "CONCURRENT" }]),
    update: () => chainFor("tx.update", () => [{ ...STORED, label: "CONCURRENT", tone: "tripped" }]),
  };
  const db = {
    select: () => chainFor("db.select", () => [STORED]),
    transaction: async (run: (t: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as BmsDb;
  const audited: unknown[] = [];
  const audit = {
    write: async (input: { payload?: unknown }, executor: unknown) => {
      events.push(`audit ${executor === tx ? "in tx" : "outside tx"}`);
      audited.push(input.payload);
    },
  } as unknown as MasterDataAuditService;
  const accessControl = {
    requireMasterDataUser: async () => ({}),
    isGlobalAdmin: async () => true,
  } as unknown as AccessControlService;

  await new PointKeyStatesAdminService(db, accessControl, audit).update(JWT, ID, { tone: "tripped" });

  expect(audited).toEqual([{ from: { label: "CONCURRENT", tone: "open" }, to: { tone: "tripped" } }]);
  // The old values are read and locked in the transaction before the update writes.
  const lock = events.indexOf("tx.select for update");
  expect(lock, `events: ${events.join(" | ")}`).toBeGreaterThan(-1);
  expect(lock).toBeLessThan(events.findIndex((e) => e.startsWith("tx.update set")));
  expect(events).toContain("audit in tx");
}

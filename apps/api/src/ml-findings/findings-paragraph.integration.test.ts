import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { CopilotAvailabilityService } from "../copilot/copilot-availability.service";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import type { LlmProvider, LlmReply } from "../llm/llm-port";
import { LlmResolver } from "../llm/llm-resolver";
import { MlFindingsService } from "../ml/ml-findings.service";
import { HOUR_MS } from "../ml/ml-forecasts.pure";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../testing/seeded-subjects";
import { FindingsParagraphController } from "./findings-paragraph.controller";
import {
  assertAGlobalWriteLandsUnderTheCardsOrganization,
  assertARetryReplacesAndRetentionDeletes,
  assertFirstPendingThenOkInPlaceholderForm,
  assertTheDailyCapIsNoneWithNoCall,
  assertTheLocationAdminHasItsOwnKey,
  assertTheSameFactsInTwoOrganizationsAreTwoRows,
  assertTheSwitchOffIsNoneWithNoRow,
  type ParagraphFixtures,
} from "./findings-paragraph.integration.spec";
import { FindingsParagraphService } from "./findings-paragraph.service";

/**
 * `E1.9c` (plan T3.4) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. The cache and the
 * copilot switch read on `bms_tenant`, the facts on `bms_tenant` / `bms_fleet`,
 * access control on `bms_auth`.
 *
 * The scores are written as `bms_fleet` (the scorer's role); the cache rows a
 * case plants, and the copilot switch, on the superuser connection. The switch
 * of both organizations is turned on for the run and put back as it was. The
 * findings model variables point at a fake provider handed in through
 * `LlmResolver.buildProvider` — no live LLM. Every code carries the run's
 * `e19c-<stamp>`; the cleanup is by the ids and hashes created, never a prefix
 * sweep (`tests/integration-fixture-isolation`). All data is synthetic.
 */
const connectionString = requireIntegrationDb({
  item: "E1.9c",
  label: "the findings paragraph (cache isolation, the cap, the switch, retention, a retry)",
  because:
    "the cache key per organization, the row security of bms.ml_finding_paragraphs, the copilot switch read, " +
    "the daily sum of attempts and the 14-day delete are all SQL over real rows; a green run without a database " +
    "asserts none of them.",
});

const ENV = {
  ML_FINDINGS_LLM_PROVIDER: "openrouter",
  ML_FINDINGS_LLM_MODEL: "fake/findings-model",
  OPENROUTER_API_KEY: "fake-findings-key",
} as const;

/** A paragraph that passes the guard on any fixture card: no number, the first asset, the word "weak". */
const REPLY: LlmReply = { kind: "final", text: "[A1] leads the unusual hours; marks from the Baseline method alone are a weak signal." };

describe.skipIf(!connectionString)("E1.9c — the findings paragraph against Postgres", () => {
  let fleet: pg.Pool;
  let superuser: pg.Pool;
  let tenant: pg.Pool;
  let auth: pg.Pool;
  let ctx: ParagraphFixtures;
  const stamp = randomUUID().slice(0, 8);
  const runIds: string[] = [];
  const assetIds: string[] = [];
  const locationIds: string[] = [];
  const hashes = new Set<string>();
  const savedEnv: Record<string, string | undefined> = {};
  let savedSwitches: Array<{ organization_id: string; enabled: boolean }> = [];
  let organizations: string[] = [];
  let providerCalls = 0;

  beforeAll(async () => {
    for (const [name, value] of Object.entries(ENV)) {
      savedEnv[name] = process.env[name];
      process.env[name] = value;
    }
    const url = connectionString as string;
    fleet = await openIntegrationPool(url, "E1.9c");
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(process.env.DATABASE_URL as string, "superuser", process.env), "E1.9c");
    tenant = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "E1.9c");
    auth = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E1.9c");
    await primeSeededSubjects(fleet);
    const fleetDb = createDb(fleet);
    const tenantDb = createDb(tenant);
    const accessControl = new AccessControlService(createDb(auth), fleetDb);
    const locationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");

    const closure = (await accessControl.writableLocationIds(locationAdmin)) ?? [];
    const { rows: mineRows } = await fleet.query<{ id: string; organization_id: string; type: string }>(
      "SELECT id, organization_id, type FROM bms.locations WHERE id = ANY($1::uuid[]) ORDER BY created_at, code LIMIT 1",
      [closure],
    );
    const mine = mineRows[0];
    if (!mine) throw new Error(`E1.9c: ${SEEDED.locationAdmin} has no writable location — run pnpm db:seed.`);
    const { rows: orgRows } = await fleet.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE code = 'PHEWB' AND id <> $1",
      [mine.organization_id],
    );
    const orgA = mine.organization_id;
    const orgB = orgRows[0]?.id;
    if (!orgB) throw new Error("E1.9c: the seed lacks the PHEWB organization — run pnpm db:seed.");
    organizations = [orgA, orgB];
    const { rows: own } = await superuser.query("SELECT 1 FROM bms.organization_llm_settings WHERE organization_id = ANY($1::uuid[])", [organizations]);
    if (own.length > 0) throw new Error("E1.9c: a fixture organization has its own LLM setting; this suite expects the findings variables to apply.");

    const { rows: switches } = await superuser.query<{ organization_id: string; enabled: boolean }>(
      "SELECT organization_id, enabled FROM bms.copilot_org_settings WHERE organization_id = ANY($1::uuid[])",
      [organizations],
    );
    savedSwitches = switches;
    const setSwitch = async (organizationId: string, on: boolean): Promise<void> => {
      await superuser.query(
        `INSERT INTO bms.copilot_org_settings (organization_id, enabled) VALUES ($1, $2)
         ON CONFLICT (organization_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
        [organizationId, on],
      );
    };
    for (const organizationId of organizations) await setSwitch(organizationId, true);

    const { rows: locRows } = await fleet.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $2, $3, $4, 0, 0) RETURNING id`,
      [orgA, `e19c-${stamp}-other`, `E1.9c other ${stamp}`, mine.type],
    );
    const other = locRows[0]!.id;
    locationIds.push(other);
    const { rows: bLoc } = await fleet.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
       VALUES ($1, $2, $2, $3, $4, 0, 0) RETURNING id`,
      [orgB, `e19c-${stamp}-b`, `E1.9c b ${stamp}`, mine.type],
    );
    locationIds.push(bLoc[0]!.id);

    const { rows: dom } = await fleet.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true ORDER BY created_at, code LIMIT 1");
    const { rows: keyRows } = await fleet.query<{ code: string }>("SELECT code FROM bms.point_keys ORDER BY created_at, code LIMIT 1");
    if (!keyRows[0]) throw new Error("E1.9c: the point-key catalog is empty — run pnpm db:migrate.");
    const pointKey = keyRows[0].code;
    const asset = async (suffix: string, org: string, locId: string): Promise<string> => {
      const { rows } = await fleet.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain)
         VALUES ($1, $2, $3, 'E1.9c site', $4, $5) RETURNING id`,
        [org, `e19c-${stamp}-${suffix}`, `E1.9c asset ${suffix}`, locId, dom[0]!.code],
      );
      assetIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const assets = {
      aMine: await asset("a-mine", orgA, mine.id),
      aOther: await asset("a-other", orgA, other),
      bOne: await asset("b-one", orgB, bLoc[0]!.id),
      bTwo: await asset("b-two", orgB, bLoc[0]!.id),
    };

    const currentHourMs = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const at = (hours: number, minutes = 0): number => currentHourMs + hours * HOUR_MS + minutes * 60_000;
    /** One `bms-anomaly` run of Baseline scores at `hours` (from the current hour) for `assetId`. */
    const scores = async (org: string, assetId: string, hours: number[]): Promise<void> => {
      const id = randomUUID();
      await fleet.query(
        `INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                    started_at, finished_at, rows_written, status)
         VALUES ($1, $2, 'bms-anomaly', '0.1.0', $3, to_timestamp($4::float8 / 1000), to_timestamp($4::float8 / 1000), $5, 'succeeded')`,
        [id, org, "c".repeat(64), at(-1, 5), hours.length],
      );
      runIds.push(id);
      for (const h of hours) {
        await fleet.query(
          `INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
           VALUES ($1, $2, to_timestamp($3::float8 / 1000), 'baseline_mad', 0.999, $4::varchar(128)[], $5)`,
          [org, assetId, at(h), [pointKey], id],
        );
      }
    };
    // `n` (2–21) comes from the run's stamp, so two runs on one database write different facts and hashes.
    const n = 2 + (parseInt(stamp.slice(0, 4), 16) % 20);
    const recent = Array.from({ length: n }, (_, i) => -(i + 2));
    await scores(orgA, assets.aMine, recent);
    await scores(orgA, assets.aOther, [-1]);
    await scores(orgB, assets.bOne, recent);
    await scores(orgB, assets.bTwo, [-1]);

    const resolver = new LlmResolver(tenantDb, new CredentialCryptoService());
    const provider: LlmProvider = {
      name: "openrouter",
      complete: async () => {
        providerCalls += 1;
        return REPLY;
      },
    };
    resolver.buildProvider = () => provider;
    const facts = new MlFindingsService(tenantDb, fleetDb);
    const svc = new FindingsParagraphService(tenantDb, facts, resolver, new CopilotAvailabilityService(tenantDb));
    const narrow = new AssetFilterScopeService(fleetDb, accessControl);
    ctx = {
      svc,
      facts,
      controller: new FindingsParagraphController(svc, narrow),
      superuser,
      tenant,
      calls: () => providerCalls,
      setSwitch,
      plant: async (row) => {
        hashes.add(row.hash);
        await superuser.query(
          `INSERT INTO bms.ml_finding_paragraphs (organization_id, kind, facts_hash, status, paragraph, reason, attempts, created_at)
           VALUES ($1, 'anomalies', $2, $3, $4, $5, $6, now() - ($7::float8 * interval '1 millisecond'))`,
          [row.organizationId, row.hash, row.status, row.paragraph, row.reason, row.attempts, row.ageMs],
        );
      },
      remember: (hash) => hashes.add(hash),
      runHash: (tag) => {
        const hash = createHash("sha256").update(`e19c-${stamp}-${tag}`).digest("hex");
        hashes.add(hash);
        return hash;
      },
      users: { locationAdmin },
      now: () => new Date(),
      organizations: { a: orgA, b: orgB },
      assets,
      names: [`e19c-${stamp}`, `E1.9c asset`, `E1.9c other`, `E1.9c b`, "E1.9c site", ...Object.values(assets), orgA, orgB],
    };
  }, 180_000);

  afterAll(async () => {
    await ctx?.svc.settled();
    if (superuser) {
      await superuser.query("DELETE FROM bms.ml_finding_paragraphs WHERE facts_hash = ANY($1::text[]) AND organization_id = ANY($2::uuid[])", [
        [...hashes],
        organizations,
      ]);
      await superuser.query("DELETE FROM ml.anomaly_scores WHERE model_run_id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM ml.model_runs WHERE id = ANY($1::uuid[])", [runIds]);
      await superuser.query("DELETE FROM bms.assets WHERE id = ANY($1::uuid[])", [assetIds]);
      await superuser.query("DELETE FROM bms.locations WHERE id = ANY($1::uuid[])", [locationIds]);
      const saved = new Map(savedSwitches.map((s) => [s.organization_id, s.enabled]));
      for (const organizationId of organizations) {
        if (saved.has(organizationId)) {
          await superuser.query("UPDATE bms.copilot_org_settings SET enabled = $2 WHERE organization_id = $1", [organizationId, saved.get(organizationId)]);
        } else {
          await superuser.query("DELETE FROM bms.copilot_org_settings WHERE organization_id = $1", [organizationId]);
        }
      }
    }
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await Promise.all([fleet?.end(), superuser?.end(), tenant?.end(), auth?.end()]);
  }, 120_000);

  it("the first read is pending, the next ok; the row is the card's organization's, in placeholder form", async () => {
    await assertFirstPendingThenOkInPlaceholderForm(ctx);
  });

  it("a global admin's write lands under the card's organization (bms_tenant under that setting reads it)", async () => {
    await assertAGlobalWriteLandsUnderTheCardsOrganization(ctx);
  });

  it("A's paragraph is never served for B; the same facts in B make B's own row", async () => {
    await assertTheSameFactsInTwoOrganizationsAreTwoRows(ctx);
  });

  it("the location-scoped user's key differs from the admin's; an asset outside its scope gives no card", async () => {
    await assertTheLocationAdminHasItsOwnKey(ctx);
  });

  it("the switch off: none, no call, no row", async () => {
    await assertTheSwitchOffIsNoneWithNoRow(ctx);
  });

  it("200 attempts today: none, no call", async () => {
    await assertTheDailyCapIsNoneWithNoCall(ctx);
  });

  it("a failed row older than 30 minutes is replaced; the write deletes a 15-day-old row and keeps a 13-day-old one", async () => {
    await assertARetryReplacesAndRetentionDeletes(ctx);
  });
});

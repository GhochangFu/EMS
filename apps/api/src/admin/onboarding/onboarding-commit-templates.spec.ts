import { BadRequestException, ConflictException } from "@nestjs/common";
import { getTableName } from "drizzle-orm";

import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { MAX_DASHBOARD_WIDGET_ROWS } from "../asset-templates/asset-dashboards-plan";
import { MAX_INSTANTIATE_ASSETS } from "../asset-templates/asset-templates.schema";
import { MAX_POINT_ROWS } from "../asset-templates/asset-templates-instantiate-guards";
import { MAX_RULE_ROWS } from "../asset-templates/template-alarm-rules";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { assertTemplateBatchesFit } from "./onboarding-commit-templates";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

/**
 * `F3.22` (ADR 0091 decisions 4, 5 and 10) — the onboarding commit publishes
 * the draft's templates and instantiates its templated assets inside its one
 * transaction, through the template cores.
 *
 * The harness drives the real `OnboardingCommitService.commit` over a fake
 * database that records every write by table, and over recording fakes of the
 * three template services. One event log holds both, so the cases read the
 * order: the access check before the transaction, the templates after the
 * RTUs and before the plain assets, the templated assets after the plain
 * asset points, the session update and the audit row last.
 *
 * The database itself, and the claim that every core sees what the commit
 * wrote before it, are `onboarding-commit-templates.integration.spec.ts`'s.
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

/** Uuids where the route's body schema reads them: the organization and the RTU. */
const ORG = "11111111-1111-4111-8111-111111111111";
const RTU_ID = "55555555-5555-4555-8555-555555555555";

/** The events C1 reads, in the order decision 4 fixes. Everything else is filtered out. */
const ORDERED_EVENTS = new Set([
  "assertCanAuthor",
  "transaction",
  "createInTransaction",
  "publishInTransaction",
  "insert:assets",
  "insert:asset_points",
  "instantiateInTransaction",
  "update:onboarding_sessions",
  "audit:master.onboarding.commit",
]);

type Insert = { table: string; values: Record<string, unknown>[] };

type Harness = {
  service: OnboardingCommitService;
  events: string[];
  inserts: Insert[];
  instantiateCalls: unknown[][];
};

type Failures = {
  /** The table whose insert rejects, and with what. */
  insert?: { table: string; err: unknown };
  create?: unknown;
  instantiate?: unknown;
};

function tableOf(table: unknown): string {
  return getTableName(table as never);
}

/** A row id the fake database hands back, readable in a failure message; the RTU's is a uuid. */
function idFor(table: string, row: Record<string, unknown>, index: number): string {
  return table === "rtus" ? RTU_ID : `${table}:${String(row.code ?? row.pointKey ?? index)}`;
}

function draft(overrides: Partial<OnboardingDraft> = {}): OnboardingDraft {
  return {
    location: {
      code: "F322-LOC",
      slug: "f322-loc",
      name: "F3.22 Site",
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [{ code: "RTU-1", displayName: "RTU 1", protocol: "simulator", config: {} }],
    pointKeys: [{ code: "flow_rate", name: "Flow" }],
    ...overrides,
  } as OnboardingDraft;
}

/** One authored template, a plain asset with a mapping, and one templated asset. */
function draftWithTemplates(): OnboardingDraft {
  return draft({
    templates: [
      {
        code: "PUMP-T",
        name: "Pump",
        domain: "water",
        points: [{ pointKey: "flow_rate", sourceDataKeyPattern: "{asset_code}_FLOW" }],
      },
    ],
    assets: [
      { rtuIndex: 0, code: "PLAIN-A", name: "Plain A", siteName: "Site", domain: "water" },
      {
        rtuIndex: 0,
        code: "TPL-1",
        name: "Templated 1",
        siteName: "Site",
        domain: "water",
        template: { code: "PUMP-T" },
      },
    ],
    assetPoints: [{ assetIndex: 0, pointKey: "flow_rate", sourceDataKey: "PLAIN_A_FLOW" }],
  } as Partial<OnboardingDraft>);
}

function build(stored: OnboardingDraft, failures: Failures = {}): Harness {
  const events: string[] = [];
  const inserts: Insert[] = [];
  const instantiateCalls: unknown[][] = [];
  const session = { id: "s-1", organizationId: ORG, status: "draft", draft: stored };

  const sessionChain = {
    from: () => sessionChain,
    where: () => sessionChain,
    limit: () => Promise.resolve([session]),
  };
  const fleetDb = { select: () => sessionChain } as never;

  /** What a `tx` read of each table answers: the published template's shape. */
  const reads: Record<string, unknown[]> = {
    asset_templates: [
      {
        id: "tpl:PUMP-T",
        organizationId: ORG,
        code: "PUMP-T",
        version: 1,
        status: "published",
        domain: "water",
        content: {},
      },
    ],
    template_points: [{ pointKey: "flow_rate", kind: "measured", required: true, sortOrder: 0 }],
  };

  const select = () => {
    let table = "";
    const chain: Record<string, unknown> = {};
    chain.from = (t: unknown) => {
      table = tableOf(t);
      return chain;
    };
    for (const method of ["where", "limit", "orderBy", "innerJoin", "for"]) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (value: unknown) => void, reject: (err: unknown) => void) =>
      Promise.resolve(reads[table] ?? []).then(resolve, reject);
    return chain;
  };

  const tx = {
    execute: () => Promise.resolve(),
    select,
    insert: (t: unknown) => ({
      values: (value: Record<string, unknown> | Record<string, unknown>[]) => {
        const table = tableOf(t);
        const rows = Array.isArray(value) ? value : [value];
        events.push(`insert:${table}`);
        inserts.push({ table, values: rows });
        const run = (): Promise<unknown[]> =>
          failures.insert?.table === table
            ? Promise.reject(failures.insert.err)
            : Promise.resolve(rows.map((row, index) => ({ ...row, id: idFor(table, row, index) })));
        return {
          returning: () => run(),
          then: (resolve: (value: unknown) => void, reject: (err: unknown) => void) =>
            run().then(resolve, reject),
        };
      },
    }),
    update: (t: unknown) => ({
      set: () => ({
        where: () => {
          events.push(`update:${tableOf(t)}`);
          return Promise.resolve();
        },
      }),
    }),
  };

  const tenantDb = {
    transaction: (fn: (inner: unknown) => Promise<unknown>) => {
      events.push("transaction");
      return fn(tx);
    },
  } as never;

  const accessControl = {
    requireMasterDataUser: () => Promise.resolve({ id: "u-1", role: "admin" }),
    canManageOrganization: () => Promise.resolve(true),
  } as never;
  const audit = {
    write: (entry: { action: string }) => {
      events.push(`audit:${entry.action}`);
      return Promise.resolve();
    },
  } as never;
  const validateService = {
    validate: () => ({ valid: true, errors: [], readyToCommit: true, suggestedPhase: "review" }),
  } as never;
  const vocabularies = {
    assertAssetDomain: () => Promise.resolve(),
    listLocationTypes: () => Promise.resolve([]),
    assertLocationType: () => Promise.resolve(),
  } as never;

  const templates = {
    assertCanAuthor: () => {
      events.push("assertCanAuthor");
      return Promise.resolve();
    },
    createInTransaction: (_tx: unknown, _jwt: unknown, body: { code: string }) => {
      events.push("createInTransaction");
      if (failures.create !== undefined) {
        return Promise.reject(failures.create);
      }
      return Promise.resolve({ id: `tpl:${body.code}`, code: body.code, version: 1 });
    },
    publishInTransaction: (_tx: unknown, _jwt: unknown, id: string) => {
      events.push("publishInTransaction");
      return Promise.resolve({ id, version: 1, status: "published" });
    },
  } as never;
  const instantiation = {
    instantiateInTransaction: (...args: unknown[]) => {
      events.push("instantiateInTransaction");
      instantiateCalls.push(args);
      if (failures.instantiate !== undefined) {
        return Promise.reject(failures.instantiate);
      }
      const body = args[3] as { assets: { code: string }[] };
      return Promise.resolve({
        assets: body.assets.map((asset) => ({ id: `templated:${asset.code}`, code: asset.code })),
        assetCount: body.assets.length,
        pointCount: body.assets.length,
        ruleCount: 0,
        dashboardCount: 0,
      });
    },
  } as never;

  const service = new OnboardingCommitService(
    fleetDb,
    tenantDb,
    accessControl,
    audit,
    validateService,
    vocabularies,
    { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
    templates,
    instantiation,
    { bodyFor: () => Promise.reject(new Error("no stock entry in this harness")) } as never,
  );
  return { service, events, inserts, instantiateCalls };
}

async function settle(run: Promise<unknown>): Promise<unknown> {
  try {
    return await run;
  } catch (err) {
    return err;
  }
}

/**
 * C1 — decision 4's order: access, the transaction, create then publish, the
 * plain assets and their points, the templated assets through the core, then
 * the session and the audit row.
 */
export async function assertTheCommitRunsTheTemplateWorkInDecisionFourOrder(): Promise<void> {
  const { service, events } = build(draftWithTemplates());
  const result = await settle(service.commit(JWT, "s-1"));
  assert(!(result instanceof Error), `the commit must succeed, got ${String(result)}`);
  const ordered = events.filter((event) => ORDERED_EVENTS.has(event));
  assert(
    JSON.stringify(ordered) ===
      JSON.stringify([
        "assertCanAuthor",
        "transaction",
        "createInTransaction",
        "publishInTransaction",
        "insert:assets",
        "insert:asset_points",
        "instantiateInTransaction",
        "update:onboarding_sessions",
        "audit:master.onboarding.commit",
      ]),
    `decision 4's order, got ${JSON.stringify(ordered)}`,
  );
}

/** C2 — a draft with no templates asks no author check and still commits. */
export async function assertADraftWithoutTemplatesSkipsTheAuthorCheck(): Promise<void> {
  const { service, events } = build(
    draft({
      assets: [{ rtuIndex: 0, code: "PLAIN-A", name: "Plain A", siteName: "Site", domain: "water" }],
      assetPoints: [{ assetIndex: 0, pointKey: "flow_rate", sourceDataKey: "PLAIN_A_FLOW" }],
    } as Partial<OnboardingDraft>),
  );
  await settle(service.commit(JWT, "s-1"));
  assert(!events.includes("assertCanAuthor"), `no author check, got ${JSON.stringify(events)}`);
  // The positive beside the absence: the commit did reach its transaction.
  assert(events.includes("transaction"), `the transaction opens, got ${JSON.stringify(events)}`);
}

function shape(assetCount: number, measuredCount = 1, alarmCount = 0, dashboardWidgetCount = 0) {
  return { assetCount, measuredCount, alarmCount, dashboardWidgetCount };
}

function refusal(run: () => void): string {
  try {
    run();
  } catch (err) {
    assert(err instanceof BadRequestException, `a 400, got ${String(err)}`);
    return (err as BadRequestException).message;
  }
  return "";
}

/** C3 — two groups of 150 are 300 templated assets, over the one-commit bound. */
export function assertTheSummedAssetCountIsRefused(): void {
  const message = refusal(() => assertTemplateBatchesFit([shape(150), shape(150)]));
  assert(message.includes("300 templated assets"), `the sum is named, got "${message}"`);
  assert(message.includes(String(MAX_INSTANTIATE_ASSETS)), `the bound is named, got "${message}"`);
}

/** C3 positive — two groups of 100 fit. */
export function assertTwoHundredTemplatedAssetsFit(): void {
  assert(refusal(() => assertTemplateBatchesFit([shape(100), shape(100)])) === "", "200 assets fit");
}

/** C4 — 2 × 100 assets × 50 measured points is 10,000 point rows, over 8,000. */
export function assertTheSummedPointRowsAreRefused(): void {
  const message = refusal(() => assertTemplateBatchesFit([shape(100, 50), shape(100, 50)]));
  assert(message.includes("10000 asset points"), `the sum is named, got "${message}"`);
  assert(message.includes(String(MAX_POINT_ROWS)), `the bound is named, got "${message}"`);
}

/** C4b — the rule and widget sums are bounded too, each by its own constant. */
export function assertTheSummedRuleAndWidgetRowsAreRefused(): void {
  const rules = refusal(() => assertTemplateBatchesFit([shape(100, 1, 13), shape(100, 1, 13)]));
  assert(rules.includes("2600 seeded rules") && rules.includes(String(MAX_RULE_ROWS)), `rules: "${rules}"`);
  const widgets = refusal(() => assertTemplateBatchesFit([shape(100, 1, 0, 41), shape(100, 1, 0, 41)]));
  assert(
    widgets.includes("8200 dashboard widgets") && widgets.includes(String(MAX_DASHBOARD_WIDGET_ROWS)),
    `widgets: "${widgets}"`,
  );
}

/**
 * C5 — `assetIds` is in `draft.assets` order, the templated id in its place,
 * and a mapping on the plain asset AFTER the templated one lands on that
 * asset. A loop that pushed instead of assigning by index would put the
 * second plain asset at index 1 and hand its mapping to the wrong id.
 */
export async function assertAssetIdsKeepDraftOrder(): Promise<void> {
  const stored = draftWithTemplates();
  stored.assets = [
    ...(stored.assets ?? []),
    { rtuIndex: 0, code: "PLAIN-B", name: "Plain B", siteName: "Site", domain: "water" },
  ];
  stored.assetPoints = [
    ...(stored.assetPoints ?? []),
    { assetIndex: 2, pointKey: "flow_rate", sourceDataKey: "PLAIN_B_FLOW" },
  ];
  const { service, inserts } = build(stored);
  const result = (await settle(service.commit(JWT, "s-1"))) as { assetIds?: string[] };
  assert(
    JSON.stringify(result.assetIds) ===
      JSON.stringify(["assets:PLAIN-A", "templated:TPL-1", "assets:PLAIN-B"]),
    `draft order, got ${JSON.stringify(result.assetIds)}`,
  );
  const mappings = inserts.filter((entry) => entry.table === "asset_points").flatMap((entry) => entry.values);
  const plainB = mappings.find((row) => row.sourceDataKey === "PLAIN_B_FLOW");
  assert(plainB?.assetId === "assets:PLAIN-B", `PLAIN-B's mapping lands on PLAIN-B, got ${String(plainB?.assetId)}`);
}

/** C5b — the templated asset is handed to the core as one RTU-target group, with the organization option. */
export async function assertTheTemplatedGroupIsInstantiatedOntoTheNewRtu(): Promise<void> {
  const { service, instantiateCalls } = build(draftWithTemplates());
  await settle(service.commit(JWT, "s-1"));
  assert(instantiateCalls.length === 1, `one group, got ${instantiateCalls.length}`);
  const [, , templateId, body, options] = instantiateCalls[0] as [
    unknown,
    unknown,
    string,
    { target: unknown; assets: { code: string }[] },
    unknown,
  ];
  assert(templateId === "tpl:PUMP-T", `the published draft template, got ${templateId}`);
  assert(
    JSON.stringify(body.target) === JSON.stringify({ kind: "rtu", rtuId: RTU_ID }),
    `the RTU this commit wrote, got ${JSON.stringify(body.target)}`,
  );
  assert(body.assets.map((asset) => asset.code).join() === "TPL-1", "the group's asset");
  assert(
    JSON.stringify(options) === JSON.stringify({ locationAccess: "organization" }),
    `decision 5's option, got ${JSON.stringify(options)}`,
  );
}

const ASSET_CODE_TAKEN = Object.assign(new Error("duplicate key"), {
  code: "23505",
  constraint: "assets_code_unique",
});
const RULE_CODE_TAKEN = Object.assign(new Error("duplicate key"), {
  code: "23505",
  constraint: "automation_rules_org_code_idx",
});
const DRAFT_OPEN = Object.assign(new Error("duplicate key"), {
  code: "23505",
  constraint: "asset_templates_org_code_draft_unique",
});

/** C6a — `assets_code_unique` answers the plain commit's field error, unchanged. */
export async function assertAnAssetCodeRaceAnswersThePlainCommitText(): Promise<void> {
  const { service } = build(draftWithTemplates(), { insert: { table: "assets", err: ASSET_CODE_TAKEN } });
  const err = await settle(service.commit(JWT, "s-1"));
  assert(err instanceof BadRequestException, `a 400, got ${String(err)}`);
  const body = JSON.stringify((err as BadRequestException).getResponse());
  assert(body.includes("An asset code in this draft is already taken"), `the commit's text, got ${body}`);
}

/** C6b — `automation_rules_org_code_idx` answers the instantiate route's 409 text. */
export async function assertARuleCodeRaceAnswersTheRouteText(): Promise<void> {
  const { service } = build(draftWithTemplates(), { instantiate: RULE_CODE_TAKEN });
  const err = await settle(service.commit(JWT, "s-1"));
  assert(err instanceof ConflictException, `a 409, got ${String(err)}`);
  assert(
    (err as ConflictException).message.includes("A rule code this template's alarms would seed was taken"),
    `the route's text, got ${(err as Error).message}`,
  );
}

/** C6c — an open-draft race at the create call answers `translateDraftConflict`'s text, with the code. */
export async function assertAnOpenDraftRaceAnswersTheDraftConflictText(): Promise<void> {
  const { service } = build(draftWithTemplates(), { create: DRAFT_OPEN });
  const err = await settle(service.commit(JWT, "s-1"));
  assert(err instanceof ConflictException, `a 409, got ${String(err)}`);
  assert(
    (err as ConflictException).message.includes('Template "PUMP-T" already has an open draft'),
    `the draft-conflict text, got ${(err as Error).message}`,
  );
}

/** C7 — the result carries the template part of decision 4. */
export async function assertTheResultCarriesTheTemplateCounts(): Promise<void> {
  const { service } = build(draftWithTemplates());
  const result = (await settle(service.commit(JWT, "s-1"))) as Record<string, unknown>;
  assert(JSON.stringify(result.templateIds) === JSON.stringify(["tpl:PUMP-T"]), `templateIds, got ${JSON.stringify(result.templateIds)}`);
  assert(result.templatedAssetCount === 1, `templatedAssetCount, got ${String(result.templatedAssetCount)}`);
  assert(result.templatedAssetPointCount === 1, `templatedAssetPointCount, got ${String(result.templatedAssetPointCount)}`);
}

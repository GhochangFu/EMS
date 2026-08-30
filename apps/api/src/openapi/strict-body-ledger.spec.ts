import { expect } from "vitest";
import { z } from "zod";
import type { ZodTypeAny } from "zod";

import { setAssetGroupMemberRoleBodySchema } from "../admin/asset-groups/asset-groups.schema";
import { assetPointCalcOverrideBodySchema } from "../admin/asset-points/asset-point-calc-override.schema";
import {
  createAssetPointBodySchema,
  updateAssetPointBodySchema,
} from "../admin/asset-points/asset-points.schema";
import { migrateAssetsBodySchema } from "../admin/asset-templates/asset-templates-migrate.schema";
import {
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
  templateStatusQuerySchema,
  updateAssetTemplateBodySchema,
} from "../admin/asset-templates/asset-templates.schema";
import {
  createAssetBodySchema,
  updateAssetBodySchema,
} from "../admin/assets/assets.schema";
import {
  auditExportQuerySchema,
  auditListQuerySchema,
} from "../admin/audit/audit.schema";
import {
  createLocationBodySchema,
  updateLocationBodySchema,
} from "../admin/locations/locations.schema";
import {
  chatBodySchema,
  createSessionBodySchema,
  patchDraftBodySchema,
  setCredentialsBodySchema,
} from "../admin/onboarding/onboarding.schema";
import {
  createOrganizationBodySchema,
  updateOrganizationBodySchema,
} from "../admin/organizations/organizations.schema";
import {
  createPointKeyBodySchema,
  updatePointKeyBodySchema,
} from "../admin/point-keys/point-keys.schema";
import {
  createRtuBodySchema,
  updateRtuBodySchema,
} from "../admin/rtus/rtus.schema";
import { manualReadingsBodySchema } from "../admin/telemetry-entry/manual-readings.schema";
import { alarmAckBodySchema } from "../alarms/ack.schema";
import { alarmEnrichmentUpsertBodySchema } from "../alarms/enrichment.schema";
import { loginBodySchema } from "../auth/login.schema";
import { locationDashboardQuerySchema } from "../dashboard/dashboard.schema";
import {
  createDashboardBodySchema,
  getDashboardQuerySchema,
  listDashboardsQuerySchema,
  putDashboardWidgetsBodySchema,
  updateDashboardBodySchema,
} from "../dashboard-builder/dashboards.schema";
import {
  convertMaintenanceBodySchema,
  createMaintenanceScheduleBodySchema,
  listMaintenanceQuerySchema,
  updateMaintenanceScheduleBodySchema,
} from "../maintenance/maintenance.schema";
import {
  createNotificationChannelBodySchema,
  listDeliveriesQuerySchema,
  setRuleNotificationsBodySchema,
  updateNotificationChannelBodySchema,
} from "../notifications/notifications.schema";
import { energyReportQuerySchema } from "../reports/reports.schema";
import { pointAggregateQuerySchema } from "../telemetry/telemetry.schema";
import {
  listRuleExecutionsQuerySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  rulePreviewBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
} from "../rules/rules.schema";
import {
  closeWorkOrderBodySchema,
  createWorkOrderBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
} from "../work-orders/work-order.schema";

import { REQUEST_SCHEMAS } from "./openapi-registry";

/**
 * `E7.1f` — every object node in a request schema carries a recorded decision
 * about unknown keys.
 *
 * Assertions only (§4.6); `strict-body-ledger.test.ts` owns the runner.
 *
 * ## What this file is for
 *
 * ADR 0029 Amendment 3 ruling 1: `.strict()` is a **per-schema judgement in
 * this repo, not house style**, and stays that way. So the deliverable of
 * `E7.1f` is not a sweep — it is a decision per object node, in both
 * directions. Adding `.strict()` produces a test. Deciding to leave a node
 * permissive produces **nothing**, and that is the half this file exists to
 * make real: `STRICTNESS_LEDGER` demands an entry for every node the walk
 * finds, and a permissive entry without a `because` fails the build.
 *
 * ## Why the ledger reads the Zod tree and not the emitted document
 *
 * Amendment 3 ruling 2 says the generated document changes when a schema gains
 * `.strict()`. **It does not.** Measured while writing this file, with the
 * exact converter options `zod-openapi.ts:84-91` passes: a plain `z.object`
 * already emits `additionalProperties: false`, so strip and strict are
 * byte-identical and only `.passthrough()` differs. Counted across the whole
 * registry before and after this change: 73 `false`, 0 `true`, both times.
 *
 * A gate keyed on the emitted value would therefore assert nothing at all.
 * This one reads `_def.unknownKeys` off the Zod tree — the only place the
 * distinction survives — and cross-checks `_def.catchall`, which can override
 * it. The measurement is recorded against ADR 0029 as Amendment 3 Errata 1;
 * the reasoning above stands on its own if you are reading this before that
 * lands.
 *
 * That errata also inverts the defect, and the inversion is the reason this
 * matters: the document has published `additionalProperties: false` since
 * `F4.20` while the server strips the key and answers 200. The server is more
 * permissive than the contract it publishes.
 *
 * ## Why it lives here and not in `tests/`
 *
 * `tests/adr-0029-openapi-contract.test.ts:24-30` records why the whole-tree
 * `.describe()` rule had to be a source scan in `tests/`: reaching every schema
 * *file* needs `import.meta.glob`, a Vite feature `tsc` rejects under this
 * package's CommonJS `module` setting. That constraint does not apply to this
 * file. It walks the **registry**, which is an ordinary import — exactly as
 * `openapi-contract.spec.ts` already does.
 *
 * Living in `apps/api` also buys the thing a file walk cannot have: the walk
 * follows schema *objects*, so it crosses into `packages/shared` for free
 * (`manualReadingsBodySchema` reaches `telemetryEntryRowSchema`). A scan
 * rooted at `apps/api/src` structurally cannot see that node, and a test's walk
 * boundary must not be what silently decides this item's scope.
 */

/* -------------------------------------------------------------------------- */
/* The schemas under audit                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Keyed by **export name**, not by `operationId`, and the difference is not
 * cosmetic.
 *
 * `REQUEST_SCHEMAS` is keyed by `operationId`, and three schemas serve more
 * than one route: `migrateAssetsBodySchema` (×2), `ruleLifecycleBodySchema`
 * (×3) and `energyReportQuerySchema` (×3). A registry-keyed ledger would ask
 * for the same judgement three times and let the copies drift apart — a second
 * place to record the same decision, which is the shape AGENTS.md §4.4 exists
 * to refuse.
 *
 * The cost of the second import list is that it can fall behind the registry.
 * `assertEveryRegisteredSchemaIsInTheLedger` is what stops that, by object
 * identity rather than by name.
 */
export const BODY_SCHEMAS: Record<string, ZodTypeAny> = {
  alarmAckBodySchema,
  alarmEnrichmentUpsertBodySchema,
  assetPointCalcOverrideBodySchema,
  chatBodySchema,
  closeWorkOrderBodySchema,
  convertMaintenanceBodySchema,
  createAssetBodySchema,
  createAssetPointBodySchema,
  createAssetTemplateBodySchema,
  createDashboardBodySchema,
  createLocationBodySchema,
  createMaintenanceScheduleBodySchema,
  createNotificationChannelBodySchema,
  createOrganizationBodySchema,
  createPointKeyBodySchema,
  createRtuBodySchema,
  createSessionBodySchema,
  createWorkOrderBodySchema,
  instantiateAssetsBodySchema,
  loginBodySchema,
  manualReadingsBodySchema,
  migrateAssetsBodySchema,
  patchDraftBodySchema,
  putDashboardWidgetsBodySchema,
  reorderWorkOrdersBodySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  rulePreviewBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
  setAssetGroupMemberRoleBodySchema,
  setCredentialsBodySchema,
  setRuleNotificationsBodySchema,
  updateAssetBodySchema,
  updateAssetPointBodySchema,
  updateAssetTemplateBodySchema,
  updateDashboardBodySchema,
  updateLocationBodySchema,
  updateMaintenanceScheduleBodySchema,
  updateNotificationChannelBodySchema,
  updateOrganizationBodySchema,
  updatePointKeyBodySchema,
  updateRtuBodySchema,
  updateWorkOrderStatusBodySchema,
};

/**
 * The TEN registered **query** schemas — eight at `E7.1f`, plus two added by `F3.1b`.
 *
 * **Deliberately outside this item's audit, ruled by the repository owner on
 * 2026-08-28.** Amendment 3's title and the `E7.1f` row both say *mutating
 * body*, and the owner kept the audit to that boundary. They are listed here
 * rather than omitted so that `assertEveryRegisteredSchemaIsInTheLedger` still
 * sees the whole registry — an omission would make that assertion pass by
 * looking at less, which is the failure mode it exists to catch.
 *
 * Two of them are already `.strict()` for a reason worth reading:
 * `admin/audit/audit.schema.ts:8` — "an unknown query key is a caller error,
 * not a…". That precedent is the argument for widening the audit later; it was
 * put to the owner and not taken for `E7.1f`.
 *
 * **`F3.1b` widened eight to ten**, registering `listDashboardsQuerySchema`
 * (`GET /dashboards`) and `getDashboardQuerySchema` (`GET /dashboards/:slug`) —
 * both carry the single `organizationId` parameter D5 needs to disambiguate a
 * slug shared by more than one organization on the fleet pool. Leaving them
 * unregistered would have made that parameter undiscoverable from the served
 * document, which is the exact failure `F4.20` is in this repository's history
 * for: a green suite and a static invariant still let a served document be
 * wrong. This is the "deliberate act" `testEveryRegisteredSchemaIsUnderAudit`'s
 * own comment asks for, not the shortcut it exists to catch.
 */
export const QUERY_SCHEMAS: Record<string, ZodTypeAny> = {
  auditExportQuerySchema,
  auditListQuerySchema,
  energyReportQuerySchema,
  getDashboardQuerySchema,
  listDashboardsQuerySchema,
  listDeliveriesQuerySchema,
  listMaintenanceQuerySchema,
  listRuleExecutionsQuerySchema,
  locationDashboardQuerySchema,
  pointAggregateQuerySchema,
  templateStatusQuerySchema,
};

/* -------------------------------------------------------------------------- */
/* The walk                                                                    */
/* -------------------------------------------------------------------------- */

/** One `ZodObject` found somewhere inside a registered schema. */
export interface WalkedNode {
  /** `"<exportName>"` for a root, `"<exportName>/<path>"` for anything deeper. */
  readonly label: string;
  /** Zod's own verdict: `"strip"` (the default), `"strict"` or `"passthrough"`. */
  readonly unknownKeys: string;
}

interface ZodDefLike {
  readonly typeName?: string;
  readonly [key: string]: unknown;
}

const defOf = (schema: ZodTypeAny): ZodDefLike => schema._def as unknown as ZodDefLike;

/**
 * Constructs that wrap another schema. Descending through them is the whole
 * point: `.strict()` on a wrapper reaches **nothing** below it, which
 * `admin/telemetry-entry/manual-readings.schema.spec.ts:15-16` already records
 * from the other side ("the body wrapper's own `.strict()` only catches an
 * unknown key at the top").
 */
const UNWRAPPED = new Set([
  "ZodArray",
  "ZodBranded",
  "ZodCatch",
  "ZodDefault",
  "ZodDiscriminatedUnion",
  "ZodEffects",
  "ZodIntersection",
  "ZodLazy",
  "ZodNullable",
  "ZodObject",
  "ZodOptional",
  "ZodPipeline",
  "ZodPromise",
  "ZodReadonly",
  "ZodRecord",
  "ZodSet",
  "ZodTuple",
  "ZodUnion",
]);

/**
 * Leaves. A node in neither this set nor `UNWRAPPED` **fails the walk** rather
 * than being skipped.
 *
 * That is the anti-vacuity rule, and it is not decoration. A recursion that
 * silently stops descending returns an empty offender list and a green build —
 * the shape `openapi-contract.spec.ts:80` and
 * `tests/adr-0029-openapi-contract.test.ts:60` each already carry a floor
 * against. Here the consequence is worse than a quiet pass: an unaudited object
 * node would enter the tree behind a new Zod construct and no one would be
 * told.
 */
const TERMINAL = new Set([
  "ZodAny",
  "ZodBigInt",
  "ZodBoolean",
  "ZodDate",
  "ZodEnum",
  "ZodLiteral",
  "ZodNaN",
  "ZodNativeEnum",
  "ZodNever",
  "ZodNull",
  "ZodNumber",
  "ZodString",
  "ZodSymbol",
  "ZodUndefined",
  "ZodUnknown",
  "ZodVoid",
]);

/** Every Zod construct the walk met that it could neither descend nor accept. */
export const unhandled: string[] = [];

/**
 * Depth-first over one registered schema, returning one entry per object node.
 *
 * Cycles are possible through `ZodLazy`, so visited schemas are tracked by
 * identity. A repeat is not an error — it is the same node reached twice.
 */
export function walkObjectNodes(rootLabel: string, root: ZodTypeAny): WalkedNode[] {
  const found: WalkedNode[] = [];
  const seen = new Set<ZodTypeAny>();

  const visit = (schema: ZodTypeAny, label: string): void => {
    // **A missing child is reported, never skipped.** This guard is the general
    // form of a bug found twice while writing this file: the walker read the
    // wrong `_def` key for a construct (`ZodPipeline` lost its `out` side;
    // `ZodBranded` and `ZodPromise` keep their child on `_def.type`, not
    // `_def.innerType`), so `visit(undefined)` returned quietly, `unhandled`
    // stayed empty, and an entire strict-or-not subtree never reached the
    // ledger with the build green. Reading a key that does not exist must be
    // as loud as meeting a construct that is not handled.
    if (schema === undefined || schema === null) {
      unhandled.push(`${label} — MISSING CHILD (the walker read a _def key this construct does not have)`);
      return;
    }
    if (seen.has(schema)) return;
    seen.add(schema);

    const def = defOf(schema);
    const typeName = def.typeName ?? "(no typeName)";

    if (!UNWRAPPED.has(typeName)) {
      if (!TERMINAL.has(typeName)) unhandled.push(`${label} — ${typeName}`);
      return;
    }

    switch (typeName) {
      case "ZodObject": {
        // **`unknownKeys` alone is not the answer, and trusting it would make
        // this whole file lie.** `z.object({…}).strict().catchall(z.string())`
        // reports `unknownKeys: "strict"` while **accepting and keeping** an
        // unknown key — measured on this repo's zod. A ledger that read only
        // `unknownKeys` would record that node as strict, the `stale` check
        // would agree, and the assertion "this node refuses unknown keys" would
        // be false with everything green. A plain object's catchall is
        // `ZodNever`; anything else overrides the strictness verdict.
        const catchall = def.catchall as ZodTypeAny | undefined;
        const catchallType = catchall ? defOf(catchall).typeName : "ZodNever";
        const effective = catchallType === "ZodNever" ? String(def.unknownKeys) : `catchall:${catchallType}`;
        found.push({ label, unknownKeys: effective });
        if (catchallType !== "ZodNever" && catchall) visit(catchall, `${label}{catchall}`);
        const shape = (def.shape as () => Record<string, ZodTypeAny>)();
        for (const [key, child] of Object.entries(shape)) visit(child, `${label}/${key}`);
        return;
      }
      case "ZodEffects":
        visit(def.schema as ZodTypeAny, label);
        return;
      case "ZodOptional":
      case "ZodNullable":
      case "ZodDefault":
      case "ZodCatch":
      case "ZodReadonly":
        visit(def.innerType as ZodTypeAny, label);
        return;
      // `_def.type`, NOT `_def.innerType`. Grouping these with the wrappers
      // above was a real bug: the key does not exist on them, so a strict
      // object under `.brand()` was silently dropped from the audit. The
      // MISSING CHILD guard now catches that class, but the correct key is
      // still the fix.
      case "ZodBranded":
      case "ZodPromise":
        visit(def.type as ZodTypeAny, label);
        return;
      case "ZodArray":
      case "ZodSet":
        visit((def.type ?? def.valueType) as ZodTypeAny, `${label}[]`);
        return;
      case "ZodRecord":
        visit(def.valueType as ZodTypeAny, `${label}{}`);
        return;
      case "ZodUnion":
      case "ZodDiscriminatedUnion": {
        const options = def.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
        const list = Array.isArray(options) ? options : [...options.values()];
        list.forEach((option, index) => visit(option, `${label}|${index}`));
        return;
      }
      case "ZodIntersection":
        visit(def.left as ZodTypeAny, `${label}&left`);
        visit(def.right as ZodTypeAny, `${label}&right`);
        return;
      case "ZodPipeline":
        // **Both sides, and the second one is not optional.** ADR 0029 sets
        // `pipeStrategy: "input"` because the *document* must describe what a
        // caller sends. Strictness is a different question: both halves parse
        // at runtime, so an object on the output side rejects unknown keys as
        // surely as one on the input side.
        //
        // Measured, and it is why this case is written out rather than
        // defaulted: `templateContentSchema` is `record → superRefine → pipe`
        // (`asset-templates-content.schema.ts:327-367`), and every object in
        // the template content tree — `contentEnvelopeSchema` and the six
        // `.strict()` nodes below it — hangs off `out`. Visiting only `in` left
        // all of them unaudited while the walk still reported success, because
        // an unvisited subtree raises nothing. That is the silent skip the
        // TERMINAL whitelist exists to refuse, arriving through a construct the
        // whitelist had already accepted.
        visit(def.in as ZodTypeAny, label);
        visit(def.out as ZodTypeAny, label);
        return;
      case "ZodTuple": {
        const items = (def.items ?? []) as ZodTypeAny[];
        items.forEach((item, index) => visit(item, `${label}[${index}]`));
        // `.rest()` holds its element on `_def.rest` and is `null` without one.
        // Read explicitly rather than left out: an unread key passes nothing to
        // `visit`, so the MISSING CHILD guard never fires for it and the gap
        // would be as quiet as the two this file has already had.
        const rest = def.rest as ZodTypeAny | null | undefined;
        if (rest) visit(rest, `${label}[...rest]`);
        return;
      }
      case "ZodLazy":
        visit((def.getter as () => ZodTypeAny)(), label);
        return;
      default:
        unhandled.push(`${label} — ${typeName} (listed as unwrapped, no case)`);
    }
  };

  visit(root, rootLabel);
  return found;
}

/** Every object node under every body schema, sorted by label. */
export function walkEveryBodySchema(): WalkedNode[] {
  unhandled.length = 0;
  return Object.entries(BODY_SCHEMAS)
    .flatMap(([name, schema]) => walkObjectNodes(name, schema))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The walk reaches every construct it meets, and reaches enough of them.
 *
 * Both halves are needed. The whitelist catches a *new* construct entering the
 * tree; the floor catches the walk breaking on the constructs already there.
 */
export function testTheWalkHandlesEveryConstructItMeets(): void {
  const nodes = walkEveryBodySchema();

  expect(
    unhandled,
    `the walk met Zod constructs it can neither descend nor treat as a leaf:\n${unhandled.join("\n")}\n\n` +
      "Add each to UNWRAPPED (with a case that visits its children) or to TERMINAL. " +
      "Do NOT silently skip one: an object node hidden behind an unhandled construct " +
      "would never reach the ledger, and the build would stay green while an unaudited " +
      "request body accepted unknown keys.",
  ).toEqual([]);

  expect(
    nodes.length,
    "the walk found almost no object nodes, so every assertion built on it is " +
      "vacuous. Either the registry emptied or the recursion stopped descending.",
  ).toBeGreaterThan(40);
}

/* -------------------------------------------------------------------------- */
/* The ledger                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One node's recorded decision.
 *
 * The asymmetry is the point. `strict: true` carries a `why` drawn from a small
 * closed set, because the reasons repeat and repeating them in prose 73 times
 * would hide the one that does not fit. `strict: false` carries free prose,
 * because a node left open is always open for its own reason and there is no
 * set to draw from.
 */
export type LedgerEntry =
  | { readonly strict: true; readonly why: string }
  | { readonly strict: false; readonly because: string };

/**
 * **The finding this audit produced — and the exception that corrected it.**
 *
 * `E7.1f` asked whether an unknown key is a caller error *per node*. For 66 of
 * the 73 the answer is yes, and that is a property of the codebase rather than
 * a shortcut: **every schema that needs open-ended data already has a
 * `z.record` for it** — `meta` on locations, assets, RTUs, organizations and
 * template drafts; `config` on an RTU and a notification channel;
 * `credentials`; `sourceDataKeyVars`; `dashboards`. `.strict()` does not close
 * any of those, so a caller with a legitimate key always has somewhere to put
 * it.
 *
 * **The remaining seven are the onboarding draft subtree, and they stay open.**
 * The first version of this ledger recorded them as strict on the strength of
 * that same reasoning, and it was wrong — not because the `z.record` argument
 * failed, but because "is this a caller error?" assumes there is one caller.
 * Those seven objects validate three producers (see `THREE_PRODUCERS`), and
 * strictness broke two of them. The question the audit should ask first is
 * **how many producers share this schema object**, and only then whether an
 * unknown key is an error for each of them.
 *
 * That is why the `strict: false` branch is in the type and asserted. It was
 * written expecting some future schema to need it; the need was already here.
 */
const CALLER_ERROR =
  "Every field this endpoint accepts is named in the schema, and open-ended data has a " +
  "`z.record` home that `.strict()` does not close. A key outside that set is a caller " +
  "error — today it is dropped and answered 200, which reads as 'accepted'.";

const CREDENTIAL =
  "Carries credential material (§9.6, ADR 0022/ADR 0012). An unknown key silently dropped " +
  "on a credential write is the case with the least excuse for being quiet.";

/**
 * The one place the audit came out the other way — see `onboarding.schema.ts`
 * for the full reasoning, which is deliberately in the source beside the
 * schema rather than only here.
 *
 * **This entry exists because the first version of this ledger was wrong.**
 * It recorded these seven nodes as strict, justified by an `apps/web`
 * round-trip. Two independent reviews found the justification was the wrong
 * question: these schema objects validate **three** producers, and only one is
 * an HTTP caller. Making them strict deadlocked the ADR 0022 onboarding commit
 * (the stored draft carries `_secrets`) and silently discarded the LLM's draft
 * patch on any invented key. Both were live regressions, and neither was
 * visible to `pnpm test` — `_secrets` is only written when
 * `CREDENTIAL_ENCRYPTION_KEY` is set, which CI does not set.
 */
const THREE_PRODUCERS =
  "NOT strict, deliberately. These objects validate three producers, not one: the PATCH " +
  "body, the STORED draft re-parsed by OnboardingValidateService (it carries a top-level " +
  "`_secrets` once any RTU credential is set, so strict deadlocks readyToCommit forever), " +
  "and the model's `draftPatch` in onboarding-chat.service.ts, where the result is " +
  "`.data ?? {}` so one invented key would discard the operator's whole turn while the " +
  "assistant still reports success. The wrapper `patchDraftBodySchema` IS strict and " +
  "declares only `draft`, so nothing rides alongside. What is given up: a key nested " +
  "inside `draft` is still dropped with a 200. Closing that needs one schema per producer.";

const ALREADY =
  "Strict before E7.1f, for a reason recorded beside the schema. Listed so the audit is " +
  "complete rather than only the nodes this item changed.";

const WIDGET_CONFIG =
  "F3.1a (ADR 0047). The shared config schema, tightened with `.strict()` at this write " +
  "boundary. The shared export stays tolerant because §4.8 requires a RESPONSE contract to " +
  "survive a field the server has added; an authoring body has the opposite obligation, and " +
  "one schema serves both because strictness is composed here rather than forked.";

const DASHBOARD_WIDGET_WRITE_CONFIG =
  "F3.1b (ADR 0047). Same composition as WIDGET_CONFIG above, at the live-dashboard write " +
  "boundary rather than the template-authoring one: the shared config schema imported from " +
  "@bms/shared, tightened with `.strict()` here (and, for the gauge arm, restated one level " +
  "so its `thresholds[]` items are strict too — `.strict()` does not descend). The shared " +
  "export stays tolerant per §4.8's response-survives-a-new-field rule; this write body has " +
  "the opposite obligation.";

const DASHBOARD_WIDGET_ARM =
  "F3.1b (ADR 0047). A live dashboard widget is authored by hand — through F3.1d eventually, " +
  "and through this API directly today — so an unknown key is an author's typo and must be " +
  "refused rather than silently dropped. Each of the four arms is strict, and cardinality " +
  "(ADR 0047 Amendment 2) is enforced on the `points` field, not by this node's own strictness.";

const HEALTH_SECTION =
  "E1.3 (ADR 0050 decision 7). The `health` tier `E1.7` rejected, reopened as its consumer " +
  "landed. Strict at the authoring boundary for the reason the whole section exists: the " +
  "roll-up reads `weights` and `bands` by name, so a key it does not read is not a harmless " +
  "extra — it is an author believing they configured something. A misspelled `band` would " +
  "otherwise be stored, returned, and silently ignored by every score it was meant to change.";

const STRICT = (why: string): LedgerEntry => ({ strict: true, why });

/**
 * Every object node reachable from a registered **body** schema, with the
 * decision recorded for each. Keys are `WalkedNode.label`.
 *
 * Derived schemas appear separately even though one edit decides several:
 * `.partial()`, `.extend()` and `.omit()` all preserve `unknownKeys`, so
 * `createAssetBodySchema.partial()` is strict the moment its base is. They are
 * listed rather than collapsed because a reader auditing `updateRtuBodySchema`
 * must find it here, not deduce it.
 */
export const STRICTNESS_LEDGER: Record<string, LedgerEntry> = {
  alarmAckBodySchema: STRICT(CALLER_ERROR),
  alarmEnrichmentUpsertBodySchema: STRICT(ALREADY),
  assetPointCalcOverrideBodySchema: STRICT(
    "A PUT states the whole override and every field is required-but-nullable, where `null` " +
      "means inherit (ADR 0039 decisions 6-7). A key outside the five columns is a caller " +
      "error by construction: there is no sixth thing to override.",
  ),
  chatBodySchema: STRICT(CALLER_ERROR),
  closeWorkOrderBodySchema: STRICT(CALLER_ERROR),
  convertMaintenanceBodySchema: STRICT(CALLER_ERROR),
  createAssetBodySchema: STRICT(CALLER_ERROR),
  createAssetPointBodySchema: STRICT(CALLER_ERROR),
  createAssetTemplateBodySchema: STRICT(CALLER_ERROR),
  "createAssetTemplateBodySchema/content": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/alarms[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/alarms[]/philosophy": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/dashboards{}": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|0": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config/thresholds[]": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|1": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|1/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|2": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|2/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|3": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "createAssetTemplateBodySchema/content/dashboards{}/widgets[]|3/config": STRICT(WIDGET_CONFIG),
  "createAssetTemplateBodySchema/content/health": STRICT(HEALTH_SECTION),
  "createAssetTemplateBodySchema/content/health/bands[]": STRICT(HEALTH_SECTION),
  "createAssetTemplateBodySchema/content/kpis[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/maintenance[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/points[]": STRICT(CALLER_ERROR),
  createDashboardBodySchema: STRICT(CALLER_ERROR),
  createLocationBodySchema: STRICT(CALLER_ERROR),
  createMaintenanceScheduleBodySchema: STRICT(CALLER_ERROR),
  createNotificationChannelBodySchema: STRICT(CALLER_ERROR),
  createOrganizationBodySchema: STRICT(CALLER_ERROR),
  createPointKeyBodySchema: STRICT(CALLER_ERROR),
  createRtuBodySchema: STRICT(CALLER_ERROR),
  createSessionBodySchema: STRICT(CALLER_ERROR),
  createWorkOrderBodySchema: STRICT(CALLER_ERROR),
  instantiateAssetsBodySchema: STRICT(CALLER_ERROR),
  "instantiateAssetsBodySchema/assets[]": STRICT(CALLER_ERROR),
  loginBodySchema: STRICT(CREDENTIAL),
  manualReadingsBodySchema: STRICT(ALREADY),
  "manualReadingsBodySchema/rows[]": STRICT(ALREADY),
  migrateAssetsBodySchema: STRICT(CALLER_ERROR),
  patchDraftBodySchema: STRICT(CALLER_ERROR),
  "patchDraftBodySchema/draft": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/assetPoints[]": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/assets[]": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/location": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/onboardingMeta": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/pointKeys[]": { strict: false, because: THREE_PRODUCERS },
  "patchDraftBodySchema/draft/rtus[]": { strict: false, because: THREE_PRODUCERS },
  putDashboardWidgetsBodySchema: STRICT(CALLER_ERROR),
  "putDashboardWidgetsBodySchema/widgets[]|0": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|0/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|0/config/thresholds[]": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|0/points[]": STRICT(CALLER_ERROR),
  "putDashboardWidgetsBodySchema/widgets[]|1": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|1/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|2": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|2/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  "putDashboardWidgetsBodySchema/widgets[]|3": STRICT(DASHBOARD_WIDGET_ARM),
  "putDashboardWidgetsBodySchema/widgets[]|3/config": STRICT(DASHBOARD_WIDGET_WRITE_CONFIG),
  reorderWorkOrdersBodySchema: STRICT(CALLER_ERROR),
  "reorderWorkOrdersBodySchema/items[]": STRICT(CALLER_ERROR),
  ruleDraftBodySchema: STRICT(CALLER_ERROR),
  "ruleDraftBodySchema/action": STRICT(CALLER_ERROR),
  "ruleDraftBodySchema/condition|0": STRICT(CALLER_ERROR),
  "ruleDraftBodySchema/condition|1": STRICT(CALLER_ERROR),
  ruleLifecycleBodySchema: STRICT(CALLER_ERROR),
  rulePreviewBodySchema: STRICT(CALLER_ERROR),
  "rulePreviewBodySchema/action": STRICT(CALLER_ERROR),
  "rulePreviewBodySchema/condition|0": STRICT(CALLER_ERROR),
  "rulePreviewBodySchema/condition|1": STRICT(CALLER_ERROR),
  ruleToggleBodySchema: STRICT(CALLER_ERROR),
  ruleUpdateBodySchema: STRICT(CALLER_ERROR),
  "ruleUpdateBodySchema/action": STRICT(CALLER_ERROR),
  "ruleUpdateBodySchema/condition|0": STRICT(CALLER_ERROR),
  "ruleUpdateBodySchema/condition|1": STRICT(CALLER_ERROR),
  setAssetGroupMemberRoleBodySchema: STRICT(
    "The body has exactly one field, so there is no second thing to set and an unknown key " +
      "is a caller error by construction. The mistake it catches is silent rather than " +
      'noisy: `{"role":null,"roleCode":"chiller"}` from a caller who meant to SET `chiller` ' +
      "would have `roleCode` stripped, CLEAR the role instead, and answer 200 — a " +
      "destructive read of an additive intent (`F3.37`, ADR 0049 decision 5).",
  ),
  setCredentialsBodySchema: STRICT(ALREADY),
  setRuleNotificationsBodySchema: STRICT(CALLER_ERROR),
  updateAssetBodySchema: STRICT(CALLER_ERROR),
  updateAssetPointBodySchema: STRICT(CALLER_ERROR),
  updateAssetTemplateBodySchema: STRICT(CALLER_ERROR),
  updateDashboardBodySchema: STRICT(CALLER_ERROR),
  "updateAssetTemplateBodySchema/content": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/alarms[]": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/alarms[]/philosophy": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/dashboards{}": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|0": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|0/config/thresholds[]": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|1": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|1/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|2": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|2/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|3": STRICT(
      "F3.1a (ADR 0047). A template dashboard widget is authored by hand, so an unknown key is " +
      "an author's typo and must be refused rather than silently dropped. The four arms are " +
      "strict here, and each `config` is the SHARED schema tightened at this boundary — " +
      "`radialGaugeConfigObjectSchema.strict()` and the exported `gaugeRangeIsOrdered` " +
      "predicate for the gauge, whose shared export is a ZodEffects with no `.strict()`. The " +
      "shared contracts stay tolerant because §4.8 requires a RESPONSE to survive a field the " +
      "server adds; strictness belongs on the write side, which is this one.",
    ),
  "updateAssetTemplateBodySchema/content/dashboards{}/widgets[]|3/config": STRICT(WIDGET_CONFIG),
  "updateAssetTemplateBodySchema/content/health": STRICT(HEALTH_SECTION),
  "updateAssetTemplateBodySchema/content/health/bands[]": STRICT(HEALTH_SECTION),
  "updateAssetTemplateBodySchema/content/kpis[]": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/maintenance[]": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/points[]": STRICT(CALLER_ERROR),
  updateLocationBodySchema: STRICT(CALLER_ERROR),
  updateMaintenanceScheduleBodySchema: STRICT(CALLER_ERROR),
  updateNotificationChannelBodySchema: STRICT(
    "The node E7.1f was raised for. `PATCH {\"name\":\"x\",\"organizationId\":\"<other>\"}` " +
      "answered 200 with the tenancy unchanged. Containment was never in doubt — " +
      "`ChannelsService.update` reads the organization from `loadExistingForWrite(id)` and " +
      "never from the body — but a caller that is not apps/web reads 200 as 'the move " +
      "succeeded'. Note the gap was only ever the mixed body: `{\"organizationId\":\"…\"}` " +
      "alone already 400d, because the non-empty `.refine()` runs after stripping.",
  ),
  updateOrganizationBodySchema: STRICT(CALLER_ERROR),
  updatePointKeyBodySchema: STRICT(CALLER_ERROR),
  updateRtuBodySchema: STRICT(CALLER_ERROR),
  updateWorkOrderStatusBodySchema: STRICT(CALLER_ERROR),
};

/**
 * Every walked node has an entry, every entry matches the code, and no
 * permissive entry is silent.
 *
 * The third check is the one that makes ruling 1's other half real. Adding
 * `.strict()` produces a test on its own; deciding **not** to produces nothing
 * at all, and "nothing" is indistinguishable from "nobody looked".
 */
export function testEveryNodeHasARecordedDecision(): void {
  const nodes = walkEveryBodySchema();

  const undecided = nodes.filter((n) => STRICTNESS_LEDGER[n.label] === undefined).map((n) => n.label);
  expect(
    undecided,
    `these request-body object nodes carry no recorded strictness decision:\n${undecided.join("\n")}\n\n` +
      "ADR 0029 Amendment 3 ruling 1: `.strict()` is a per-schema judgement, so a new object " +
      "node must be decided either way and the decision recorded here. Add `.strict()` and a " +
      "`{ strict: true, why }` entry, or leave it open and say why in `{ strict: false, because }`.",
  ).toEqual([]);

  const stale = nodes
    .filter((n) => {
      const entry = STRICTNESS_LEDGER[n.label];
      return entry !== undefined && entry.strict !== (n.unknownKeys === "strict");
    })
    .map((n) => `${n.label} — code says ${n.unknownKeys}, ledger says ${
      STRICTNESS_LEDGER[n.label]?.strict === true ? "strict" : "open"
    }`);
  expect(
    stale,
    `the ledger disagrees with the schemas:\n${stale.join("\n")}\n\n` +
      "Someone changed a schema's strictness without recording why, or recorded a decision " +
      "that was never applied. Both are the drift this ledger exists to refuse.",
  ).toEqual([]);

  const silent = Object.entries(STRICTNESS_LEDGER)
    .filter(([, entry]) => entry.strict === false && entry.because.trim() === "")
    .map(([label]) => label);
  expect(
    silent,
    `these nodes are left open with no reason given:\n${silent.join("\n")}\n\n` +
      "Ruling 1 asks for the reason where a node stays permissive. An empty `because` is the " +
      "silence this assertion exists to convert into a failure.",
  ).toEqual([]);
}

/**
 * **The walker is tested against constructs the registry does not contain yet.**
 *
 * Every other assertion here runs over the real schemas, so it can only catch
 * what is already in the tree. These three cases were each a live bug in this
 * file — found by review, not by the suite — and none of them is reachable from
 * `REQUEST_SCHEMAS` today. Without this test they would come back the moment
 * someone used `.catchall()`, `.brand()` or a tuple `.rest()` in a body schema,
 * and they would come back **silently**, which is the property that makes them
 * worth pinning rather than merely fixing.
 */
export function testTheWalkerSeesConstructsTheRegistryDoesNotUseYet(): void {
  // `.catchall()` reports `unknownKeys: "strict"` while ACCEPTING unknown keys.
  // A ledger that trusted `unknownKeys` would record this node as strict and be
  // wrong about the one thing it exists to state.
  const catchall = z.object({ a: z.string() }).strict().catchall(z.string());
  const catchallNodes = walkObjectNodes("probe", catchall);
  expect(
    catchallNodes[0]?.unknownKeys,
    "a .catchall() object accepts unknown keys, so it must NOT be reported as strict — " +
      "zod still says unknownKeys: 'strict' for it, which is the trap",
  ).not.toEqual("strict");
  expect(
    catchall.safeParse({ a: "x", surprise: "y" }).success,
    "sanity: this probe is only meaningful while .catchall() really does accept the key",
  ).toBe(true);

  // `.brand()` keeps its child on `_def.type`. Reading `_def.innerType` yielded
  // `undefined`, and a strict object underneath vanished from the audit.
  const branded = z.object({ inner: z.object({ b: z.string() }).strict() }).brand("probe");
  const brandedNodes = walkObjectNodes("brand", branded as unknown as ZodTypeAny);
  expect(
    brandedNodes.map((n) => n.label),
    "the walker must descend through .brand() and find the object underneath",
  ).toContain("brand/inner");
  expect(unhandled, "descending a branded schema must raise nothing").toEqual([]);

  // A tuple's `.rest()` element hangs off `_def.rest`, which nothing else reads.
  const tuple = z.object({ t: z.tuple([z.string()]).rest(z.object({ c: z.string() }).strict()) });
  const tupleNodes = walkObjectNodes("tup", tuple);
  expect(
    tupleNodes.map((n) => n.label),
    "the walker must find an object in a tuple's rest element",
  ).toContain("tup/t[...rest]");
}

/**
 * The ledger describes the tree that exists, not one that used to.
 *
 * Without this, deleting a schema leaves its entries behind and the ledger
 * slowly becomes a list of things that are no longer true — readable, plausible
 * and wrong, which is worse than absent.
 */
export function testTheLedgerHasNoEntriesForNodesThatAreGone(): void {
  const live = new Set(walkEveryBodySchema().map((n) => n.label));
  const orphans = Object.keys(STRICTNESS_LEDGER).filter((label) => !live.has(label));

  expect(
    orphans,
    `the ledger records decisions for nodes that no longer exist:\n${orphans.join("\n")}\n\n` +
      "A schema was renamed, reshaped or deleted. Remove the entry, or restore the node — a " +
      "ledger that describes a tree that is gone reads as an audit and is not one.",
  ).toEqual([]);
}

/**
 * Every schema the document is built from reaches the ledger, **by identity**.
 *
 * By identity and not by name, because a name comparison is satisfied by a
 * second schema that happens to be exported under the same name — and because
 * the failure this guards is a new route being registered while this file's
 * import list stands still.
 */
export function testEveryRegisteredSchemaIsUnderAudit(): void {
  const known = new Set<ZodTypeAny>([
    ...Object.values(BODY_SCHEMAS),
    ...Object.values(QUERY_SCHEMAS),
  ]);

  // **Pin the query list, or this assertion has a hole shaped like a shortcut.**
  // `REQUEST_SCHEMAS` records no HTTP method, so a schema satisfies the check
  // from EITHER map. A developer who adds a route, sees "in no audit list" and
  // pastes the name into `QUERY_SCHEMAS` skips the strictness audit entirely,
  // with a green build. Eight was the owner's 2026-08-28 boundary; a ninth
  // must be a deliberate act, not a way out of a failing test.
  //
  // **`F3.1b` widened it to ten, deliberately: `listDashboardsQuerySchema` and
  // `getDashboardQuerySchema` (both carry D5's `organizationId` disambiguator)
  // are genuinely new GET query schemas, not a body schema smuggled in to
  // dodge the strictness audit below — both are plain, unstrict `organizationId`
  // filters with no request body to decide strictness for.**
  //
  // **`F3.35` Stage A widened it to eleven: `pointAggregateQuerySchema`
  // (`GET /telemetry/points/:pointRef/aggregate`, ADR 0048 decision 3).** It is
  // a GET with three query parameters and no body at all, so there is no
  // strictness to decide — and it is registered rather than skipped because the
  // adjacent `TelemetryController_recent` is the precedent that loses:
  // `F4.20`'s finding is that a served document describing a parameter as
  // absent is wrong, not merely thin, and a three-parameter general aggregate
  // read needs to be discoverable more than `?window=15m` did.
  expect(
    Object.keys(QUERY_SCHEMAS).length,
    "QUERY_SCHEMAS is the deliberately-excluded list, not an escape hatch. If a genuinely " +
      "new query schema was registered, widen this number and say so; if a BODY schema was " +
      "put here to quiet the assertion below, put it in BODY_SCHEMAS and decide it.",
  ).toBe(11);

  const missing = Object.entries(REQUEST_SCHEMAS)
    .filter(([, schema]) => !known.has(schema))
    .map(([operationId]) => operationId);

  expect(
    missing,
    `these registered request schemas are in no audit list:\n${missing.join("\n")}\n\n` +
      "A route gained a schema and this file did not hear about it, so its object " +
      "nodes carry no recorded decision about unknown keys (E7.1f, ADR 0029 " +
      "Amendment 3 ruling 1). Add the schema to BODY_SCHEMAS or QUERY_SCHEMAS.",
  ).toEqual([]);
}

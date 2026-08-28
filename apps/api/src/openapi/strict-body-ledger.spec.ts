import { expect } from "vitest";
import type { ZodTypeAny } from "zod";

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
 * `.strict()`. **It does not** — measured, and corrected by that amendment's
 * Errata 1. Under this repo's converter options a plain `z.object` already
 * emits `additionalProperties: false`; strip and strict are byte-identical and
 * only `.passthrough()` differs. A gate keyed on the emitted value would
 * therefore assert nothing at all. This one reads `_def.unknownKeys` off the
 * Zod tree, which is the only place the distinction survives.
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
  reorderWorkOrdersBodySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  rulePreviewBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
  setCredentialsBodySchema,
  setRuleNotificationsBodySchema,
  updateAssetBodySchema,
  updateAssetPointBodySchema,
  updateAssetTemplateBodySchema,
  updateLocationBodySchema,
  updateMaintenanceScheduleBodySchema,
  updateNotificationChannelBodySchema,
  updateOrganizationBodySchema,
  updatePointKeyBodySchema,
  updateRtuBodySchema,
  updateWorkOrderStatusBodySchema,
};

/**
 * The eight registered **query** schemas.
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
 */
export const QUERY_SCHEMAS: Record<string, ZodTypeAny> = {
  auditExportQuerySchema,
  auditListQuerySchema,
  energyReportQuerySchema,
  listDeliveriesQuerySchema,
  listMaintenanceQuerySchema,
  listRuleExecutionsQuerySchema,
  locationDashboardQuerySchema,
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
    if (schema === undefined || schema === null || seen.has(schema)) return;
    seen.add(schema);

    const def = defOf(schema);
    const typeName = def.typeName ?? "(no typeName)";

    if (!UNWRAPPED.has(typeName)) {
      if (!TERMINAL.has(typeName)) unhandled.push(`${label} — ${typeName}`);
      return;
    }

    switch (typeName) {
      case "ZodObject": {
        found.push({ label, unknownKeys: String(def.unknownKeys) });
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
      case "ZodBranded":
      case "ZodPromise":
        visit(def.innerType as ZodTypeAny, label);
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
 * **The finding this audit produced, and the reason the ledger is uniform.**
 *
 * `E7.1f` asked whether an unknown key is a caller error *per node*. The answer
 * came out the same for all 73, and that is a property of the codebase rather
 * than a shortcut: **every schema that needs open-ended data already has a
 * `z.record` for it** — `meta` on locations, assets, RTUs, organizations and
 * template drafts; `config` on an RTU and a notification channel;
 * `credentials`; `sourceDataKeyVars`; `dashboards`. `.strict()` does not close
 * any of those. So there is no node where a caller has a legitimate key with
 * nowhere to put it, which is the only thing that would argue for leaving one
 * open.
 *
 * That is a finding, not an absence of one. It is also why the `strict: false`
 * branch stays in the type and stays asserted: the next schema added without a
 * `z.record` escape hatch is the one that will need it, and it must explain
 * itself rather than inherit this paragraph.
 */
const CALLER_ERROR =
  "Every field this endpoint accepts is named in the schema, and open-ended data has a " +
  "`z.record` home that `.strict()` does not close. A key outside that set is a caller " +
  "error — today it is dropped and answered 200, which reads as 'accepted'.";

const CREDENTIAL =
  "Carries credential material (§9.6, ADR 0022/ADR 0012). An unknown key silently dropped " +
  "on a credential write is the case with the least excuse for being quiet.";

const ROUND_TRIP =
  "Round-tripped: apps/web reads this shape from a response contract and sends it back " +
  "verbatim (`patchDraft` sends `OnboardingSessionDto[\"draft\"]`). The request schema in " +
  "apps/api and the response contract in packages/shared/src/contracts/onboarding.ts are " +
  "two copies of one shape, and they were compared field by field at every level before " +
  "this was made strict — they match exactly today. `.strict()` deliberately couples them: " +
  "a field added to the response contract alone now breaks the round-trip loudly, at the " +
  "first PATCH, instead of being silently dropped forever.";

const ALREADY =
  "Strict before E7.1f, for a reason recorded beside the schema. Listed so the audit is " +
  "complete rather than only the nodes this item changed.";

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
  "createAssetTemplateBodySchema/content/kpis[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/content/maintenance[]": STRICT(ALREADY),
  "createAssetTemplateBodySchema/points[]": STRICT(CALLER_ERROR),
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
  "patchDraftBodySchema/draft": STRICT(ROUND_TRIP),
  "patchDraftBodySchema/draft/assetPoints[]": STRICT(ROUND_TRIP),
  "patchDraftBodySchema/draft/assets[]": STRICT(ROUND_TRIP),
  "patchDraftBodySchema/draft/location": STRICT(ROUND_TRIP),
  "patchDraftBodySchema/draft/onboardingMeta": STRICT(ROUND_TRIP),
  "patchDraftBodySchema/draft/pointKeys[]": STRICT(ROUND_TRIP),
  "patchDraftBodySchema/draft/rtus[]": STRICT(ROUND_TRIP),
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
  setCredentialsBodySchema: STRICT(ALREADY),
  setRuleNotificationsBodySchema: STRICT(CALLER_ERROR),
  updateAssetBodySchema: STRICT(CALLER_ERROR),
  updateAssetPointBodySchema: STRICT(CALLER_ERROR),
  updateAssetTemplateBodySchema: STRICT(CALLER_ERROR),
  "updateAssetTemplateBodySchema/content": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/alarms[]": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/alarms[]/philosophy": STRICT(ALREADY),
  "updateAssetTemplateBodySchema/content/dashboards{}": STRICT(ALREADY),
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

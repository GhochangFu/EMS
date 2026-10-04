import { BadRequestException, ConflictException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { assets, automationRules, pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  SOURCE_KEY_RESERVED_VAR,
  substituteSourceKeyPattern,
} from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { SOURCE_DATA_KEY_MAX_LENGTH } from "../../calc/computed-source-data-key";
import type { BmsTx } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import type { VocabularyExecutor } from "../../vocabularies/vocabularies.service";
import { assertDashboardBatchFits } from "./asset-dashboards-plan";
import { parseStoredTemplateContent } from "./asset-templates-content.schema";
import type { TemplateContentParsed } from "./asset-templates-content.schema";
import type { InstantiateAssetBody } from "./asset-templates.schema";
import type { PointRow, TemplateRow } from "./asset-templates-write-guards";
import {
  MAX_RULE_ROWS,
  seededRuleCode,
  type TemplateAlarm,
} from "./template-alarm-rules";
import {
  alarmVocabularyMessage,
  findAlarmVocabularyProblem,
} from "./template-alarm-vocabularies";

/**
 * `F3.22` PR 1 (ADR 0091 decision 1) — the instantiate guards, moved verbatim out of
 * `AssetTemplateInstantiationService` with their executors and collaborators turned into
 * parameters, so the transaction-aware core (`asset-templates-instantiate-core.ts`) calls
 * them on its own `tx`. A `db: BmsDb` parameter accepts that `tx`.
 */

/**
 * The `{token}` grammar and the reserved `asset_code` variable used to be this
 * service's private constants. `F2.7` (ADR 0056 decision 10) moved them to
 * `@bms/shared`'s `source-key-pattern` module, because the mapping sheet's
 * pre-fill and the instantiate dialog read the same grammar — one vocabulary,
 * wired twice, declared once. `resolveSourceDataKey` below keeps its behaviour
 * byte for byte over the shared `substituteSourceKeyPattern`.
 */

/**
 * `bms.asset_points.source_data_key` is `varchar(128)`. `F4.193`: one constant
 * with the leaf module the onboarding template check imports, not a second 128.
 */
export const SOURCE_DATA_KEY_MAX = SOURCE_DATA_KEY_MAX_LENGTH;

/**
 * Ceiling on `asset_points` rows per call.
 *
 * Postgres caps a statement at 65,535 bind parameters. The point insert binds
 * 7 columns per row, so a single statement fails above ~9,360 rows — and the
 * Zod contract permits 200 assets × 500 template points = 100,000. Without
 * this bound a legitimately large batch returns a raw driver error instead of
 * a domain one. Set well under the hard limit so the message stays the thing
 * the caller sees.
 */
export const MAX_POINT_ROWS = 8_000;

/** The resolved target — an RTU implies its location. */
export type InstantiationTarget = {
  locationId: string;
  locationName: string;
  organizationId: string;
  /**
   * The gateway the batch attaches to, or `null` on the location branch.
   *
   * **The id only, never the RTU's flags** (`F4.139` second pass). `resolveTarget`
   * used to run on `fleetDb`, before `withTenant` opened the transaction the batch
   * is written in; carrying `ingest_enabled`/`source_type` across that boundary
   * made half of the `telemetrySource` predicate read a row from outside the
   * write's transaction, so an operator disabling the RTU between the two reads
   * got a batch derived from the flags as they were before the write began. The
   * flags are read on the tenant transaction instead (`deriveTelemetrySource`);
   * `resolveTarget` reads on `tx` since `F3.22`, but its miss probe reads `fleetDb`.
   */
  rtuId: string | null;
};

/** One asset's plan, computed before anything is written. */
export type AssetPlan = {
  entry: InstantiateAssetBody;
  points: { pointKey: string; sourceDataKey: string; unit: string | null }[];
  skippedPoints: string[];
};

/**
 * Re-validates every point key against the org's **active** catalog and
 * returns the catalog units, in one query.
 *
 * ADR 0015 §3 says to re-validate "through the same path
 * `resolveCatalogPointKey` already uses". Applied literally to 40 assets ×
 * 12 points that is 480 identical single-row queries; this issues one with
 * the same three predicates and the same unit fallback (Amendment 1C). The
 * error names the template version, because a caller told only "inactive
 * point key" cannot tell whether to fix the catalog or the template.
 */
export async function assertCatalogActive(
  db: BmsDb,
  points: PointRow[],
  template: TemplateRow,
): Promise<Map<string, string | null>> {
  const codes = [...new Set(points.map((point) => point.pointKey))];
  const rows = await db
    .select({ code: pointKeys.code, unit: pointKeys.unit })
    .from(pointKeys)
    // `F3.39`: no organization predicate — `bms.point_keys` is fleet-wide
    // after migration `0057`, and a template's point keys resolve the same
    // way in every organization. That is the property ADR 0051 decision 2
    // exists to give a stock dashboard template.
    .where(and(eq(pointKeys.active, true), inArray(pointKeys.code, codes)));

  const units = new Map(rows.map((row) => [row.code, row.unit]));
  const missing = codes.filter((code) => !units.has(code));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Cannot instantiate ${template.code} v${template.version}: these point keys are no ` +
        `longer in the organization's active catalog: ${missing.join(", ")}. ` +
        "Reactivate them, or publish a new template version without them.",
    );
  }
  return units;
}

/**
 * The parsed content the published version carries — ADR 0058 D7. Since
 * `F3.2` both the alarms and the dashboard views come from this one parse.
 *
 * A 409 and not the publish path's 400, because the two failures have
 * different remedies. Publishing is refused so the author can `PATCH` the
 * draft back into conformance; a *published* version is immutable, so the
 * only way forward here is a new version. Never a silent zero-rule seed: a
 * batch that reported success is a batch nobody inspects, and the missing
 * rules would be found the first time a limit was breached and no alarm rose.
 */
export function parseTemplateContentForInstantiate(
  template: TemplateRow,
): TemplateContentParsed {
  const parsed = parseStoredTemplateContent(template.content);
  if (!parsed.ok) {
    throw new ConflictException(
      `Cannot instantiate ${template.code} v${template.version}: its stored content no longer ` +
        "matches the current content contract, so the alarms it carries cannot be read. " +
        "A published version is immutable — create a new draft from it, repair the content " +
        `and publish that version instead. ${parsed.detail}`,
    );
  }
  return parsed.content;
}

/**
 * Re-validates the alarms' `category`, `severity` and `philosophy.skill`
 * against the live vocabularies, **before anything is written**.
 *
 * The publish gate is not enough on its own. A published version is
 * immutable and its content is frozen, but the vocabularies are not: a value
 * live at publish can be `active = false` by the time someone presses
 * instantiate, and `E2.4` is what gave that case a consequence — every alarm
 * now becomes a `bms.automation_rules` row that stamps `category` and
 * `severity` into columns behind `automation_rules_category_fk` /
 * `automation_rules_severity_fk`. Ungated, a retired code either fails the
 * insert as a raw driver error or, when the row still exists and is merely
 * retired, succeeds *silently* — a rules table quietly seeded from a
 * vocabulary the organization has withdrawn, which nobody looks for because
 * the batch reported success. This refuses instead, in the same place and for
 * the same reason `assertCatalogActive` re-checks point keys.
 *
 * **409 rather than the 400 `assertCatalogActive` uses**, matching every
 * other state-of-the-world refusal in this service (not published, no points,
 * codes taken, content no longer parses): nothing is wrong with the request,
 * the estate changed under a frozen version.
 *
 * **The message never echoes the stored value** — see the module comment on
 * `template-alarm-vocabularies.ts`. `content` is `jsonb` with no foreign key,
 * so the offending value is arbitrary stored text; this names the path and
 * lists the live codes, exactly as the publish path does.
 *
 * The `list()` call is skipped when the version carries no alarms, which is
 * both the common case and what keeps every pre-`E2.4` instantiation on the
 * queries it already made.
 *
 * One gap, stated rather than left to be found: an alarm with **no**
 * category seeds its rule at `DEFAULT_RULE_CATEGORY_CODE`, and that code is
 * not checked here — absent is not a problem for the publish gate either, and
 * making the two disagree is the drift this shared check exists to prevent.
 * Retiring the default category is a fleet-wide event with its own blast
 * radius; it is not this method's to catch.
 *
 * **`db` is required, and the core passes its `tx`** (`F3.22`). The
 * instantiate core runs inside `withTenant`, and `VocabulariesService`'s own
 * executor is that same tenant pool: a read there holds one tenant connection
 * while it waits for a second, which on a full pool never comes. See
 * `VocabularyExecutor`.
 */
export async function assertAlarmVocabulariesStillLive(
  vocabularies: VocabulariesService,
  db: VocabularyExecutor,
  alarms: TemplateAlarm[],
  template: TemplateRow,
): Promise<void> {
  if (alarms.length === 0) {
    return;
  }
  const { ruleCategories, alarmSeverities, alarmSkills } =
    await vocabularies.list(db);
  const problem = findAlarmVocabularyProblem(alarms, {
    ruleCategories,
    alarmSeverities,
    alarmSkills,
  });
  if (!problem) {
    return;
  }
  throw new ConflictException(
    `Cannot instantiate ${template.code} v${template.version}: ` +
      `${alarmVocabularyMessage(problem)} ` +
      `Reactivate that ${problem.axis}, or publish a new template version that does not ` +
      "use it.",
  );
}

/** Keeps one statement under the Postgres bind-parameter ceiling. */
export function assertBatchFits(
  assetCount: number,
  measuredCount: number,
  alarmCount: number,
  dashboardWidgetCount: number,
): void {
  const rows = assetCount * measuredCount;
  if (rows > MAX_POINT_ROWS) {
    throw new BadRequestException(
      `This batch would create ${rows} asset points (${assetCount} assets × ` +
        `${measuredCount} measured points), over the ${MAX_POINT_ROWS} limit for one call. ` +
        "Split it into smaller batches.",
    );
  }
  // `E2.4`: the same arithmetic one table over. The rule insert binds 26
  // columns per row against Postgres' 65,535 bind-parameter ceiling, so
  // `MAX_RULE_ROWS` leaves about twenty rows of headroom — anything that
  // widens `seededRuleValues` must re-measure it there. Without this bound
  // the contract's 200 assets x 200 alarms would reach the driver as a raw
  // error instead of this named one.
  const ruleRows = assetCount * alarmCount;
  if (ruleRows > MAX_RULE_ROWS) {
    throw new BadRequestException(
      `This batch would seed ${ruleRows} automation rules (${assetCount} assets × ` +
        `${alarmCount} template alarms), over the ${MAX_RULE_ROWS} limit for one call. ` +
        "Split it into smaller batches.",
    );
  }
  // `F3.2` / ADR 0067 d4 — the third term, and the only one bounding the
  // TRANSACTION rather than a bind-parameter count. Last, so an over-large
  // batch names the bound it breached first.
  assertDashboardBatchFits(assetCount, dashboardWidgetCount);
}

/**
 * Fails before writing anything when a rule code this batch would derive is
 * already taken, or is taken twice by the batch itself — ADR 0058 D4.
 *
 * Two checks, because they fail for genuinely different reasons.
 *
 * **Intra-batch.** `seededRuleCode` normalises, so `high-temp` and
 * `high_temp` are distinct template alarm codes (uniqueness there is exact
 * match only) that derive the *same* rule code — and so do two asset codes
 * that differ only in punctuation. Both are legal inputs today and would
 * reach Postgres as a self-collision inside the transaction.
 *
 * **Already taken.** Scanned across **every** lifecycle status, unlike
 * `assertRuleCodeAvailable`, which excludes `archived`. That exclusion is a
 * pre-existing mismatch with the live index: `automation_rules_org_code_idx`
 * is a *total* unique index on `(organization_id, code)`, so an archived rule
 * really does hold its code. Inheriting the bug here would turn a batch of
 * forty assets into a rolled-back constraint error.
 *
 * On the core's `tx` since `F3.22` (ADR 0091 decision 1), so a rule seeded
 * earlier in the same transaction is seen. `automation_rules` is `FORCE`d and
 * the GUC `withTenant` set is the template's organization — which is where the
 * unique index is scoped, so `tx` sees every row that can collide, and unlike
 * the asset-code check this discloses nothing across a tenant boundary.
 */
export async function assertRuleCodesFree(
  db: BmsDb,
  organizationId: string,
  entries: InstantiateAssetBody[],
  alarms: TemplateAlarm[],
): Promise<void> {
  if (alarms.length === 0) {
    return;
  }
  const derivedBy = new Map<string, string>();
  const collisions: string[] = [];
  for (const entry of entries) {
    for (const alarm of alarms) {
      const code = seededRuleCode(entry.code, alarm.code);
      const first = derivedBy.get(code);
      if (first) {
        // Asset codes only, never `alarm.code`. The alarm code is stored
        // `jsonb` with no charset restriction, and `template-alarm-vocabularies.ts`
        // states the rule for this service: no field that can hold a stored
        // value. Naming the two asset codes — which the caller just typed into
        // this request body — says exactly as much about what to rename.
        collisions.push(`${code} (from assets ${first} and ${entry.code})`);
        continue;
      }
      derivedBy.set(code, entry.code);
    }
  }
  if (collisions.length > 0) {
    throw new ConflictException(
      "This batch would derive the same rule code twice — a rule code is unique per " +
        `organization, so nothing was written: ${collisions.join("; ")}. ` +
        "Rename one of the asset codes, or one of the template's alarm codes — two alarm " +
        "codes differing only in punctuation derive the same rule code.",
    );
  }

  const taken = await db
    .select({ code: automationRules.code })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organizationId, organizationId),
        inArray(automationRules.code, [...derivedBy.keys()]),
      ),
    );
  if (taken.length > 0) {
    throw new ConflictException(
      "Cannot seed this template's alarms — these rule codes already exist in this " +
        `organization: ${taken.map((row) => row.code).join(", ")}. Rule codes are unique per ` +
        "organization across every lifecycle status, archived rules included. " +
        "Nothing was written.",
    );
  }
}

/**
 * Fails before writing anything when a code is already taken.
 *
 * `bms.assets.code` is *globally* unique, not per-location (ADR 0015 §6), so
 * without this a collision on asset 39 rolls back all 40 and reports a
 * constraint name.
 *
 * The disclosure is deliberately scoped. A global `WHERE code IN (...)` that
 * echoes every hit turns this into a cross-tenant existence oracle: a caller
 * could submit 200 guessable codes per call and learn which exist anywhere in
 * the deployment, including other organizations' equipment — and because this
 * refuses before the first insert, the probe writes nothing and raises no audit
 * row. So codes inside the caller's own writable scope are named (that is the
 * useful, ADR-mandated part) and any others are reported only as a count.
 *
 * **Two reads, combined by code** (`F3.22`, plan §11 Q1). `tx` sees this
 * organization's rows, including one written earlier in the same transaction;
 * `fleetDb` sees the committed estate, every organization. A code found by both
 * is kept once, from the `tx` read, so a committed same-organization collision
 * is not counted twice.
 */
export async function assertAssetCodesFree(
  tx: BmsTx,
  fleetDb: BmsDb,
  accessControl: AccessControlService,
  jwt: JwtPayload,
  entries: InstantiateAssetBody[],
): Promise<void> {
  const codes = entries.map((entry) => entry.code);
  const sameOrganization = await tx
    .select({ code: assets.code, locationId: assets.locationId })
    .from(assets)
    .where(inArray(assets.code, codes));
  // E7.1b: `assets` read on `fleetDb` — FORCEd in 0047. This collision check
  // must see across the tenant boundary (codes are unique estate-wide, and a
  // tenant read sees one organization only, so it would miss a collision and
  // let the INSERT fail with a raw constraint error instead of a named one);
  // the grant is applied below only to decide which codes may be NAMED versus
  // counted.
  const estate = await fleetDb
    .select({ code: assets.code, locationId: assets.locationId })
    .from(assets)
    .where(inArray(assets.code, codes));
  const seen = new Set(sameOrganization.map((row) => row.code));
  const taken = [...sameOrganization, ...estate.filter((row) => !seen.has(row.code))];
  if (taken.length === 0) {
    return;
  }

  const writableIds = await accessControl.writableLocationIds(jwt);
  const visible = taken.filter(
    (row) => writableIds === null || writableIds.includes(row.locationId),
  );
  const hidden = taken.length - visible.length;

  const parts: string[] = [];
  if (visible.length > 0) {
    parts.push(`already exist: ${visible.map((row) => row.code).join(", ")}`);
  }
  if (hidden > 0) {
    parts.push(
      `${hidden} more are already in use outside your access scope (codes are globally unique)`,
    );
  }
  throw new ConflictException(
    `Cannot create these assets — ${parts.join("; ")}. ` +
      "Asset codes are globally unique, not per location.",
  );
}

/**
 * Computes one asset's point rows, or throws.
 *
 * A **required** measured point that resolves to no key aborts the batch —
 * `source_data_key` is `NOT NULL` and a placeholder would be a lie that
 * `apps/ingest` later reads as wiring (§6 step 6). An explicitly **optional**
 * one is skipped and reported, which is the only other honest option.
 */
export function planAsset(
  entry: InstantiateAssetBody,
  measured: PointRow[],
  catalogUnits: Map<string, string | null>,
): AssetPlan {
  const points: AssetPlan["points"] = [];
  const skippedPoints: string[] = [];

  for (const point of measured) {
    const sourceDataKey = resolveSourceDataKey(point, entry);
    if (sourceDataKey === null) {
      if (point.required) {
        throw new BadRequestException(
          `Asset "${entry.code}": required point "${point.pointKey}" has no resolvable ` +
            `source data key. Pattern: ${point.sourceDataKeyPattern ?? "(none set)"}; ` +
            `variables supplied: ${Object.keys(entry.sourceDataKeyVars ?? {}).join(", ") || "(none)"}.`,
        );
      }
      skippedPoints.push(point.pointKey);
      continue;
    }
    if (sourceDataKey.length > SOURCE_DATA_KEY_MAX) {
      throw new BadRequestException(
        `Asset "${entry.code}": point "${point.pointKey}" resolved to a source data key of ` +
          `${sourceDataKey.length} characters, over the ${SOURCE_DATA_KEY_MAX} limit.`,
      );
    }
    points.push({
      pointKey: point.pointKey,
      sourceDataKey,
      // The template's unit is an *override*; null means "use the catalog's",
      // which is exactly what `resolveCatalogPointKey` returns as its fallback.
      unit: point.unit ?? catalogUnits.get(point.pointKey) ?? null,
    });
  }

  return { entry, points, skippedPoints };
}

/**
 * Substitutes `{token}`s in a point's pattern. Returns `null` when the point
 * has no pattern or any token is unsupplied — never a partially substituted
 * key, which would be a plausible-looking string pointing at nothing.
 *
 * `asset_code` is always the asset's own `code`, spread **last** so a caller's
 * `sourceDataKeyVars` cannot override it — two assets in one batch resolving
 * to the same `source_data_key` would silently alias two pieces of equipment
 * onto one telemetry stream. The prototype guard (`{constructor}` must not
 * resolve to a function) lives in `substituteSourceKeyPattern`, which reads
 * `vars` by own-property only.
 */
export function resolveSourceDataKey(
  point: PointRow,
  entry: InstantiateAssetBody,
): string | null {
  const pattern = point.sourceDataKeyPattern;
  if (!pattern) {
    return null;
  }
  const { key, unresolved } = substituteSourceKeyPattern(pattern, {
    ...(entry.sourceDataKeyVars ?? {}),
    [SOURCE_KEY_RESERVED_VAR]: entry.code,
  });
  return unresolved.length > 0 || key === "" ? null : key;
}

/**
 * Backstop for a code taken between a pre-check and the insert — for an asset
 * code, and since `E2.4` for a seeded rule code too.
 *
 * Branched on the constraint name rather than collapsed into one message: the
 * two say different things to whoever hit them, and the asset-code text is
 * matched by `F2.2`'s rollback case. `automation_rules_org_code_idx` is the
 * live index name — migration `0048` re-keyed rule identity to
 * `(organization_id, code)`, and `automation_rules_code_unique` has never
 * existed in this database.
 */
export function translateAssetCodeCollision(err: unknown): unknown {
  const constraint = (err as { constraint?: string } | null)?.constraint;
  if (constraint === "assets_code_unique") {
    return new ConflictException(
      "An asset code in this batch was taken while the batch was being created. " +
        "Nothing was written — retry with fresh codes.",
    );
  }
  if (constraint === "automation_rules_org_code_idx") {
    return new ConflictException(
      "A rule code this template's alarms would seed was taken while the batch was being " +
        "created. Nothing was written — no asset, no point and no rule — so retry.",
    );
  }
  return err;
}

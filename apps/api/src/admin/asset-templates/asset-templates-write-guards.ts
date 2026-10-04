import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetTemplates, pointKeys, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
// ADR 0049 decision 2 — the template lifecycle is declared once, in
// `@bms/shared/contracts/template-lifecycle`; `assertTransition` below reads it.
// `tests/f3.36-template-lifecycle-single-source.test.ts` fails a second copy.
import { archiveRefusedMessage, canTransition, draftRequiredMessage } from "@bms/shared";
import type { JwtPayload, TemplateLifecycleStatus } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import type { BmsTx } from "../../database/tenant-context";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import {
  findUnresolvedContentRefs,
  parseStoredTemplateContent,
  type TemplateContentParsed,
} from "./asset-templates-content.schema";
import {
  boundedMissingPointKeys,
  crossRefPointKeys,
  type CrossRefCandidatePoint,
} from "./asset-templates-cross-refs";
import { paramRefKeys, unknownParameterKeysMessage } from "./asset-templates-param-refs";
import { toTemplatePointInsert } from "./asset-templates-point-rows";
import type { TemplatePointBody } from "./asset-templates.schema";
import {
  alarmVocabularyMessage,
  findAlarmVocabularyProblem,
} from "./template-alarm-vocabularies";

/**
 * `F3.22` PR 1 (ADR 0091 decision 1) — the template write guards, moved out of
 * `AssetTemplatesAdminService` as functions that take their executor
 * (`tx` / `db`) explicitly, so a caller that already holds a transaction can run
 * them on it. Bodies and messages are moved unchanged; the service keeps
 * one-line delegators for the methods another method still calls.
 */

export type TemplateRow = typeof assetTemplates.$inferSelect;
export type PointRow = typeof templatePoints.$inferSelect;

/**
 * One template row by id, read on the caller's `tx` and selecting
 * `asset_templates` alone (no `organizations` join). 404 when it misses.
 */
export async function fetchTemplateRow(tx: BmsTx, id: string): Promise<TemplateRow> {
  const [row] = await tx.select().from(assetTemplates).where(eq(assetTemplates.id, id)).limit(1);
  if (!row) {
    throw new NotFoundException("Asset template not found");
  }
  return row;
}

/**
 * A template's stored point set, ordered as `replacePoints` wrote it.
 *
 * E7.1b: read on `fleetDb`. Under `0047`'s `FORCE` a `tenantDb` read with no
 * GUC would see zero rows — and `publish` reads this to reject "no points",
 * so the failure would be a loud but wrong rejection.
 */
export async function loadTemplatePoints(db: BmsDb, templateId: string): Promise<PointRow[]> {
  return db
    .select()
    .from(templatePoints)
    .where(eq(templatePoints.templateId, templateId))
    .orderBy(asc(templatePoints.sortOrder));
}

/**
 * A lifecycle transition, checked against the one declaration.
 *
 * The two refusal strings are asserted on byte for byte by
 * `asset-templates.lifecycle.integration.spec.ts`, which is why they live in
 * `template-lifecycle.ts` rather than being rebuilt here.
 */
export function assertTransition(template: TemplateRow, to: TemplateLifecycleStatus): void {
  const from = template.status as TemplateLifecycleStatus;
  if (canTransition(from, to)) return;
  throw new ConflictException(
    to === "archived" ? archiveRefusedMessage(from) : draftRequiredMessage(from, "published"),
  );
}

/**
 * Every point key must resolve to an **active** row in the fleet-wide catalog
 * (ADR 0010 §5, as amended), and the error names every offending code.
 *
 * Naming them matters: instantiation re-validates through the same rule, and
 * a caller told only "invalid point key" has to bisect a 40-point template by
 * hand to find which one was deactivated.
 *
 * **`F3.42` — this stays, beside migration `0058`'s foreign key, because the
 * two check different things.** The constraint holds *existence* against
 * every writer, including the seed, which does not come through here. This
 * holds `active = true`, which no foreign key can express — a retired code
 * keeps its row — and it names the codes, which a constraint violation cannot.
 * ADR 0051 Amendment 3 decision 2.
 *
 * The message said "this organization's active point-key catalog" until
 * `F3.42`. There has been no organization catalog since `0057`;
 * `resolveCatalogPointKey`'s equivalent was corrected in `F3.39` and this one
 * was missed.
 */
export async function assertPointKeysActive(
  db: BmsDb,
  points: CrossRefCandidatePoint[],
): Promise<void> {
  // `F2.9` / ADR 0055: a `bms-calc-v2` aggregate names its point key inside
  // the formula string, where `0058`'s foreign key cannot see it. Folded in
  // here rather than at one call site so create, update and publish all get
  // it — a PATCH is the common authoring path, and a key checked on create
  // but not on update is a hole with a green test above it.
  const declared = [...points, ...crossRefPointKeys(points)];
  if (declared.length === 0) {
    return;
  }
  const codes = [...new Set(declared.map((point) => point.pointKey))];
  const rows = await db
    .select({ code: pointKeys.code })
    .from(pointKeys)
    // `F3.39`: fleet-wide catalog, so the lookup is by code alone.
    .where(and(eq(pointKeys.active, true), inArray(pointKeys.code, codes)));

  const active = new Set(rows.map((row) => row.code));
  // `F2.9`: bounded — `crossRefPointKeys` above lifts keys out of the formula
  // string, which nothing bounds at 128. See `boundedMissingPointKeys`.
  const missing = boundedMissingPointKeys(codes.filter((code) => !active.has(code)));
  if (missing.length > 0) {
    throw new BadRequestException(`Not in the active point-key catalog: ${missing.join(", ")}`);
  }
}

/**
 * `E4.1a` / ADR 0070 decision 4 — every `$key` a `bms-calc-v3` point or KPI
 * names must be in `bms.calc_parameter_keys`. Folded beside
 * `assertPointKeysActive` for the same reason it is: create, update and
 * publish all get it. **A key that exists but has no value in scope is not
 * refused** — the value is per organization and per date and a stock
 * template's author cannot see either; that is the sweep's `parameter_unset`.
 */
export async function assertParameterKeysKnown(
  calcParameters: CalcParametersService,
  points: readonly CrossRefCandidatePoint[],
  kpis: readonly { expression: string; dialect?: string | null }[] | undefined,
): Promise<void> {
  const codes = paramRefKeys(points, kpis ?? []);
  if (codes.length === 0) {
    return;
  }
  const unknown = await calcParameters.unknownKeys(codes);
  if (unknown.length > 0) {
    throw new BadRequestException(unknownParameterKeysMessage(unknown));
  }
}

/**
 * Re-parses a stored `content` value under the current contract.
 *
 * `F2.1` shipped this column behind `z.record(z.unknown())`, so a row written
 * before ADR 0019 may hold JSON the tightened envelope rejects. Such a row
 * keeps reading and keeps instantiating — nothing consumes `content` — but it
 * cannot be *published*, because publishing puts it behind an immutable
 * version, which is the one state with no cheap way out. The error says how
 * to move forward rather than only what is wrong.
 */
export function parseStoredContentForPublish(template: TemplateRow): TemplateContentParsed {
  // `E2.4`: the parse and the structure-only (non-echoing) issue renderer now
  // live in `asset-templates-content.schema.ts`, because `instantiate` reads
  // the same stored column for its alarms and owes a different status for the
  // same failure (ADR 0058 D7 — a 409, not this 400). Extracted rather than
  // copied: the non-echoing property is security-relevant, and a second copy
  // is a second thing to remember when the first one is tightened. **The
  // message below is unchanged, byte for byte** — the lifecycle integration
  // suite matches on it.
  const parsed = parseStoredTemplateContent(template.content);
  if (!parsed.ok) {
    throw new BadRequestException(
      "This template's stored content does not match the current content contract, " +
        `so it cannot be published. PATCH \`content\` into conformance first. ${parsed.detail}`,
    );
  }
  return parsed.content;
}

/**
 * Every point key `content` names must be one the template declares
 * (ADR 0019 §6) — not merely one in the org's catalog. A KPI referencing a
 * catalogued point the template does not carry produces an asset with no such
 * point on it, which is broken on every instance rather than on one.
 *
 * Names every unresolved key, for the same reason `assertPointKeysActive`
 * does: bisecting a forty-point template by hand is not a debugging strategy.
 */
/**
 * ADR 0019 §3's binding of template `content.alarms[].category` to the live
 * rule vocabulary, **relocated rather than dropped** (ADR 0031 Amendment 1).
 *
 * It used to be free: `templateContentSchema` typed the field with the shared
 * `z.enum`, so an unknown category was a Zod issue naming the valid values.
 * With the vocabulary now in `bms.rule_categories`, a pure schema cannot know
 * the set — but the guarantee is worth keeping, so it moves to the one layer
 * that can ask.
 *
 * **Why keep it at all**, given nothing converts a template alarm into an
 * `automation_rules` row today: the point is that a template is an authoring
 * surface. A category that no longer exists is a defect authored *now* and
 * discovered whenever that conversion is built — which is exactly the shape
 * of the `electrical` bug this whole ADR is unwinding, where a value sat
 * unnoticed in the database for as long as it took someone to look.
 */
export async function assertTemplateAlarmVocabularies(
  vocabularies: VocabulariesService,
  content: TemplateContentParsed | undefined,
): Promise<void> {
  const alarms = content?.alarms ?? [];
  if (alarms.length === 0) {
    return;
  }

  // ADR 0032. `severity` was a `z.enum` until then, so `templateContentSchema`
  // rejected an unknown value by itself; with the vocabulary in the database
  // the schema checks shape only, and without a check here a template could
  // author an alarm at a severity the rule engine cannot run — the drift ADR
  // 0019 §3 exists to prevent. `category` moved the same way under ADR 0031
  // Amendment 1, and `philosophy.skill` under ADR 0034 (`E2.1`).
  //
  // **No branch calls `assertRuleCategory` / `assertAlarmSeverity` /
  // `assertAlarmSkill`, and that is the point of writing them out.** Those
  // methods echo the rejected code back, which is right for a value the
  // caller just typed into a request body and wrong here: this runs over
  // *stored* content, and pre-ADR rows hold arbitrary JSON written by
  // whoever. Echoing would turn a publish rejection into a disclosure
  // channel for whatever the row happens to hold.
  //
  // The severity half was written this way first and the category half was
  // not, which the security review caught: `publish` began calling this method
  // in the same commit, so the echoing category branch was newly reachable
  // over stored content. All three are non-echoing now — they name the path
  // and list the expected codes, and nothing else.
  //
  // **`E2.4`: the comparison itself moved to `template-alarm-vocabularies.ts`
  // and this method keeps only the 400.** Instantiation now writes these two
  // codes into `bms.automation_rules`, so the same question is asked a second
  // time at instantiate — where a value can have been retired since publish —
  // and two spellings of "is this code live" is how the two gates drift into
  // disagreeing. The messages, the check order and the non-echoing property
  // are unchanged; they are pinned by the shared module and by the probes in
  // `asset-templates.lifecycle.integration.spec.ts`.
  const { ruleCategories, alarmSeverities, alarmSkills } = await vocabularies.list();
  const problem = findAlarmVocabularyProblem(alarms, {
    ruleCategories,
    alarmSeverities,
    alarmSkills,
  });
  if (problem) {
    throw new BadRequestException(alarmVocabularyMessage(problem));
  }
}

export function assertContentRefsResolve(
  content: TemplateContentParsed,
  points: { pointKey: string }[],
): void {
  const missing = findUnresolvedContentRefs(
    content,
    points.map((point) => point.pointKey),
  );
  if (missing.length > 0) {
    throw new BadRequestException(
      "Template content references point keys this template does not declare: " +
        `${missing.join(", ")}. Add them to \`points\`, or remove the references.`,
    );
  }
}

/**
 * Replaces a draft's point set wholesale.
 *
 * Delete-then-insert rather than a diff: `template_points` rows have no
 * dependents (nothing references them — instantiation *copies* them into
 * `asset_points`), so preserving their ids buys nothing, and a diff would
 * need to decide what a changed `pointKey` means. Only ever runs against a
 * draft, enforced by the callers.
 */
export async function replacePoints(
  tx: BmsTx,
  templateId: string,
  // E7.1b: the parent template's org, stamped onto every point row. Always the
  // org this call's `withTenant` block set as the GUC, so `0047`'s WITH CHECK
  // accepts the insert; without it the insert fails once `template_points` is
  // policied. The delete needs no org — it is keyed by `template_id`, and post
  // -0047 the policy's USING clause scopes it to this org anyway.
  organizationId: string,
  points: (TemplatePointBody | PointRow)[],
): Promise<void> {
  await tx.delete(templatePoints).where(eq(templatePoints.templateId, templateId));
  if (points.length === 0) {
    return;
  }
  // Every field re-stamped with `??` onto its column default — the version
  // bump is why (`createDraftFrom` copies the parent's `PointRow`s through
  // here); see `toTemplatePointInsert`. Held by the lifecycle integration suite.
  await tx.insert(templatePoints).values(
    points.map((point, index) => toTemplatePointInsert(point, templateId, organizationId, index)),
  );
}

/**
 * Turns the partial unique index violation into an answer.
 *
 * `asset_templates_org_code_draft_unique` is what stops two rival drafts, and
 * it fires on a perfectly ordinary user action — clicking "edit" twice, or
 * two admins editing the same template. Surfacing the raw constraint name
 * would read as a bug rather than as "someone already has a draft open".
 */
export function translateDraftConflict(err: unknown, code: string): unknown {
  const constraint = (err as { constraint?: string } | null)?.constraint;
  if (constraint === "asset_templates_org_code_draft_unique") {
    return new ConflictException(
      `Template "${code}" already has an open draft. Publish or delete it before creating another.`,
    );
  }
  return err;
}

/**
 * Author permission: org-scoped, `location_admin` excluded (ADR 0015 §7).
 * Public since `F2.13` so `AssetTemplatesStockService.import` can refuse an
 * actor BEFORE naming the available codes; `create` checks it again.
 */
export async function assertCanAuthor(
  accessControl: AccessControlService,
  jwt: JwtPayload,
  organizationId: string,
): Promise<void> {
  const user = await accessControl.requireMasterDataUser(jwt);
  if (user.role === "location_admin") {
    throw new ForbiddenException("Location admins cannot author asset templates");
  }
  if (!(await accessControl.canManageTemplate(jwt, organizationId))) {
    throw new ForbiddenException("Organization is outside your access scope");
  }
}

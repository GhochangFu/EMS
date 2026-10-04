import { BadRequestException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { assetTemplates } from "@bms/db";
import type {
  JwtPayload,
  OnboardingDraft,
  OnboardingDraftAuthoredTemplate,
} from "@bms/shared";

import type { BmsTx } from "../../database/tenant-context";
import { MAX_DASHBOARD_WIDGET_ROWS, dashboardWidgetRowsFor } from "../asset-templates/asset-dashboards-plan";
import {
  MAX_INSTANTIATE_ASSETS,
  createAssetTemplateBodySchema,
  instantiateAssetsBodySchema,
  type CreateAssetTemplateBody,
} from "../asset-templates/asset-templates.schema";
import type { AssetTemplatesAdminService } from "../asset-templates/asset-templates.service";
import {
  MAX_POINT_ROWS,
  parseTemplateContentForInstantiate,
} from "../asset-templates/asset-templates-instantiate-guards";
import type { AssetTemplateInstantiationService } from "../asset-templates/asset-templates-instantiate.service";
import type { AssetTemplatesStockService } from "../asset-templates/asset-templates-stock.service";
import { fetchTemplateRow, loadTemplatePoints, translateDraftConflict } from "../asset-templates/asset-templates-write-guards";
import { MAX_RULE_ROWS } from "../asset-templates/template-alarm-rules";
import {
  draftTemplateCode,
  isStockEntry,
  resolveTemplateForAsset,
  type ValidateTemplateContext,
} from "./onboarding-template-refs";

/**
 * `F3.22` (ADR 0091 decisions 4, 5 and 10) — the template part of the
 * onboarding commit, run inside `OnboardingCommitService.commitWith`'s one
 * `withTenant` transaction.
 *
 * **This module writes nothing itself.** Every row goes through the three
 * template cores PR 1 built — `createInTransaction`, `publishInTransaction` and
 * `instantiateInTransaction` — so a draft template is created and published by
 * the same guards as the editor's, and a templated asset gets the same pin,
 * telemetry-source meta, asset points, seeded rules and dashboards as the
 * Instantiate button's (decision 10). `tests/f3.22-template-cores.test.ts`
 * holds that by source scan.
 *
 * The functions run in this order, at the positions decision 4 fixes:
 * `assertDraftTemplateAccess` before the transaction; `commitDraftTemplates`
 * after the RTUs; `templateGroups` and `commitTemplatedAssets` after the plain
 * assets' points, with the RTU ids the same transaction wrote.
 */

/** The three template services the commit hands its transaction to. */
export interface CommitTemplateDeps {
  readonly templates: Pick<AssetTemplatesAdminService, "assertCanAuthor" | "createInTransaction" | "publishInTransaction">;
  readonly instantiation: Pick<AssetTemplateInstantiationService, "instantiateInTransaction">;
  readonly stock: Pick<AssetTemplatesStockService, "bodyFor">;
}

/** A draft template after its publish, keyed by its code in `commitDraftTemplates`' map. */
export type PublishedDraftTemplate = { readonly id: string; readonly version: number };

/** One `instantiateInTransaction` call: one template version, one RTU, its assets in draft order. */
export type TemplateGroup = {
  readonly templateId: string;
  readonly code: string;
  readonly version: number;
  readonly rtuIndex: number;
  /** Indexes into `draft.assets`, parallel to `assets`. */
  readonly assetIndexes: number[];
  readonly assets: { code: string; name: string; siteName: string; sourceDataKeyVars?: Record<string, string> }[];
};

/** What one group asks of the summed bound. */
export type TemplateBatchShape = {
  readonly assetCount: number;
  readonly measuredCount: number;
  readonly alarmCount: number;
  readonly dashboardWidgetCount: number;
};

/** The template part of the commit result (decision 4). */
export type TemplatedAssetTotals = {
  templatedAssetCount: number;
  templatedAssetPointCount: number;
  seededRuleCount: number;
  dashboardCount: number;
};

/**
 * Decision 5 — a draft that holds a template entry also needs the author
 * check for the session's organization; a draft without one asks nothing
 * more. `location_admin` is refused here, as on the editor. `?.` because a
 * stored draft can be the JSON scalar `null` (see the caps comment in
 * `OnboardingCommitService.commitWith`).
 */
export async function assertDraftTemplateAccess(
  deps: CommitTemplateDeps,
  jwt: JwtPayload,
  organizationId: string,
  draft: OnboardingDraft | null,
): Promise<void> {
  if ((draft?.templates?.length ?? 0) > 0) {
    await deps.templates.assertCanAuthor(jwt, organizationId);
  }
}

/**
 * Q2 (owner ruling, ADR 0091 decision 2 dated note) — an authored entry as the
 * create route's body. Its points are measured only; `required` and `sortOrder`
 * take the route's default and the entry's order; `assetType` defaults to the
 * code because `asset_templates.asset_type` is `NOT NULL`. Parsed by the route's
 * own schema, so a chat template meets every rule a form template meets.
 */
export function authoredBody(entry: OnboardingDraftAuthoredTemplate, organizationId: string): CreateAssetTemplateBody {
  const parsed = createAssetTemplateBodySchema.safeParse({
    organizationId,
    code: entry.code,
    name: entry.name,
    assetType: entry.assetType ?? entry.code,
    domain: entry.domain,
    description: entry.description,
    points: entry.points.map((point, index) => ({
      pointKey: point.pointKey,
      label: point.label,
      unit: point.unit,
      kind: "measured",
      sourceDataKeyPattern: point.sourceDataKeyPattern,
      required: point.required ?? true,
      sortOrder: point.sortOrder ?? index,
    })),
  });
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return parsed.data;
}

/**
 * Creates and publishes every draft template, in draft order, on `tx`. A stock
 * entry's body comes from the catalog with its `patterns` laid over
 * (`AssetTemplatesStockService.bodyFor`), and its create is audited as an import.
 * The open-draft race is translated at the create call, where the code is known.
 */
export async function commitDraftTemplates(
  deps: CommitTemplateDeps,
  tx: BmsTx,
  jwt: JwtPayload,
  organizationId: string,
  draft: OnboardingDraft,
): Promise<Map<string, PublishedDraftTemplate>> {
  const published = new Map<string, PublishedDraftTemplate>();
  for (const entry of draft.templates ?? []) {
    const code = draftTemplateCode(entry);
    const { body, stamp } = isStockEntry(entry)
      ? deps.stock.bodyFor(entry.stockCode, organizationId, entry.patterns)
      : { body: authoredBody(entry, organizationId), stamp: undefined };
    let created: { id: string };
    try {
      created = await deps.templates.createInTransaction(tx, jwt, body, stamp);
    } catch (err) {
      throw translateDraftConflict(err, code);
    }
    const row = await deps.templates.publishInTransaction(tx, jwt, created.id);
    published.set(code, { id: row.id, version: row.version });
  }
  return published;
}

/**
 * The templated assets, grouped by `(code, version, rtuIndex)` in draft order.
 * A ref resolves as validation resolved it (decision 6): this draft's entry
 * first, then the organization's published version — read here on `tx` for its
 * id. A draft-sourced ref carries no version, so the group key uses the version
 * the publish returned, and one template's assets on one RTU stay one group.
 */
export async function templateGroups(
  tx: BmsTx,
  organizationId: string,
  draft: OnboardingDraft,
  published: ReadonlyMap<string, PublishedDraftTemplate>,
  ctx: ValidateTemplateContext,
): Promise<TemplateGroup[]> {
  const groups = new Map<string, TemplateGroup>();
  const assetsInDraft = draft.assets ?? [];
  for (let index = 0; index < assetsInDraft.length; index++) {
    const asset = assetsInDraft[index];
    if (!asset.template) {
      continue;
    }
    const target = await resolveGroupTemplate(tx, organizationId, draft, asset.template, published, ctx);
    const key = JSON.stringify([target.code, target.version, asset.rtuIndex]);
    let group = groups.get(key);
    if (group === undefined) {
      group = { ...target, rtuIndex: asset.rtuIndex, assetIndexes: [], assets: [] };
      groups.set(key, group);
    }
    group.assetIndexes.push(index);
    group.assets.push({
      code: asset.code,
      name: asset.name,
      siteName: asset.siteName,
      ...(asset.template.sourceDataKeyVars ? { sourceDataKeyVars: { ...asset.template.sourceDataKeyVars } } : {}),
    });
  }
  return [...groups.values()];
}

async function resolveGroupTemplate(
  tx: BmsTx,
  organizationId: string,
  draft: OnboardingDraft,
  ref: NonNullable<NonNullable<OnboardingDraft["assets"]>[number]["template"]>,
  published: ReadonlyMap<string, PublishedDraftTemplate>,
  ctx: ValidateTemplateContext,
): Promise<{ templateId: string; code: string; version: number }> {
  const fromDraft = published.get(ref.code);
  if (fromDraft !== undefined) {
    return { templateId: fromDraft.id, code: ref.code, version: fromDraft.version };
  }
  const resolved = resolveTemplateForAsset(draft, ref, ctx);
  const version = "problem" in resolved ? null : resolved.ref.version;
  if (version === null) {
    throw new BadRequestException(
      "problem" in resolved ? resolved.problem : `Template ${ref.code} has no published version to instantiate`,
    );
  }
  const [row] = await tx
    .select({ id: assetTemplates.id })
    .from(assetTemplates)
    .where(
      and(
        eq(assetTemplates.organizationId, organizationId),
        eq(assetTemplates.code, ref.code),
        eq(assetTemplates.version, version),
        eq(assetTemplates.status, "published"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new BadRequestException(
      `Template ${ref.code} v${version} is no longer published in this organization, so nothing was committed.`,
    );
  }
  return { templateId: row.id, code: ref.code, version };
}

function overTheCommitLimit(what: string, total: number, limit: number): BadRequestException {
  return new BadRequestException(
    `This commit would create ${total} ${what}, over the ${limit} limit for one commit. ` +
      "Remove some templated assets and commit them in a second session.",
  );
}

/**
 * ADR 0091 decision 4 — the instantiate batch bounds apply to the sum over the
 * commit, checked in the order the core checks one batch, before the first
 * group is instantiated. Each group is still held by the core's own
 * `assertBatchFits` afterwards.
 */
export function assertTemplateBatchesFit(groups: readonly TemplateBatchShape[]): void {
  const sum = (term: (group: TemplateBatchShape) => number): number =>
    groups.reduce((total, group) => total + term(group), 0);
  const assets = sum((group) => group.assetCount);
  if (assets > MAX_INSTANTIATE_ASSETS) {
    throw overTheCommitLimit("templated assets", assets, MAX_INSTANTIATE_ASSETS);
  }
  const points = sum((group) => group.assetCount * group.measuredCount);
  if (points > MAX_POINT_ROWS) {
    throw overTheCommitLimit("asset points", points, MAX_POINT_ROWS);
  }
  const rules = sum((group) => group.assetCount * group.alarmCount);
  if (rules > MAX_RULE_ROWS) {
    throw overTheCommitLimit("seeded rules", rules, MAX_RULE_ROWS);
  }
  const widgets = sum((group) => group.assetCount * group.dashboardWidgetCount);
  if (widgets > MAX_DASHBOARD_WIDGET_ROWS) {
    throw overTheCommitLimit("dashboard widgets", widgets, MAX_DASHBOARD_WIDGET_ROWS);
  }
}

/** Each group's shape, read on `tx` — once per template, however many groups share it. */
async function batchShapes(tx: BmsTx, groups: readonly TemplateGroup[]): Promise<TemplateBatchShape[]> {
  const perTemplate = new Map<string, Omit<TemplateBatchShape, "assetCount">>();
  for (const group of groups) {
    if (perTemplate.has(group.templateId)) {
      continue;
    }
    const template = await fetchTemplateRow(tx, group.templateId);
    const points = await loadTemplatePoints(tx, group.templateId);
    const content = parseTemplateContentForInstantiate(template);
    perTemplate.set(group.templateId, {
      measuredCount: points.filter((point) => point.kind === "measured").length,
      alarmCount: (content.alarms ?? []).length,
      dashboardWidgetCount: dashboardWidgetRowsFor(content.dashboards ?? {}),
    });
  }
  return groups.map((group) => ({
    assetCount: group.assets.length,
    ...(perTemplate.get(group.templateId) as Omit<TemplateBatchShape, "assetCount">),
  }));
}

/**
 * Instantiates every group through the core, onto the RTU this commit wrote,
 * with decision 5's option — the organization check, because the auth pool
 * cannot see a location written in this transaction. Writes each created id
 * into `assetIdByIndex` at its draft position, and sums the totals.
 */
export async function commitTemplatedAssets(
  deps: CommitTemplateDeps,
  tx: BmsTx,
  jwt: JwtPayload,
  groups: readonly TemplateGroup[],
  rtuIds: readonly string[],
  assetIdByIndex: (string | undefined)[],
): Promise<TemplatedAssetTotals> {
  const totals: TemplatedAssetTotals = {
    templatedAssetCount: 0,
    templatedAssetPointCount: 0,
    seededRuleCount: 0,
    dashboardCount: 0,
  };
  if (groups.length === 0) {
    return totals;
  }
  assertTemplateBatchesFit(await batchShapes(tx, groups));
  for (const group of groups) {
    const rtuId = rtuIds[group.rtuIndex];
    if (!rtuId) {
      throw new BadRequestException("Invalid asset rtuIndex");
    }
    // The route's own body schema, so a templated asset meets every rule the
    // Instantiate dialog's assets meet (decision 10).
    const body = instantiateAssetsBodySchema.safeParse({ rtuId, assets: group.assets });
    if (!body.success) {
      throw new BadRequestException(body.error.flatten());
    }
    const result = await deps.instantiation.instantiateInTransaction(tx, jwt, group.templateId, body.data, {
      locationAccess: "organization",
    });
    const idByCode = new Map(result.assets.map((asset) => [asset.code, asset.id]));
    group.assetIndexes.forEach((assetIndex, position) => {
      const id = idByCode.get(group.assets[position].code);
      if (id === undefined) {
        throw new Error(`onboarding commit: the instantiate core returned no id for ${group.assets[position].code}`);
      }
      assetIdByIndex[assetIndex] = id;
    });
    totals.templatedAssetCount += result.assets.length;
    totals.templatedAssetPointCount += result.pointCount;
    totals.seededRuleCount += result.ruleCount;
    totals.dashboardCount += result.dashboardCount;
  }
  return totals;
}

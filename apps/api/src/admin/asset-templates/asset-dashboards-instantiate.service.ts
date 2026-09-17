import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  assetPoints,
  assetTemplates,
  assets,
  dashboardWidgetPoints,
  dashboardWidgets,
  dashboards,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  DefaultDashboardsBackfillResultDto,
  InstantiatedDashboardDto,
  JwtPayload,
  TemplateDashboardView,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import type { BmsTx } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  dashboardName,
  dashboardSlug,
  dashboardWidgetRowsFor,
  MAX_DASHBOARD_WIDGET_ROWS,
  planView,
  sortedViewNames,
} from "./asset-dashboards-plan";
import type { ViewPlan } from "./asset-dashboards-plan";
import { parseStoredTemplateContent } from "./asset-templates-content.schema";
import { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F3.2` / [ADR 0067](../../../../../docs/adr/0067-per-asset-default-dashboards.md)
 * decisions 3 and 4 — the **impure** half of "an asset template's dashboard
 * views become one dashboard per view, per asset".
 *
 * Every derivation this service needs — the slug, the name, the tile lattice,
 * the per-widget report and the batch bound — lives in `asset-dashboards-plan.ts`
 * and is proved there without a database. What lives here is the two triggers
 * ADR 0067 decision 4 names, and nothing else:
 *
 * - {@link instantiateForAssets}, called by `AssetTemplateInstantiationService`
 *   **inside its own `withTenant` transaction, after the rule seed**. It takes a
 *   transaction rather than opening one, for ADR 0058 decision 9's reason: a
 *   dashboard written outside that transaction could survive a rolled-back batch
 *   as a dashboard of an asset that does not exist.
 * - {@link backfill}, the `POST :id/default-dashboards` path, which opens the
 *   transactions itself — **one per chunk** of assets, sized to fit
 *   `MAX_DASHBOARD_WIDGET_ROWS` (ADR 0067 Q7, 2026-09-17), and **one savepoint
 *   per asset inside each** (Q8, 2026-09-17). It is resumable rather than
 *   atomic: a taken slug rolls back that asset alone and is reported
 *   `skipped_slug_conflict`, every other error stops the call with the chunks
 *   before it committed, and a re-run skips whatever is now stamped. The bound
 *   refuses nothing here; it sizes the chunk.
 *
 * **Resumability comes from the skip set, not from a message.** An earlier
 * version appended "N of M assets already have their default dashboards" to the
 * failing chunk's error. It could not work: Nest snapshots a response at
 * construction, so mutating `err.message` afterwards never reached the wire —
 * and with Q8 the collision that sentence was written for no longer stops
 * anything. Whatever stops the call now propagates **untouched**.
 *
 * **The report is counted from the rows the database returned, never from the
 * plan.** `widgetCount` and `boundPoints` are the lengths of `.returning()`
 * results. `F3.36`'s closure names the alternative — a report that grades its own
 * work — and this is the same table one door over.
 */

/** The template version row a batch is stamped with. */
type TemplateRow = typeof assetTemplates.$inferSelect;

/** One asset a batch writes dashboards for. */
export interface DashboardTargetAsset {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * The unique index a repeated dashboard slug violates, and the one error the
 * backfill's savepoint arm handles (Q8, ruled 2026-09-17).
 *
 * Named once and read by both {@link slugConflict} and {@link isSlugConflict},
 * so the string the translation is keyed on and the string the recogniser looks
 * for cannot drift apart.
 */
const SLUG_CONSTRAINT = "dashboards_organization_slug_key";

/**
 * The 409 a taken slug raises, **carrying the constraint that caused it**.
 *
 * The property is what lets {@link isSlugConflict} be ONE predicate over two
 * shapes: the driver's raw `23505`, and this translated exception. Without it
 * the backfill would have to recognise a conflict by matching the sentence it
 * wrote, which is the weakest possible test of "is this the error I handle".
 *
 * `Object.assign` on a `ConflictException` rather than a subclass, deliberately:
 * `expectRejectionNamed` in the integration specs grades `err.constructor.name`,
 * and a subclass would rename the class those cases already assert without
 * changing the status code the client sees.
 */
function slugConflict(message: string): ConflictException {
  return Object.assign(new ConflictException(message), { constraint: SLUG_CONSTRAINT });
}

/** True for a duplicate dashboard slug, raw from the driver or translated. */
function isSlugConflict(err: unknown): boolean {
  return (err as { constraint?: string } | null)?.constraint === SLUG_CONSTRAINT;
}

/**
 * The 409 a draft `:id` gets from `POST :id/default-dashboards`.
 *
 * **Not `draftRequiredMessage`.** That helper's verb union
 * (`TemplateDraftRequiredVerb` in `packages/shared/src/contracts/template-lifecycle.ts`)
 * is `"edited" | "published" | "deleted"` and carries no verb for this refusal;
 * inventing one would widen a shared contract from a route that only needed a
 * sentence. The sentence reused instead is `AssetTemplateInstantiationService`'s
 * own, byte for byte, which is the honest reading anyway — backfilling defaults
 * *is* instantiating from the version, and a caller who met the refusal on
 * `:id/instantiate` should not meet a second wording for the same rule here.
 */
function draftRefusedMessage(status: string): string {
  return (
    `Only a published template can be instantiated; this one is ${status}. ` +
    "Publishing is what freezes the shape assets are built from."
  );
}

@Injectable()
export class AssetDashboardsInstantiateService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    // `assertCanAuthor` is this service's permission gate for the backfill, and
    // it is taken from the service that owns it rather than restated: ADR 0015
    // §7 excludes `location_admin` from authoring, and a second copy of that
    // rule is how the two doors drift apart.
    private readonly templates: AssetTemplatesAdminService,
    private readonly audit: MasterDataAuditService,
    // ADR 0017's operations-write matrix, for the backfill's §4.7 gate. Injected
    // by type, as `AssetTemplatesAdminService` takes it — `AdminModule` needs no
    // edit, Nest already provides this class to that provider.
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * Writes every view of `views` for every asset in `targets`, on the caller's
   * transaction — ADR 0067 decision 3.
   *
   * Returns the per-asset report keyed by **asset code**, because that is the
   * key `AssetTemplateInstantiationService` builds its per-asset DTOs from and a
   * second keying would be a second derivation of one fact.
   *
   * **No savepoint here, and that is Q8's ruling rather than an omission.** A
   * caller that needs one asset's collision not to take the others opens it
   * around the call ({@link backfill} does, one per asset); the asset-creation
   * trigger must NOT, because its contract is all-or-nothing — a batch that
   * half-built its assets is the state ADR 0067 decision 3 refuses.
   */
  async instantiateForAssets(
    tx: BmsTx,
    template: Pick<TemplateRow, "id" | "organizationId">,
    views: Readonly<Record<string, TemplateDashboardView>>,
    targets: readonly DashboardTargetAsset[],
  ): Promise<Map<string, InstantiatedDashboardDto[]>> {
    const byCode = new Map<string, InstantiatedDashboardDto[]>(
      targets.map((target) => [target.code, [] as InstantiatedDashboardDto[]]),
    );
    // **Sorted, and not `Object.keys(views)` as it comes** — the derivation and
    // its whole argument live in `sortedViewNames`, which is where a test can
    // reach them. The comparison this replaced was written inline here and
    // compared UTF-16 code units while its own comment claimed code points
    // (sweep item 5).
    const viewNames = sortedViewNames(views);
    if (viewNames.length === 0 || targets.length === 0) {
      return byCode;
    }

    const pointIdByCompositeKey = await this.loadPointIds(tx, template.organizationId, targets);

    for (const target of targets) {
      // D5's map is keyed `${assetId}::${pointKey}` across the whole batch;
      // `planView` takes a map keyed by the BARE key of ONE asset. Narrowing here
      // is not an optimisation — handing `planView` the composite map resolves
      // nothing, every widget reports `unresolved`, and no surface raises.
      const pointIdByPointKey = new Map<string, string>();
      for (const [composite, pointId] of pointIdByCompositeKey) {
        const prefix = `${target.id}::`;
        if (composite.startsWith(prefix)) {
          pointIdByPointKey.set(composite.slice(prefix.length), pointId);
        }
      }

      const reports: InstantiatedDashboardDto[] = [];
      for (const viewName of viewNames) {
        const view = views[viewName];
        if (view === undefined) {
          continue;
        }
        reports.push(
          await this.writeView(tx, template, target, planView(viewName, view, pointIdByPointKey)),
        );
      }
      byCode.set(target.code, reports);
    }
    return byCode;
  }

  /**
   * Every **active** asset of the organization pinned to any version of this
   * template's code gets this version's dashboards — ADR 0067 decision 4.
   *
   * A published version whose content declares **no** dashboard views is
   * refused with a 409 naming the code and version, before the estate is
   * selected and before any transaction or audit row: there is nothing to
   * build, and a call that reports assets it wrote nothing for is a report that
   * lies (code review of 2026-09-17).
   *
   * **Chunked and resumable** (ADR 0067 Q7): the assets to create are processed
   * in code order, `MAX_DASHBOARD_WIDGET_ROWS / widgets per asset` at a time,
   * one `withTenant` transaction and one audit row per chunk.
   *
   * **A slug collision is per asset** (Q8): each asset's writes run in their own
   * savepoint, so a `23505` on `dashboards_organization_slug_key` rolls that
   * asset back, reports it `skipped_slug_conflict`, and the chunk — and every
   * later chunk — carries on. Any other error still stops the call, unchanged,
   * with the chunks before it committed.
   *
   * The order of the first three steps is the security property, not house
   * style: `assertCanAuthor` runs **before any read of `status`**, so a caller
   * outside the organization learns nothing about the version's lifecycle state.
   * A draft id with a `location_admin` JWT is a 403, never a 409.
   */
  async backfill(
    jwt: JwtPayload,
    templateId: string,
    // The cap is a parameter with the constant as its default so a case can
    // drive the chunk loop: reaching the real ceiling needs 8,000 widget rows,
    // and an arithmetic that is only ever exercised with one chunk is an
    // arithmetic no test has run. No caller passes it — the route does not
    // take a batch size (ADR 0067 Q7).
    maxWidgetRows: number = MAX_DASHBOARD_WIDGET_ROWS,
  ): Promise<DefaultDashboardsBackfillResultDto> {
    const template = await this.fetchTemplate(templateId);
    await this.templates.assertCanAuthor(jwt, template.organizationId);
    // AGENTS.md §4.7 / ADR 0017 — additive, and it runs on the role in
    // `bms.users` rather than on the JWT claim. Every role that clears
    // `assertCanAuthor` for a template (admin, organization_admin; ADR 0015 §7
    // excludes location_admin) also clears `configuration` today, so this gate
    // refuses nothing the line above accepts. It is written for the same reason
    // §4.7 asks for it everywhere: the matrix is the one place a role's writes
    // are decided, and a mutating route that never consults it is the route
    // that keeps its access when the matrix changes.
    await this.accessControl.assertOperationsWriteRole(jwt, "configuration");
    if (template.status !== "published") {
      throw new ConflictException(draftRefusedMessage(template.status));
    }

    // `F4.108` / ADR 0060 ruling 2 — the content is STORED data, so a parse
    // failure is never the caller's 400. The 409 is `instantiate`'s refusal for
    // the same input: a published version is immutable, so the only way forward
    // is a new version.
    const parsed = parseStoredTemplateContent(template.content);
    if (!parsed.ok) {
      throw new ConflictException(
        `Cannot create default dashboards for ${template.code} v${template.version}: its ` +
          "stored content no longer matches the current content contract, so the dashboard " +
          `views it carries cannot be read. ${parsed.detail}`,
      );
    }
    const views = parsed.content.dashboards ?? {};
    // A version with no views has nothing to build, and saying so is the honest
    // answer to `POST :id/default-dashboards`. Before this refusal the call
    // walked the whole estate, opened a transaction per chunk and left an audit
    // row per chunk, all to write nothing — and the report graded every asset
    // against an empty plan. Raised **here**: before the estate is selected,
    // before any transaction, before any audit row. A 409 rather than a 400
    // because the caller's request is well formed and the stored version is
    // what cannot satisfy it — the same reading as the draft refusal above, and
    // a published version is immutable, so the way forward is a new version.
    if (Object.keys(views).length === 0) {
      throw new ConflictException(
        `${template.code} v${template.version} declares no dashboard views, so there are no ` +
          "default dashboards to create. Publish a version whose content carries a " +
          "dashboards key, then run this again.",
      );
    }

    const versionIds = await this.versionIds(template);
    const targets = await this.pinnedAssets(template.organizationId, versionIds);
    const stamped = await this.assetsAlreadyStamped(versionIds, targets);
    const toCreate = targets.filter((target) => !stamped.has(target.id));

    // ADR 0067 Q7 — **chunked, and one transaction per chunk.** The single
    // transaction this replaced was refused by `assertDashboardBatchFits` as
    // soon as the estate outgrew the bound (889 assets on the stock `overview`
    // view), and the route takes no batch size, so the refusal was a dead end
    // rather than an instruction. The bound still governs: it now sizes the
    // chunk instead of refusing the call. `assertDashboardBatchFits` stays on
    // the asset-CREATION path, where one transaction is the requirement (ADR
    // 0067 decision 3 — no partial batch of assets).
    const widgetsPerAsset = dashboardWidgetRowsFor(views);
    const chunkSize = Math.max(1, Math.floor(maxWidgetRows / Math.max(1, widgetsPerAsset)));
    const chunks: DashboardTargetAsset[][] = [];
    for (let start = 0; start < toCreate.length; start += chunkSize) {
      chunks.push(toCreate.slice(start, start + chunkSize));
    }

    const created = new Map<string, InstantiatedDashboardDto[]>();
    const conflicted = new Set<string>();
    let createdCount = 0;
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const byCode = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
        const chunkResult = new Map<string, InstantiatedDashboardDto[]>();
        let chunkConflicts = 0;
        for (const target of chunk) {
          // Q8 (ruled 2026-09-17) — **one savepoint per asset**. `tx.transaction`
          // nests on pg as `SAVEPOINT spN` … `ROLLBACK TO SAVEPOINT spN`
          // (drizzle `pg-core/session.js`), so a taken slug undoes THAT asset's
          // dashboard, widget and binding rows and nothing else: the assets
          // written before it in this same transaction keep their rows, and the
          // transaction stays usable for the ones after it. Without the
          // savepoint the whole chunk transaction is aborted by the `23505` and
          // every later statement on it fails with `25P02`.
          //
          // **One asset per call**, which is what makes the savepoint per asset
          // rather than per chunk. The cost is that `loadPointIds` now runs once
          // per asset instead of once per chunk — one indexed read of one
          // asset's points against a per-asset rollback that keeps the rest of
          // the estate moving.
          try {
            await tx.transaction(async (savepoint) => {
              const one = await this.instantiateForAssets(savepoint, template, views, [target]);
              for (const [code, list] of one) {
                chunkResult.set(code, list);
              }
            });
          } catch (err) {
            // Only the handled conflict is absorbed. Anything else — a dropped
            // connection, a CHECK the planner should have satisfied — still
            // stops the call, and reaches the caller exactly as it was raised.
            if (!isSlugConflict(err)) {
              throw err;
            }
            chunkResult.delete(target.code);
            conflicted.add(target.code);
            chunkConflicts += 1;
          }
        }
        await this.audit.write(
          {
            actor: jwt,
            action: "master.dashboard.backfill",
            entityType: "asset_template",
            entityId: template.id,
            organizationId: template.organizationId,
            payload: {
              templateCode: template.code,
              templateVersion: template.version,
              // The rows this chunk actually wrote for, not the assets it was
              // handed: a template with no views writes nothing, and an audit
              // row claiming otherwise is the durable copy of the defect.
              createdCount: [...chunkResult.values()].filter((list) => list.length > 0).length,
              // **This chunk's** collisions. Per chunk, unlike `skippedCount`
              // below, because a collision happens inside a chunk and a reader
              // of one row is entitled to know what that transaction met.
              conflictCount: chunkConflicts,
              // The call-wide skip set, stamped on the FIRST chunk only (sweep
              // item 2). It does not change between chunks, and repeating it
              // made three rows each claiming the same two skipped assets read
              // as six. Absent rather than zero on the later rows: a `0` would
              // be a second claim about the same call, and a false one.
              ...(chunkIndex === 0 ? { skippedCount: stamped.size } : {}),
              chunkIndex,
              chunkCount: chunks.length,
              assetIds: chunk.map((target) => target.id),
            },
          },
          tx,
        );
        return chunkResult;
      });
      // Merged, never reassigned: an earlier chunk is committed and its
      // dashboards belong in the report as much as the last chunk's.
      for (const [code, list] of byCode) {
        created.set(code, list);
        if (list.length > 0) {
          createdCount += 1;
        }
      }
    }

    return {
      templateId: template.id,
      templateCode: template.code,
      templateVersion: template.version,
      assets: targets.map((target) => ({
        assetId: target.id,
        code: target.code,
        // Read off what was written, not off the skip set. An asset handed to a
        // chunk that wrote no view for it (a template that declares no
        // `dashboards`) was not created, and calling it `created` is the code
        // review's finding of 2026-09-17. It falls to the other member of the
        // enum, which widening would be a contract change this row does not
        // own; `createdCount` and `skippedCount` both exclude it, so the counts
        // stay true to the rows.
        // Q8 first: an asset whose slug was taken wrote nothing, and reading
        // that off the empty dashboard list alone would call it
        // `skipped_existing` — the one outcome it is not.
        outcome: conflicted.has(target.code)
          ? ("skipped_slug_conflict" as const)
          : (created.get(target.code) ?? []).length > 0
            ? ("created" as const)
            : ("skipped_existing" as const),
        dashboards: created.get(target.code) ?? [],
      })),
      createdCount,
      skippedCount: stamped.size,
      conflictCount: conflicted.size,
    };
  }

  /**
   * One `dashboards` row, its widgets and their bindings — D6.
   *
   * The `23505` translation is `DashboardTemplatesInstantiateService`'s, copied
   * with its reason: drizzle THROWS on a duplicate key, so an `if (!row)` guard
   * after `.returning()` is unreachable and a repeated slug would reach the
   * client as a 500 carrying a constraint name.
   *
   * **What rolls back is the caller's business, not this method's.** On the
   * asset-CREATION path the whole transaction goes — no asset, no point, no
   * rule and no other view's dashboard, which is the `F2.2` all-or-nothing rule
   * ADR 0067 decision 3 keeps. On the backfill path the caller has wrapped this
   * asset in a savepoint (Q8), so the same throw undoes this asset alone. The
   * exception carries its `constraint` either way, which is how the backfill
   * recognises it without matching on the sentence.
   */
  private async writeView(
    tx: BmsTx,
    template: Pick<TemplateRow, "id" | "organizationId">,
    target: DashboardTargetAsset,
    plan: ViewPlan,
  ): Promise<InstantiatedDashboardDto> {
    const slug = dashboardSlug(target.code, plan.view);
    const [dashboardRow] = await tx
      .insert(dashboards)
      .values({
        organizationId: template.organizationId,
        slug,
        name: dashboardName(target.name, plan.view),
        assetId: target.id,
        // ADR 0067 decision 1 — the version stamp, and the reason the three
        // other scope columns stay NULL: `dashboards_scope_check` permits at
        // most one of them, and `dashboards_template_stamp_check` refuses a
        // dashboard stamped from both template tables.
        assetTemplateId: template.id,
        locationId: null,
        assetGroupId: null,
        templateId: null,
      })
      .returning({ id: dashboards.id })
      .catch((err: unknown) => {
        if (isSlugConflict(err)) {
          throw slugConflict(
            `A dashboard with slug "${slug}" already exists in this organization, so the ` +
              `default dashboards for ${target.code} cannot be created. Nothing was written. ` +
              "Rename or delete that dashboard and retry.",
          );
        }
        throw err;
      });
    if (!dashboardRow) {
      throw new ConflictException(`Dashboard "${slug}" could not be created`);
    }

    let widgetCount = 0;
    let boundPoints = 0;
    for (const widget of plan.widgets) {
      const widgetRows = await tx
        .insert(dashboardWidgets)
        .values({
          organizationId: template.organizationId,
          dashboardId: dashboardRow.id,
          widgetType: widget.widgetType,
          title: widget.title,
          gridX: widget.gridX,
          gridY: widget.gridY,
          gridW: widget.gridW,
          gridH: widget.gridH,
          config: widget.config,
        })
        .returning({ id: dashboardWidgets.id });
      // Counted off the rows the database returned, not off `plan.widgets` —
      // the `F3.36` "report grades its own work" lesson.
      widgetCount += widgetRows.length;
      const widgetRow = widgetRows[0];
      if (!widgetRow) {
        throw new ConflictException(`A widget of dashboard "${slug}" could not be created`);
      }
      if (widget.points.length > 0) {
        const pointRows = await tx
          .insert(dashboardWidgetPoints)
          .values(
            widget.points.map((point, index) => ({
              organizationId: template.organizationId,
              widgetId: widgetRow.id,
              pointId: point.pointId,
              role: widget.pointRole,
              sortOrder: index,
            })),
          )
          .returning({ id: dashboardWidgetPoints.id });
        boundPoints += pointRows.length;
      }
    }

    return {
      slug,
      view: plan.view,
      widgetCount,
      boundPoints,
      omittedFeatured: plan.omittedFeatured,
      // Copied, not aliased: `ViewPlan.resolutions` is `readonly` and the DTO's
      // array is not, so the spread is the conversion rather than a defensive
      // clone. Nothing mutates either side.
      resolutions: [...plan.resolutions],
    };
  }

  /**
   * Every active point of every target asset, keyed `${assetId}::${pointKey}` — D5.
   *
   * On the **transaction**, and with an explicit `organization_id` predicate
   * even so. `dashboard-point-scope.ts` records why the predicate is not left to
   * row-level security: the GUC is set inside `withTenant`, but a read that
   * states its own scope keeps working if a future caller reaches this on a
   * handle that does not, and it documents the intent at the point of the read.
   */
  private async loadPointIds(
    tx: BmsTx,
    organizationId: string,
    targets: readonly DashboardTargetAsset[],
  ): Promise<Map<string, string>> {
    const rows = await tx
      .select({
        id: assetPoints.id,
        assetId: assetPoints.assetId,
        pointKey: assetPoints.pointKey,
      })
      .from(assetPoints)
      .where(
        and(
          eq(assetPoints.organizationId, organizationId),
          eq(assetPoints.active, true),
          inArray(
            assetPoints.assetId,
            targets.map((target) => target.id),
          ),
        ),
      );
    return new Map(rows.map((row) => [`${row.assetId}::${row.pointKey}`, row.id]));
  }

  private async fetchTemplate(id: string): Promise<TemplateRow> {
    const [row] = await this.fleetDb
      .select()
      .from(assetTemplates)
      .where(eq(assetTemplates.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset template not found");
    }
    return row;
  }

  /**
   * Every version id of this template's code, in its organization.
   *
   * Copied from `AssetTemplateSeededRulesService.versionIds` rather than reached
   * into: that method is private and belongs to the rules path, and ADR 0067
   * decision 4 asks the same question here — *"a plant pinned to v1 still
   * deserves v2's layout when the administrator asks for it"*.
   */
  private async versionIds(template: TemplateRow): Promise<string[]> {
    const rows = await this.fleetDb
      .select({ id: assetTemplates.id })
      .from(assetTemplates)
      .where(
        and(
          eq(assetTemplates.organizationId, template.organizationId),
          eq(assetTemplates.code, template.code),
        ),
      );
    return rows.map((row) => row.id);
  }

  /**
   * The backfill's population — **active assets only** (plan §12 Q4, ruled
   * 2026-09-16): the instantiate path refuses an inactive target under ADR 0009,
   * so building defaults for one here would write rows that path would not.
   *
   * `fleetDb`, like every pre-transaction read in this feature area: `assets` is
   * a `FORCE`d policied table since `0047`, and a tenant handle with no GUC set
   * reads zero rows and reports an empty estate.
   */
  private async pinnedAssets(
    organizationId: string,
    versionIds: readonly string[],
  ): Promise<DashboardTargetAsset[]> {
    if (versionIds.length === 0) {
      return [];
    }
    return this.fleetDb
      .select({ id: assets.id, code: assets.code, name: assets.name })
      .from(assets)
      .where(
        and(
          eq(assets.organizationId, organizationId),
          eq(assets.active, true),
          inArray(assets.templateId, [...versionIds]),
        ),
      )
      .orderBy(asc(assets.code));
  }

  /**
   * The skip set — an asset already carrying a dashboard stamped from **any**
   * version of this code, ADR 0067 decision 4's `skipped_existing`.
   *
   * Scoped to the assets in hand rather than to the whole estate, so the query
   * stays bounded by the batch and not by how many dashboards the organization
   * has accumulated.
   */
  private async assetsAlreadyStamped(
    versionIds: readonly string[],
    targets: readonly DashboardTargetAsset[],
  ): Promise<Set<string>> {
    if (versionIds.length === 0 || targets.length === 0) {
      return new Set();
    }
    const rows = await this.fleetDb
      .selectDistinct({ assetId: dashboards.assetId })
      .from(dashboards)
      .where(
        and(
          inArray(dashboards.assetTemplateId, [...versionIds]),
          inArray(
            dashboards.assetId,
            targets.map((target) => target.id),
          ),
        ),
      );
    return new Set(rows.flatMap((row) => (row.assetId === null ? [] : [row.assetId])));
  }
}

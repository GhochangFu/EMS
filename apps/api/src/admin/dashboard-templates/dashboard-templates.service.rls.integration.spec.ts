import { ConflictException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import type pg from "pg";


import type { JwtPayload } from "@bms/shared";

import type { DashboardTemplatesStockService } from "./dashboard-templates-stock.service";
import type { DashboardTemplatesService } from "./dashboard-templates.service";

/**
 * `F3.36` Part E1 — RLS-backed proof of what `DashboardTemplatesService` does
 * with a REAL connection. Assertions live here;
 * `dashboard-templates.service.rls.integration.test.ts` is the Vitest entry
 * point (ADR 0014) and owns the database lifecycle.
 *
 * **The service is constructed directly, never through a Nest module.** §4.6,
 * and `F4.20` records the reason: esbuild emits no `design:paramtypes`, so
 * constructor injection resolves to `undefined` in this test environment.
 */

/**
 * A template created under one organization is invisible to a session with
 * another organization's GUC set.
 *
 * Run on the **tenant** pool, because that is the pool the policy binds:
 * `bms_fleet` holds `BYPASSRLS`, so a fleet read proves nothing about
 * `tenant_isolation`.
 */
export async function assertForeignTemplateIsInvisibleToAnotherTenant(
  tenantPool: pg.Pool,
  templateId: string,
  ownerOrgId: string,
  foreignOrgId: string,
): Promise<void> {
  const own = await tenantPool.query(
    `SELECT set_config('app.current_organization', $1, false)`,
    [ownerOrgId],
  );
  expect(own.rowCount).toBe(1);
  const visible = await tenantPool.query(
    `SELECT id FROM bms.dashboard_templates WHERE id = $1`,
    [templateId],
  );
  expect(
    visible.rowCount,
    "the owning tenant must see its own template — otherwise the invisibility below proves nothing",
  ).toBe(1);

  await tenantPool.query(`SELECT set_config('app.current_organization', $1, false)`, [
    foreignOrgId,
  ]);
  const hidden = await tenantPool.query(
    `SELECT id FROM bms.dashboard_templates WHERE id = $1`,
    [templateId],
  );
  expect(
    hidden.rowCount,
    "a foreign organization's session must see zero rows of bms.dashboard_templates. " +
      "tenant_isolation + FORCE ROW LEVEL SECURITY, migration 0056.",
  ).toBe(0);
}

/**
 * **The `template_id` policy leg on `bms.dashboards`.**
 *
 * This is the assertion migration `0056` exists to make true, and the reason is
 * not reasoned about but recorded: `0050`'s own security review PROVED on the
 * running stack that Postgres runs a referential-integrity check with row
 * security OFF, so a foreign key never consults the parent's policy. An
 * ESKOM-stamped `dashboard_widget_points` row bound a PHEWB `asset_points` id
 * and the INSERT succeeded. A `template_id` with no policy leg re-opens that
 * one column over.
 *
 * **Probed WITHOUT `RETURNING`.** A `RETURNING` insert reads as an RLS refusal
 * in cases where the plain write actually succeeded, so a `RETURNING` probe can
 * report containment that is not there.
 */
export async function assertForeignTemplateIdOnDashboardIsRefused(
  tenantPool: pg.Pool,
  foreignTemplateId: string,
  actingOrgId: string,
  slug: string,
): Promise<void> {
  await tenantPool.query(`SELECT set_config('app.current_organization', $1, false)`, [
    actingOrgId,
  ]);

  let refused = false;
  try {
    await tenantPool.query(
      `INSERT INTO bms.dashboards (organization_id, slug, name, template_id)
       VALUES ($1, $2, $3, $4)`,
      [actingOrgId, slug, "F3.36 cross-org template stamp", foreignTemplateId],
    );
  } catch (error) {
    refused = /row-level security/i.test((error as Error).message);
    if (!refused) throw error;
  }

  expect(
    refused,
    "stamping a dashboard with ANOTHER organization's template_id must be refused by " +
      "row-level security. The foreign key alone does not do it — Postgres runs referential " +
      "integrity with row security off (migration 0050's header). If this passes, the " +
      "template_id leg is missing from bms.dashboards' tenant_isolation policy.",
  ).toBe(true);

  const landed = await tenantPool.query(`SELECT id FROM bms.dashboards WHERE slug = $1`, [slug]);
  expect(landed.rowCount, "the refused INSERT must have left no row behind").toBe(0);
}

/**
 * At most one editable draft per logical template.
 *
 * `dashboard_templates_org_code_draft_unique` is a PARTIAL unique index
 * (`WHERE status = 'draft'`), which is what makes two concurrent "edit
 * published" clicks fail at the database rather than produce two rival drafts
 * that the `(organization_id, code, version)` index would only reject by
 * accident of ordering.
 */
export async function assertSecondDraftIsRefusedByThePartialIndex(
  ownerPool: pg.Pool,
  organizationId: string,
  code: string,
): Promise<void> {
  let refused = false;
  try {
    await ownerPool.query(
      `INSERT INTO bms.dashboard_templates (organization_id, code, version, name, section, status)
       VALUES ($1, $2, 99, 'F3.36 rival draft', 'electrical', 'draft')`,
      [organizationId, code],
    );
  } catch (error) {
    refused = /dashboard_templates_org_code_draft_unique/i.test((error as Error).message);
    if (!refused) throw error;
  }

  expect(
    refused,
    "a second draft of the same (organization_id, code) must be refused by the partial unique " +
      "index. Without it, two concurrent edit-published clicks create two rival drafts.",
  ).toBe(true);
}

/** A scoped admin gets a 403 on another organization's template — the guard,
 * asserted rather than assumed. */
export async function assertScopedAdminIsForbiddenOnAnotherOrgTemplate(
  service: DashboardTemplatesService,
  scopedAdmin: JwtPayload,
  foreignTemplateId: string,
): Promise<void> {
  await expect(
    service.getById(scopedAdmin, foreignTemplateId),
    "a location-scoped admin must be refused another organization's template",
  ).rejects.toThrow(/outside your access scope/i);
}

/** The audit row committed, read back on a separate connection — proving the
 * write landed rather than merely being issued inside a transaction the test
 * also opened. */
export async function assertAuditRowCommitted(
  ownerPool: pg.Pool,
  templateId: string,
  organizationId: string,
  action: string,
): Promise<void> {
  const rows = await ownerPool.query<{ organization_id: string | null; action: string }>(
    `SELECT organization_id, action FROM bms.audit_log
      WHERE entity_type = 'dashboard_template' AND entity_id = $1 AND action = $2`,
    [templateId, action],
  );
  expect(rows.rowCount, `no audit row for ${action} on ${templateId}`).toBeGreaterThan(0);
  expect(
    rows.rows[0]?.organization_id,
    "the audit row must carry a real organizationId (E7.1c)",
  ).toBe(organizationId);
}

/**
 * An unknown section is a 400 that NAMES the live options, not a 500 carrying a
 * foreign-key constraint name.
 *
 * The vocabulary is open (ADR 0049 Amendment 2 decision 5), so the request
 * schema checks shape only and the service is the whole boundary — the division
 * `VocabulariesService.assertAssetRole` already uses for roles. The enum did
 * this naming for free; losing it would be a real regression for anyone filling
 * in a form.
 */
export async function assertUnknownSectionIsA400NamingTheLiveSet(
  service: DashboardTemplatesService,
  actor: JwtPayload,
  organizationId: string,
  code: string,
): Promise<void> {
  await expect(
    service.create(actor, {
      organizationId,
      code,
      name: "F3.36 unknown section",
      section: "not-a-section",
    } as Parameters<DashboardTemplatesService["create"]>[1]),
  ).rejects.toThrow(/Unknown dashboard section[\s\S]*electrical/i);
}

/**
 * `F4.317` / ADR 0112 decision 5 — who may author an `organization`-target template.
 *
 * The narrow grant: a `location_admin` of the organization authors its organization templates
 * (create, edit, publish), because the organization strip is theirs to change too. Every other
 * target keeps ADR 0015 §7's refusal of the role, a foreign organization stays out of scope, and
 * an asset-group-scoped user is no master-data role at all.
 */
export async function assertLocationAdminAuthorsItsOwnOrganizationTemplate(
  service: DashboardTemplatesService,
  locationAdmin: JwtPayload,
  organizationId: string,
  code: string,
  onCreated: (id: string) => void,
): Promise<void> {
  const created = await service.create(locationAdmin, {
    organizationId,
    code,
    name: "F4.317 organization strip",
    section: "organization",
    target: "organization",
    content: {
      widgets: [
        {
          key: "alarms-tile",
          title: "Open alarms",
          gridX: 0,
          gridY: 0,
          gridW: 3,
          gridH: 2,
          bindings: [],
          sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
          widgetType: "value_tile",
          config: {},
        },
      ],
      tabs: [],
    },
  } as Parameters<DashboardTemplatesService["create"]>[1]);
  // Recorded before any `expect`, so a failure below cannot leak the row.
  onCreated(created.id);
  expect(created.target, "the created row must be the organization target").toBe("organization");
  const renamed = await service.update(locationAdmin, created.id, { name: "F4.317 organization strip, renamed" });
  expect(renamed.name).toBe("F4.317 organization strip, renamed");
  const published = await service.publish(locationAdmin, created.id);
  expect(published.status, "the location admin must be able to publish its organization template").toBe("published");
}

/** The same role is still refused a `site` template of its own organization (ADR 0015 §7, kept). */
export async function assertLocationAdminIsStillRefusedASiteTemplate(
  service: DashboardTemplatesService,
  locationAdmin: JwtPayload,
  organizationId: string,
  code: string,
): Promise<void> {
  await expect(
    service.create(locationAdmin, {
      organizationId,
      code,
      name: "F4.317 site template the location admin may not author",
      section: "site",
      target: "site",
    } as Parameters<DashboardTemplatesService["create"]>[1]),
    "a location admin must still be refused a site template",
  ).rejects.toThrow(/Location admins cannot author/);
}

/** An organization template of ANOTHER organization is outside the location admin's scope. */
export async function assertLocationAdminIsRefusedAForeignOrganizationTemplate(
  service: DashboardTemplatesService,
  locationAdmin: JwtPayload,
  foreignOrganizationId: string,
  code: string,
): Promise<void> {
  await expect(
    service.create(locationAdmin, {
      organizationId: foreignOrganizationId,
      code,
      name: "F4.317 foreign organization strip",
      section: "organization",
      target: "organization",
    } as Parameters<DashboardTemplatesService["create"]>[1]),
    "a location admin must be refused another organization's organization template",
  ).rejects.toThrow(/outside your access scope/i);
}

/** An asset-group admin may not author an organization template: it is no master-data role. */
export async function assertAssetGroupAdminIsRefusedAnOrganizationTemplate(
  service: DashboardTemplatesService,
  assetGroupAdmin: JwtPayload,
  organizationId: string,
  code: string,
): Promise<void> {
  await expect(
    service.create(assetGroupAdmin, {
      organizationId,
      code,
      name: "F4.317 asset-group admin strip",
      section: "organization",
      target: "organization",
    } as Parameters<DashboardTemplatesService["create"]>[1]),
    "an asset-group admin must be refused an organization template",
  ).rejects.toThrow(ForbiddenException);
}

/**
 * `F4.317` task 3.3 — the stock import reads the ENTRY's target for authorship: a location admin
 * imports `organization-standard` into its own organization (a draft of the organization target),
 * is refused it for another organization, and is still refused the `site` stock entry.
 *
 * **The stock code is fixed, so this case reads the database before it writes** (`F4.317`
 * review): a developer database where someone already imported `organization-standard` into the
 * organization (plan §4.6's own API check leaves exactly that draft) would answer the import with
 * the draft index's 409. That is real data, so it is named and never deleted. `onCreated` takes
 * the imported id before the two refusals run, so a failed `expect` cannot leak the draft and
 * turn every later run into that same 409.
 */
export async function assertLocationAdminImportsOnlyItsOwnOrganizationStrip(
  stock: DashboardTemplatesStockService,
  ownerPool: pg.Pool,
  locationAdmin: JwtPayload,
  organizationId: string,
  foreignOrganizationId: string,
  onCreated: (id: string) => void,
): Promise<void> {
  const existing = await ownerPool.query<{ id: string; version: number }>(
    `SELECT id, version FROM bms.dashboard_templates
      WHERE organization_id = $1 AND code = 'organization-standard' AND status = 'draft'`,
    [organizationId],
  );
  const draft = existing.rows[0];
  expect(
    draft,
    draft === undefined
      ? ""
      : `this database already holds a draft of organization-standard for organization ` +
          `${organizationId} (id ${draft.id}, version ${draft.version}), so the import would be the ` +
          "draft index's 409. It is real data and this suite never deletes it: publish or delete " +
          "that draft, then rerun.",
  ).toBeUndefined();
  const imported = await stock.import(locationAdmin, "organization-standard", organizationId);
  onCreated(imported.id);
  expect(`${imported.code}|${imported.target}|${imported.status}`).toBe("organization-standard|organization|draft");
  await expect(
    stock.import(locationAdmin, "organization-standard", foreignOrganizationId),
    "a location admin must be refused the organization strip of another organization",
  ).rejects.toThrow(/outside your access scope/i);
  await expect(
    stock.import(locationAdmin, "smoc-standard", organizationId),
    "a location admin must still be refused the site stock entry",
  ).rejects.toThrow(/Location admins cannot author/);
}

/**
 * `F4.317` review (security) — **a code keeps one target.** The `location_admin` grant (ADR 0112
 * decision 5) is for `organization`-target templates, and the version and draft index key on
 * `(organization_id, code)` alone, whatever the target. Without this refusal a location admin
 * could open version N+1 of an organization admin's asset-group code as an `organization` row,
 * and its draft would lock the organization admin out of `createDraftFrom` and stock re-import
 * of that code. The code's owner's own next draft must still work: `admin` opens it here, and
 * the refusal is by target, not role, so one admin token gates it (the seeded organization admin
 * belongs to PHEWB, outside the seeded location admin's organization, so `canManageTemplate`'s
 * organization-admin path is not exercised by this case).
 *
 * `onCreated` receives every id this helper creates the moment it exists, so a later failed
 * `expect` cannot leak a row into the developer's database.
 */
export async function assertACodeKeepsItsTarget(
  service: DashboardTemplatesService,
  admin: JwtPayload,
  locationAdmin: JwtPayload,
  organizationId: string,
  code: string,
  onCreated: (id: string) => void,
): Promise<void> {
  const groupTemplate = await service.create(admin, {
    organizationId,
    code,
    name: "F4.317 asset-group code the location admin may not take over",
    section: "electrical",
    target: "asset_group",
    content: {
      widgets: [
        {
          key: "alarms-tile",
          title: "Open alarms",
          gridX: 0,
          gridY: 0,
          gridW: 3,
          gridH: 2,
          bindings: [],
          sources: [{ catalogKey: "alarms.active.count", params: {}, sortOrder: 0 }],
          widgetType: "value_tile",
          config: {},
        },
      ],
      tabs: [],
    },
  } as Parameters<DashboardTemplatesService["create"]>[1]);
  onCreated(groupTemplate.id);
  const published = await service.publish(admin, groupTemplate.id);
  expect(published.status, "the asset-group version must publish, so no draft blocks the probe").toBe("published");

  let takeover: { id: string } | undefined;
  let refusal: unknown;
  try {
    takeover = await service.create(locationAdmin, {
      organizationId,
      code,
      name: "F4.317 organization strip under an asset-group code",
      section: "organization",
      target: "organization",
      content: { widgets: [], tabs: [] },
    } as Parameters<DashboardTemplatesService["create"]>[1]);
  } catch (err) {
    refusal = err;
  }
  if (takeover !== undefined) onCreated(takeover.id);
  expect(
    takeover,
    "a location admin must not open an organization-target version of an asset-group code",
  ).toBeUndefined();
  expect(refusal).toBeInstanceOf(ConflictException);
  expect((refusal as Error).message).toMatch(/already holds asset_group templates/);

  const nextDraft = await service.createDraftFrom(admin, groupTemplate.id);
  onCreated(nextDraft.id);
  expect(
    `${nextDraft.target}|${nextDraft.status}|${nextDraft.version}`,
    "an admin's next draft of its own asset-group code must still open",
  ).toBe("asset_group|draft|2");
}

/**
 * `F4.317` review (security) — **a stock code is reserved for its own target.** A code keeps one
 * target (`assertACodeKeepsItsTarget`), and that refusal holds a row of any status, so without a
 * reservation a `location_admin` could create, publish and leave archived an `organization` row
 * under an asset-group stock code its organization has not imported yet, and every later stock
 * import of that code would answer 409 for the organization admin as well, with no way to clear
 * it short of database work. `create` refuses the code instead, whoever asks, before it writes.
 *
 * **The stock code is fixed, so this case reads the database before it writes**, as
 * `assertLocationAdminImportsOnlyItsOwnOrganizationStrip` does: an existing draft of the code
 * would make the import the draft index's 409. That is real data, so it is named, never deleted.
 */
export async function assertAStockCodeIsReservedForItsTarget(
  service: DashboardTemplatesService,
  stock: DashboardTemplatesStockService,
  ownerPool: pg.Pool,
  admin: JwtPayload,
  locationAdmin: JwtPayload,
  organizationId: string,
  stockCode: string,
  onCreated: (id: string) => void,
): Promise<void> {
  const existing = await ownerPool.query<{ id: string; target: string; status: string }>(
    `SELECT id, target, status FROM bms.dashboard_templates
      WHERE organization_id = $1 AND code = $2 AND (status = 'draft' OR target <> 'asset_group')`,
    [organizationId, stockCode],
  );
  expect(
    existing.rows,
    `this database already holds rows of ${stockCode} for organization ${organizationId} that would ` +
      "block its stock import (a draft, or another target). They are real data and this suite never " +
      "deletes them: remove them, then rerun.",
  ).toEqual([]);

  let squat: { id: string } | undefined;
  let refusal: unknown;
  try {
    squat = await service.create(locationAdmin, {
      organizationId,
      code: stockCode,
      name: "F4.317 organization strip under an asset-group stock code",
      section: "organization",
      target: "organization",
      content: { widgets: [], tabs: [] },
    } as Parameters<DashboardTemplatesService["create"]>[1]);
  } catch (err) {
    refusal = err;
  }
  if (squat !== undefined) onCreated(squat.id);
  expect(squat, "a location admin must not take an asset-group stock code for an organization row").toBeUndefined();
  expect(refusal).toBeInstanceOf(ConflictException);
  expect((refusal as Error).message).toMatch(new RegExp(`"${stockCode}" is reserved for the stock asset_group template`));

  const imported = await stock.import(admin, stockCode, organizationId);
  onCreated(imported.id);
  expect(
    `${imported.code}|${imported.target}|${imported.status}`,
    "an admin's stock import of the code must still open",
  ).toBe(`${stockCode}|asset_group|draft`);
}

import { expect } from "vitest";

import type pg from "pg";


import type { JwtPayload } from "@bms/shared";

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

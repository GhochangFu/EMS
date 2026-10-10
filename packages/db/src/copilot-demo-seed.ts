import type { SeedQueryable } from "./seed-tenant";

/**
 * `F3.85` PR 3 (ADR 0099 decision 5; the owner's Q5 ruling of 2026-10-10) —
 * the demo organization's administrator-copilot switch, on.
 *
 * **Why this exists.** A new organization starts with the copilot off
 * (ruling 15), so without this row every verification run and the AWS demo
 * would need someone to switch it on by hand first.
 *
 * **ESKOM only.** `db:seed` is demo data for the demo tenant. The owner
 * accepted, at the plan gate, that the public demo then sends demo tenant data
 * to the platform LLM provider whenever a demo administrator uses the copilot.
 *
 * **Insert-if-absent, never update.** Every compose boot and every green CI
 * deploy of the demo runs `db:seed`. The switch is the organization's to own:
 * an administrator who turns it off must not have it turned back on by the
 * next deploy, so the statement is `ON CONFLICT … DO NOTHING` and never
 * `DO UPDATE`. Runs inside the caller's `withOrganization` bracket, because
 * `bms.copilot_org_settings` is FORCE-RLS and the row needs the tenant GUC.
 */
export const COPILOT_DEMO_SQL =
  "INSERT INTO bms.copilot_org_settings (organization_id, enabled) VALUES ($1, true) " +
  "ON CONFLICT (organization_id) DO NOTHING";

export async function seedCopilotDemo(pool: SeedQueryable, organizationId: string): Promise<void> {
  await pool.query(COPILOT_DEMO_SQL, [organizationId]);
}

import type { AuditListQuery } from "./audit.schema";

/**
 * `F4.277` (ADR 0099 decision 10) — an audit list read with an optional
 * organization restriction. `organizationIds` is **service-internal**: the
 * route parses `auditListQuerySchema`, which is `.strict()` and does not name
 * it, so no HTTP client can send it. The copilot's `list_audit_log` passes the
 * turn's allowed organization, because the row DTO carries no
 * `organizationId` and the tool cannot filter after the read.
 */
export type AuditListRead = AuditListQuery & { readonly organizationIds?: readonly string[] };

/**
 * The scope a read runs under: the caller's own (`null` = every organization,
 * the global admin) narrowed by the restriction, never widened by it.
 *
 * - no restriction: the caller's scope, unchanged;
 * - `null` scope: the restriction itself;
 * - a scoped reader: the intersection. An empty result is `[]`, which
 *   `inArray` compiles to `false` — it matches nothing (§4.7), never everything.
 *
 * A restricted read excludes the `NULL`-organization platform rows for every
 * reader, the global admin included: they belong to no restricted organization.
 */
export function restrictScope(
  scope: string[] | null,
  organizationIds: readonly string[] | undefined,
): string[] | null {
  if (organizationIds === undefined) return scope;
  if (scope === null) return [...organizationIds];
  const allowed = new Set(organizationIds);
  return scope.filter((id) => allowed.has(id));
}

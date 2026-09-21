import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";

/**
 * `F3.5b` U7 (plan R-15) — `ReportFilesService.resolveOrganization` moved
 * out byte for byte (`this.accessControl` → `deps.accessControl`,
 * `this.fleetDb` → `deps.fleetDb` are the only substitutions) so
 * `ReportSchedulesService` (U11) resolves a schedule's organization by the
 * same rule an on-demand save uses.
 *
 * Amendment 1 item 1 — which organization the row belongs to, from the actor's own grants.
 */
export async function resolveReportOrganization(
  deps: { accessControl: AccessControlService; fleetDb: BmsDb },
  jwt: JwtPayload,
  requested: string | undefined,
): Promise<string> {
  const writable = await deps.accessControl.writableOrganizationIds(jwt);
  if (writable === null) {
    if (requested === undefined) {
      throw new BadRequestException("organizationId is required for a global admin");
    }
    // The global admin's id comes from the body, not from a grant, so its
    // existence is checked here (fleet handle) — before the stamp, the cap
    // pre-check and any storage call. Without this a well-formed uuid naming
    // no organization reached `putObject` and then failed the FK: a 500 for
    // a caller error. The other branches validate against `writable`, which
    // came from real grants.
    const [organization] = await deps.fleetDb
      .select({ organizationId: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, requested))
      .limit(1);
    if (!organization) {
      throw new NotFoundException("Organization not found");
    }
    return requested;
  }
  if (writable.length === 0) {
    throw new ForbiddenException("No organization scope to file the report under");
  }
  if (writable.length === 1) {
    const [only] = writable as [string];
    if (requested !== undefined && requested !== only) {
      throw new ForbiddenException("Report organization is outside your access scope");
    }
    return only;
  }
  if (requested === undefined) {
    throw new BadRequestException(
      `organizationId is required: you administer ${writable.length} organizations`,
    );
  }
  if (!writable.includes(requested)) {
    throw new ForbiddenException("Report organization is outside your access scope");
  }
  return requested;
}

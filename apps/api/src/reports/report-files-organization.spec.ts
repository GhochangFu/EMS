import {
  assert,
  BODY,
  errorMessage,
  errorName,
  harness,
  ORG_ID,
  ORGANIZATION_ADMIN,
  OTHER_ORG_ID,
  save,
  saveRejecting,
} from "./report-files.service.spec";

/**
 * ADR 0071 Amendment 1 item 1 — the organization a saved report is stamped
 * with. Moved out of `report-files.service.spec.ts` on 2026-09-21, byte for
 * byte, when that file reached the AGENTS.md §4.5 line cap (the post-merge
 * sweep added rows to this section — see the sweep’s commit). The harness,
 * the scenarios and the helpers stay in the service spec, which exports them
 * the way `report-files.integration.spec.ts` exports its fixtures.
 */


export async function assertGlobalAdminMustNameTheOrganization(): Promise<void> {
  const { err } = await saveRejecting({}, { ...BODY, organizationId: undefined });
  assert(
    errorName(err) === "BadRequestException" && errorMessage(err).includes("organizationId"),
    `a global admin without a body id got ${errorName(err)}: ${errorMessage(err)}`,
  );
}

export async function assertGlobalAdminProceedsWithTheOrganization(): Promise<void> {
  const h = harness({});
  const dto = await save(h);
  assert(dto.organizationId === ORG_ID, `the row carries ${dto.organizationId}, not the body's organization`);
}

/**
 * U8 (plan gap): a well-formed uuid naming no organization is the caller's
 * 404, before the stamp, the cap pre-check and any storage call — not the FK
 * failure at insert time that `putObject` would otherwise precede. The
 * positive control is `assertGlobalAdminProceedsWithTheOrganization`, whose
 * fake answers the existence read with the row.
 */
export async function assertGlobalAdminNamingAnUnknownOrganizationIs404BeforeAnyWork(): Promise<void> {
  const { err, h } = await saveRejecting({ organizationExists: false });
  assert(
    errorName(err) === "NotFoundException" && errorMessage(err) === "Organization not found",
    `an unknown organization got ${errorName(err)}: ${errorMessage(err)}`,
  );
  assert(h.calls.includes("fleet:organizationExists"), `the existence read did not run: ${h.calls.join(",")}`);
  assert(
    h.calls.filter((c) => c === "putObject").length === 0 && h.reports.calls.length === 0 && !h.calls.includes("tx:begin"),
    `the 404 came after work: calls ${h.calls.join(",")}, renders ${h.reports.calls.length}`,
  );
}

export async function assertSingleOrganizationAdminNeedsNoBodyId(): Promise<void> {
  const h = harness(ORGANIZATION_ADMIN);
  const dto = await save(h, { ...BODY, organizationId: undefined });
  assert(dto.organizationId === ORG_ID, `the single organization was not resolved: ${dto.organizationId}`);
}

export async function assertAForeignBodyIdIs403(): Promise<void> {
  const { err, h } = await saveRejecting(ORGANIZATION_ADMIN, { ...BODY, organizationId: OTHER_ORG_ID });
  assert(
    errorName(err) === "ForbiddenException" && h.reports.calls.length === 0,
    `a foreign body id got ${errorName(err)} after ${h.reports.calls.length} renders`,
  );
}

export async function assertSeveralOrganizationsRequireTheBodyId(): Promise<void> {
  const { err } = await saveRejecting(
    { ...ORGANIZATION_ADMIN, writableOrganizationIds: [ORG_ID, OTHER_ORG_ID] },
    { ...BODY, organizationId: undefined },
  );
  const message = errorMessage(err);
  assert(
    errorName(err) === "BadRequestException" && message.includes("2") && !message.includes(ORG_ID),
    `several organizations without a body id got ${errorName(err)}: ${message}`,
  );
}

/**
 * The multi-organization branches with a body id — found unguarded by the
 * post-merge sweep: inverting `writable.includes(requested)` left every row
 * green, because every row with a body id took the single-grant path. The
 * scenario that guard exists for is an organization admin of A and B filing
 * a report stamped `organization_id = C` — a cross-tenant write the policy
 * cannot refuse, because the tenant GUC is set from this same value.
 */
const TWO_ORGS = { ...ORGANIZATION_ADMIN, writableOrganizationIds: [ORG_ID, OTHER_ORG_ID] };

export async function assertAMultiOrganizationAdminMayNameAHeldOrganization(): Promise<void> {
  const dto = await save(harness(TWO_ORGS), { ...BODY, organizationId: OTHER_ORG_ID });
  assert(dto.organizationId === OTHER_ORG_ID, `the held second organization was not resolved: ${dto.organizationId}`);
}

export async function assertAMultiOrganizationAdminIsRefusedAThirdOrganization(): Promise<void> {
  const third = "34343434-3434-4343-8343-343434343434";
  const { err, h } = await saveRejecting(TWO_ORGS, { ...BODY, organizationId: third });
  assert(
    errorName(err) === "ForbiddenException" && h.reports.calls.length === 0 && !h.calls.includes("putObject"),
    `a third organization got ${errorName(err)}; renders ${h.reports.calls.length}; calls ${h.calls.join(",")}`,
  );
}

export async function assertNoOrganizationIs403(): Promise<void> {
  const { err } = await saveRejecting({ ...ORGANIZATION_ADMIN, writableOrganizationIds: [] });
  assert(errorName(err) === "ForbiddenException", `zero organizations got ${errorName(err)}: ${errorMessage(err)}`);
}

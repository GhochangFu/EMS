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

export async function assertNoOrganizationIs403(): Promise<void> {
  const { err } = await saveRejecting({ ...ORGANIZATION_ADMIN, writableOrganizationIds: [] });
  assert(errorName(err) === "ForbiddenException", `zero organizations got ${errorName(err)}: ${errorMessage(err)}`);
}

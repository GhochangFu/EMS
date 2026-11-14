import { BadRequestException, ConflictException } from "@nestjs/common";

import { translateLocationTariffWriteError } from "./location-tariffs.service";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * `F4.365` U5 — `translateLocationTariffWriteError`, one case per SQLSTATE a
 * mapping write can still meet after the gates (plan U5 write rules). A race
 * on the `EXCLUDE` cannot be staged in an integration suite, so the backstop's
 * 409 is pinned here against a synthetic driver error.
 */
export function assertEveryMappingWriteRefusalIsTranslated(): void {
  const org = "00000000-0000-4000-8000-000000000001";
  const of = (code: string, constraint?: string): unknown => ({ code, constraint });

  const overlap = translateLocationTariffWriteError(of("23P01", "location_tariffs_no_overlap"), org);
  assert(overlap instanceof ConflictException, "23P01 on the EXCLUDE is a 409");
  assert((overlap as Error).message.includes("overlap constraint"), "the race sentence names the constraint, not the dates");

  const policy = translateLocationTariffWriteError(of("42501"), org);
  assert(policy instanceof BadRequestException && (policy as Error).message.includes(org), "42501 is a 400 naming the organization");

  for (const constraint of [
    "location_tariffs_validity_check",
    "location_tariffs_month_start_check",
    "location_tariffs_sanctioned_load_check",
    "location_tariffs_sanctioned_load_unit_check",
  ]) {
    const check = translateLocationTariffWriteError(of("23514", constraint), org);
    assert(check instanceof BadRequestException, `23514 on ${constraint} is a 400`);
  }

  for (const constraint of [
    "location_tariffs_location_id_fkey",
    "location_tariffs_billing_meter_asset_id_fkey",
    "location_tariffs_organization_id_fkey",
  ]) {
    const fk = translateLocationTariffWriteError(of("23503", constraint), org);
    assert(fk instanceof BadRequestException, `23503 on ${constraint} is a 400`);
  }

  // Negative controls: an unmapped constraint, an unmapped code, a plain error, null.
  const otherExclude = of("23P01", "some_other_exclude");
  assert(translateLocationTariffWriteError(otherExclude, org) === otherExclude, "an unmapped EXCLUDE comes back unchanged");
  const otherCheck = of("23514", "calc_parameters_scope_check");
  assert(translateLocationTariffWriteError(otherCheck, org) === otherCheck, "an unmapped CHECK comes back unchanged");
  const unique = of("23505", "location_tariffs_pkey");
  assert(translateLocationTariffWriteError(unique, org) === unique, "an unmapped code comes back unchanged");
  const plain = new Error("boom");
  assert(translateLocationTariffWriteError(plain, org) === plain, "a plain error comes back unchanged");
  assert(translateLocationTariffWriteError(null, org) === null, "null comes back unchanged");
}

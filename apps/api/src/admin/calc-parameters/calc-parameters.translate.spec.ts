import { BadRequestException, ConflictException } from "@nestjs/common";

import { translateCalcParameterWriteError } from "./calc-parameters.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `translateCalcParameterWriteError` — each database refusal a write can
 * meet after the gates, against a synthetic driver error (a genuine race
 * cannot be staged in an integration test; migration review PR 2, Medium 1).
 * Anything unrecognised comes back unchanged for the caller to rethrow.
 */
export function assertEveryDatabaseRefusalIsTranslated(): void {
  const org = "00000000-0000-4000-8000-000000000001";
  const of = (code: string, constraint?: string): unknown => ({ code, constraint });
  const overlap = translateCalcParameterWriteError(of("23P01", "calc_parameters_no_overlap"), org);
  assert(overlap instanceof ConflictException, "23P01 on the EXCLUDE is a 409");
  assert((overlap as Error).message.includes("overlap constraint"), "the race sentence names the constraint, not the dates");
  const policy = translateCalcParameterWriteError(of("42501"), org);
  assert(policy instanceof BadRequestException && (policy as Error).message.includes(org), "42501 is a 400 naming the caller's organization");
  const validity = translateCalcParameterWriteError(of("23514", "calc_parameters_validity_check"), org);
  assert(validity instanceof BadRequestException && (validity as Error).message.includes("effectiveTo"), "the validity CHECK is a 400");
  const key = translateCalcParameterWriteError(of("23503", "calc_parameters_key_fkey"), org);
  assert(key instanceof BadRequestException && (key as Error).message.includes("vocabulary"), "the key FK is a 400 naming the vocabulary");
  const organization = translateCalcParameterWriteError(of("23503", "calc_parameters_organization_id_fkey"), org);
  assert(organization instanceof BadRequestException && (organization as Error).message.includes(org), "the organization FK is a 400");
  // negative controls: a different constraint, a different code, a non-error
  const otherCheck = of("23514", "calc_parameters_scope_check");
  assert(translateCalcParameterWriteError(otherCheck, org) === otherCheck, "an unmapped CHECK comes back unchanged");
  const plain = new Error("boom");
  assert(translateCalcParameterWriteError(plain, org) === plain, "a plain error comes back unchanged");
  assert(translateCalcParameterWriteError(null, org) === null, "null comes back unchanged");
}

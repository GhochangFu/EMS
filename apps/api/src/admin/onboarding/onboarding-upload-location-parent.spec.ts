/**
 * `F4.243` review #4 (ADR 0098 Amendment 2, B8, owner ruling Q2) — a workbook
 * whose `parent_code` the commit would refuse still uploads, and the upload
 * response carries validate's `location.parentCode` field error. The parser
 * stays free of the database, so the placement `OnboardingService.uploadExcel`
 * reads (`listParentCandidates`) is what decides the error.
 *
 * U-P1 is the unknown code. An empty placement answers the same not-found
 * sentence, so U-P1 cannot show that the placement is read; U-P2 (an inactive
 * candidate) and U-P3 (an active one) can, and the mutation `candidates: []`
 * at the upload's placement read reddens both.
 */
import type { OnboardingDraft } from "@bms/shared";

import { JWT, ORG, sessionRow } from "./onboarding-chat-caps.spec";
import { PLACE, build, type Row } from "./onboarding-chat-checkpoints.spec";
import type { ParentCandidate } from "./onboarding-location-parent";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CAMPUS: ParentCandidate = { code: "CAMPUS-1", name: "Campus", active: true, depth: 1 };
const OLD: ParentCandidate = { code: "OLD-SITE", name: "Old site", active: false, depth: 1 };

/** The upload's two collaborators: the workbook names `parentCode` as its location's parent. */
function workbookNaming(parentCode: string) {
  const location = { ...PLACE, parentCode };
  return {
    excel: {
      parseUpload: () => ({ location, rtus: [], assets: [], rtuCredentials: [], displayNameFixes: [] }),
      toDraftPatch: () => ({ location }),
    },
    catalog: { listPointKeys: async () => [] },
  };
}

async function parentErrorsOfUpload(parentCode: string): Promise<string> {
  const session = sessionRow({ location: PLACE } as OnboardingDraft, "location") as Row;
  const { service } = build({ session, selects: [[session], ORG], candidates: [CAMPUS, OLD], ...workbookNaming(parentCode) });
  const response = await service.uploadExcel(JWT, "s-1", Buffer.from("x"));
  return JSON.stringify((response.validationErrors ?? []).filter((error) => error.path === "location.parentCode"));
}

/** U-P1 — an unknown `parent_code` is the not-found field error on the upload response. */
export async function assertAnUnknownParentCodeIsTheUploadsFieldError(): Promise<void> {
  const got = await parentErrorsOfUpload("NOPE-42");
  const want = JSON.stringify([{ path: "location.parentCode", message: "Parent location not found" }]);
  assert(got === want, `an unknown parent_code must be the field error, got ${got}`);
}

/** U-P2 — an inactive candidate is the inactive field error: only the read placement knows it is inactive. */
export async function assertAnInactiveParentCodeIsTheUploadsFieldError(): Promise<void> {
  const got = await parentErrorsOfUpload("OLD-SITE");
  const want = JSON.stringify([{ path: "location.parentCode", message: "The parent location is inactive" }]);
  assert(got === want, `an inactive parent_code must be the inactive field error, got ${got}`);
}

/** U-P3 — an active candidate is no error: the positive control. */
export async function assertAnActiveParentCodeIsNoUploadError(): Promise<void> {
  const got = await parentErrorsOfUpload("CAMPUS-1");
  assert(got === "[]", `an active parent_code must be no error, got ${got}`);
}

import { BadRequestException } from "@nestjs/common";

import type { OnboardingDraft } from "@bms/shared";

import { JWT, ORG, sessionRow } from "./onboarding-chat-caps.spec";
import { PLACE, build, type Row } from "./onboarding-chat-checkpoints.spec";

/**
 * `F1.2` PR 11 review M1 — the two lines of `OnboardingService` that hand the device-profile code
 * lookup to its callers, driven through the service over the echo database: the workbook upload
 * resolves `profile_code` for the session's organization and stores the id; the guided chat's
 * `profile: <code>` turn reads the same lookup and the persisted draft carries the id. The lookup's
 * `SELECT … ORDER BY` takes the next queued answer (one profile row, or none).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const PROFILE = { id: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b", code: "pm5110", version: 3 };
const MODBUS = {
  code: "RTU-1",
  displayName: "RTU-1",
  protocol: "modbus_tcp" as const,
  config: { host: "meter", port: 502, device: { unitId: 1 } },
  credentialsSet: false,
  ingestEnabled: false,
};

/** The upload's collaborators: a workbook of one Modbus row naming `pm5110`. */
function workbookNamingAProfile() {
  return {
    excel: {
      parseUpload: () => ({
        location: PLACE,
        rtus: [{ ...MODBUS, config: { ...MODBUS.config } }],
        assets: [],
        rtuCredentials: [],
        rtuProfileCodes: [{ rtuIndex: 0, code: "pm5110" }],
        displayNameFixes: [],
      }),
      // Reads the parsed rows as they are after the upload resolved the code.
      toDraftPatch: (parsed: { location: unknown; rtus: unknown }) => ({ location: parsed.location, rtus: parsed.rtus }),
    },
    catalog: { listPointKeys: async () => [] },
  };
}

function storedDraft(updates: Record<string, unknown>[]): OnboardingDraft {
  return (updates.at(-1)?.draft ?? {}) as OnboardingDraft;
}

/** SP1 — a workbook code the organization holds is stored as the row's `config.profileId`. */
export async function assertTheUploadStoresTheResolvedProfileId(): Promise<void> {
  const session = sessionRow({ location: PLACE } as OnboardingDraft, "location") as Row;
  const { service, record } = build({ session, selects: [[session], [PROFILE], ORG], ...workbookNamingAProfile() });
  await service.uploadExcel(JWT, "s-1", Buffer.from("x"));
  const config = (storedDraft(record.updates).rtus?.[0]?.config ?? {}) as Record<string, unknown>;
  assert(config.profileId === PROFILE.id, `the stored draft carries the id, got ${JSON.stringify(config)}`);
}

/** SP2 — a workbook code the organization does not hold is the 400 by row, and nothing is stored. */
export async function assertTheUploadRefusesAnUnknownCode(): Promise<void> {
  const session = sessionRow({ location: PLACE } as OnboardingDraft, "location") as Row;
  const { service, record } = build({ session, selects: [[session], [], ORG], ...workbookNamingAProfile() });
  let caught: unknown;
  await service.uploadExcel(JWT, "s-1", Buffer.from("x")).catch((err: unknown) => {
    caught = err;
  });
  assert(caught instanceof BadRequestException, `a 400, got ${String(caught)}`);
  const message = (caught as BadRequestException).message;
  assert(message.startsWith("RTU row 1 names a profile_code"), `got ${message}`);
  assert(record.updates.length === 0, "nothing stored");
}

/** SP3 — the guided `profile: pm5110` turn reads the service's lookup; the persisted draft carries the id. */
export async function assertTheChatTurnPersistsTheProfileId(): Promise<void> {
  const session = sessionRow({ location: PLACE, rtus: [MODBUS] } as OnboardingDraft, "point_keys") as Row;
  const { service, record } = build({ session, selects: [[session], ORG, [PROFILE]] });
  const response = await service.chat(JWT, "s-1", "profile: pm5110");
  const config = (storedDraft(record.updates).rtus?.[0]?.config ?? {}) as Record<string, unknown>;
  assert(config.profileId === PROFILE.id, `the persisted draft carries the id, got ${JSON.stringify(config)} / ${response.assistantMessage}`);
}

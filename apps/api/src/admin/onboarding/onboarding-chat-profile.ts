import type { OnboardingDraft } from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";
import type { ToolContext, ToolState } from "./onboarding-agent-tools";
import type { DeviceProfileLookup } from "./onboarding-device-profiles";
import { guidedWrite } from "./onboarding-guided-writes";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23) — the guided chat's two profile turns.
 *
 * - **`profile: <code>`** names one of the organization's device profiles on the draft's last
 *   Modbus TCP RTU: the newest version of that code, resolved to its id (`config.profileId`),
 *   which the commit binds with the RTUs page bind's helper.
 * - **`ingest on`** switches ingest on at commit for the last Modbus TCP RTU that names a profile.
 *   Without a profile a Modbus RTU is committed with ingest off, so the turn refuses.
 *
 * Both write through `guidedWrite("update_rtu")`, so the Modbus draft schema, the caps and the
 * agent path's refusals apply. Every refusal is fixed text: the typed code is never repeated
 * (§9.6); a success names the profile row's own code and version.
 */

/** `profile: <code>` — the colon is required, as for `topic: x`; one token. */
export const PROFILE_TURN = /^profile:\s*(\S+)$/i;

/** The typed label of the ingest turn, matched against the normalised reply. */
export const INGEST_ON_REPLY = "ingest on";

export const PROFILE_NEEDS_MODBUS_RTU = "A device profile applies to a Modbus TCP RTU; add one first.";
export const PROFILE_NOT_FOUND = "This organization has no Modbus TCP device profile with that code.";
export const PROFILES_UNAVAILABLE = "Device profiles cannot be read in this turn.";
export const INGEST_ON_NEEDS_PROFILE =
  "Ingest is switched on at commit only for a Modbus TCP RTU that names a device profile; say **profile: <code>** first.";

export type ProfileTurnOutcome =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly text: string; readonly actionLine: string; readonly offerIngestOn: boolean };

function lastModbusRtuIndex(draft: OnboardingDraft, needsProfile: boolean): number {
  const rtus = draft.rtus ?? [];
  for (let i = rtus.length - 1; i >= 0; i--) {
    const config = rtus[i].config as Record<string, unknown> | undefined;
    if (rtus[i].protocol === "modbus_tcp" && (!needsProfile || typeof config?.profileId === "string")) {
      return i;
    }
  }
  return -1;
}

/** `profile: <code>` on the last Modbus TCP RTU. */
export async function profileTurn(
  code: string,
  draft: OnboardingDraft,
  state: ToolState,
  tools: ToolContext,
  lookup: DeviceProfileLookup | undefined,
): Promise<ProfileTurnOutcome> {
  const index = lastModbusRtuIndex(draft, false);
  if (index < 0) {
    return { ok: false, error: PROFILE_NEEDS_MODBUS_RTU };
  }
  if (!lookup) {
    return { ok: false, error: PROFILES_UNAVAILABLE };
  }
  const profile = await lookup(code);
  if (!profile) {
    return { ok: false, error: PROFILE_NOT_FOUND };
  }
  const written = await guidedWrite("update_rtu", { index, patch: { config: { profileId: profile.id } } }, state, tools);
  if (!written.ok) {
    return { ok: false, error: written.error };
  }
  const rtu = (state.working.rtus ?? [])[index];
  return {
    ok: true,
    text:
      `Device profile **${profile.code}** version ${profile.version} set on **${quoteCell(rtu.code)}**: its registers are copied at commit.` +
      (rtu.ingestEnabled === true ? "" : " Say **ingest on** to start reading it when the draft is committed."),
    actionLine: written.actionLine,
    offerIngestOn: rtu.ingestEnabled !== true,
  };
}

/** `ingest on` for the last Modbus TCP RTU that names a profile. */
export async function ingestOnTurn(draft: OnboardingDraft, state: ToolState, tools: ToolContext): Promise<ProfileTurnOutcome> {
  const index = lastModbusRtuIndex(draft, true);
  if (index < 0) {
    return { ok: false, error: INGEST_ON_NEEDS_PROFILE };
  }
  const written = await guidedWrite("update_rtu", { index, patch: { ingestEnabled: true } }, state, tools);
  if (!written.ok) {
    return { ok: false, error: written.error };
  }
  const rtu = (state.working.rtus ?? [])[index];
  return {
    ok: true,
    text: `Ingest is on for **${quoteCell(rtu.code)}**: it is read from the moment the draft is committed.`,
    actionLine: written.actionLine,
    offerIngestOn: false,
  };
}

import type { OnboardingDraft } from "@bms/shared";

import { quoteCell } from "../spreadsheet-guard";
import type { ToolContext, ToolState } from "./onboarding-agent-tools";
import type { DeviceProfileLookup } from "./onboarding-device-profiles";
import { guidedWrite } from "./onboarding-guided-writes";

/**
 * `F1.2` plan PR 11 (ADR 0141 Amendment 1 (f), decision 23) — the guided chat's two profile turns.
 *
 * - **`profile: <code> [for <RTU code>]`** names one of the organization's device profiles on a
 *   Modbus TCP RTU of the draft: the newest version of that code, resolved to its id
 *   (`config.profileId`), which the commit binds with the RTUs page bind's helper. The version is
 *   pinned then; a version saved later is not picked up.
 * - **`ingest on [for <RTU code>]`** switches ingest on at commit for a Modbus TCP RTU that names
 *   a profile. Without a profile a Modbus RTU is committed with ingest off, so the turn refuses.
 *
 * PR 11 review L1/L2: without `for`, the turn applies only when exactly one RTU can be the target
 * (any Modbus RTU for `profile:`, one naming a profile for `ingest on`); with several it refuses
 * and asks for `for <RTU code>`, rather than guessing the last one.
 *
 * Both write through `guidedWrite("update_rtu")`, so the Modbus draft schema, the caps and the
 * agent path's refusals apply. Every refusal is fixed text: the typed code is never repeated
 * (§9.6); a success names the profile row's own code and version.
 */

/** `profile: <code> [for <RTU code>]` — the colon is required, as for `topic: x`. */
export const PROFILE_TURN = /^profile:\s*(\S+)(?:\s+for\s+(\S.*?))?\s*$/i;

/** `ingest on [for <RTU code>]`, a trailing `.`, `!` or `?` allowed as for every typed label. */
export const INGEST_ON_TURN = /^ingest\s+on(?:\s+for\s+(\S.*?))?\s*[.!?]?$/i;

/** The suggested reply that offers the ingest turn. */
export const INGEST_ON_REPLY = "ingest on";

export const PROFILE_NEEDS_MODBUS_RTU = "A device profile applies to a Modbus TCP RTU; add one first.";
export const PROFILE_NOT_FOUND = "This organization has no Modbus TCP device profile with that code.";
export const PROFILES_UNAVAILABLE = "Device profiles cannot be read in this turn.";
export const INGEST_ON_NEEDS_PROFILE =
  "Ingest is switched on at commit only for a Modbus TCP RTU that names a device profile; say **profile: <code>** first.";
export const PROFILE_TARGET_AMBIGUOUS =
  "The draft has more than one Modbus TCP RTU; say **profile: <code> for <RTU code>**.";
export const INGEST_ON_TARGET_AMBIGUOUS =
  "More than one Modbus TCP RTU names a device profile; say **ingest on for <RTU code>**.";
export const TARGET_RTU_NOT_FOUND = "No Modbus TCP RTU of the draft has that code.";

export type ProfileTurnOutcome =
  | { readonly ok: false; readonly error: string }
  | { readonly ok: true; readonly text: string; readonly actionLine: string; readonly offerIngestOn: boolean };

type Target = { readonly index: number } | { readonly error: string };

function namesProfile(rtu: NonNullable<OnboardingDraft["rtus"]>[number]): boolean {
  return typeof (rtu.config as Record<string, unknown> | undefined)?.profileId === "string";
}

/**
 * The RTU a turn writes to. With `rtuCode`, the Modbus TCP RTU with that code (case-insensitive);
 * without, the one candidate, or a refusal when there are none or several. Fixed text throughout:
 * a typed RTU code is never repeated.
 */
function targetOf(draft: OnboardingDraft, rtuCode: string | undefined, needsProfile: boolean): Target {
  const modbus = (draft.rtus ?? [])
    .map((rtu, index) => ({ rtu, index }))
    .filter((entry) => entry.rtu.protocol === "modbus_tcp");
  if (rtuCode !== undefined) {
    const wanted = rtuCode.trim().toLowerCase();
    const named = modbus.filter((entry) => entry.rtu.code.trim().toLowerCase() === wanted);
    if (named.length !== 1) {
      return { error: TARGET_RTU_NOT_FOUND };
    }
    return needsProfile && !namesProfile(named[0].rtu) ? { error: INGEST_ON_NEEDS_PROFILE } : { index: named[0].index };
  }
  const candidates = needsProfile ? modbus.filter((entry) => namesProfile(entry.rtu)) : modbus;
  if (candidates.length === 0) {
    return { error: needsProfile ? INGEST_ON_NEEDS_PROFILE : PROFILE_NEEDS_MODBUS_RTU };
  }
  if (candidates.length > 1) {
    return { error: needsProfile ? INGEST_ON_TARGET_AMBIGUOUS : PROFILE_TARGET_AMBIGUOUS };
  }
  return { index: candidates[0].index };
}

/** `profile: <code> [for <RTU code>]`. */
export async function profileTurn(
  code: string,
  rtuCode: string | undefined,
  draft: OnboardingDraft,
  state: ToolState,
  tools: ToolContext,
  lookup: DeviceProfileLookup | undefined,
): Promise<ProfileTurnOutcome> {
  const target = targetOf(draft, rtuCode, false);
  if ("error" in target) {
    return { ok: false, error: target.error };
  }
  const { index } = target;
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
    // PR 11 review L6: the version is pinned now, so the reply says so.
    text:
      `Device profile **${profile.code}** set on **${quoteCell(rtu.code)}** as version ${profile.version}; ` +
      "a newer version saved later is not picked up. Its registers are copied at commit." +
      (rtu.ingestEnabled === true ? "" : " Say **ingest on** to start reading it when the draft is committed."),
    actionLine: written.actionLine,
    offerIngestOn: rtu.ingestEnabled !== true,
  };
}

/** `ingest on [for <RTU code>]` for a Modbus TCP RTU that names a profile. */
export async function ingestOnTurn(
  rtuCode: string | undefined,
  draft: OnboardingDraft,
  state: ToolState,
  tools: ToolContext,
): Promise<ProfileTurnOutcome> {
  const target = targetOf(draft, rtuCode, true);
  if ("error" in target) {
    return { ok: false, error: target.error };
  }
  const { index } = target;
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

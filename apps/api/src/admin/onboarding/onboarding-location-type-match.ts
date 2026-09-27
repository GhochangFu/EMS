/**
 * `F4.157` / ADR 0077 decision 7 — how the onboarding chat reads a location
 * type out of a message, and keeps a model from writing one that is not live.
 *
 * The vocabulary is `bms.location_types`, read per turn through
 * `VocabulariesService.listLocationTypes()`; nothing here holds a list of its
 * own. The chat used to test the message for `rsmoc` and `csmoc` and default
 * everything else to `smoc_campus`, which made every new site a campus. Now a
 * message that names no active type gets a question instead of a default.
 *
 * Kept out of `onboarding-chat.service.ts` because that file sits at AGENTS.md
 * §4.5's 1,000-line ceiling.
 */
import type { LocationTypeDto, OnboardingDraft } from "@bms/shared";

import type { OnboardingDraftInput } from "./onboarding.schema";

/**
 * Lower case, and every run of characters that is not a letter or a digit
 * becomes one space, padded at both ends. `pump_station`, `Pump station` and
 * `PUMP-STATION` all read as ` pump station `.
 *
 * The labels are database text, so they are compared as normalised strings and
 * never compiled into a regular expression.
 */
function normalised(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/**
 * The active code the message names, by code or by label, as whole words and
 * case-folded; `undefined` when it names none.
 *
 * Whole words, so `rsmoc` is not read as `smoc`. When two types match, the
 * longer phrase wins: it is the more specific one.
 */
export function matchLocationType(
  message: string,
  types: readonly LocationTypeDto[],
): string | undefined {
  const text = normalised(message);
  let best: { code: string; length: number } | undefined;
  for (const type of types) {
    for (const phrase of [type.code, type.label]) {
      const token = normalised(phrase);
      if (token.trim() === "" || !text.includes(token)) {
        continue;
      }
      if (best === undefined || token.length > best.length) {
        best = { code: type.code, length: token.length };
      }
    }
  }
  return best?.code;
}

/** The question the chat asks when a location has a name and no type. */
export function locationTypeQuestion(name: string): string {
  return `Which type of location is **${name}**?`;
}

/**
 * The model's patch without a `location.type` that is not an active code.
 *
 * The system prompt lists the active codes, and an instruction is not a
 * control: `onboardingDraftSchema` checks only the shape of `type`, so an
 * invented code would pass the parse and reach the draft. Only the one key is
 * dropped. The rest of the location is kept, and the validator then asks for
 * the type the model could not supply.
 */
export function withoutInactiveLocationType(
  patch: OnboardingDraftInput,
  activeCodes: readonly string[],
): OnboardingDraftInput {
  const type = patch.location?.type;
  if (patch.location === undefined || type === undefined || activeCodes.includes(type)) {
    return patch;
  }
  const location = { ...patch.location };
  delete location.type;
  return { ...patch, location };
}

type DraftLocation = NonNullable<OnboardingDraft["location"]>;

/**
 * What one rule-based location turn keeps and which type it resolves.
 *
 * Owner ruling, 2026-09-27: the message is the location name exactly as before
 * `F4.157` (name, slug and code derived from it) in every location-phase turn
 * **except while the chat waits for a type**.
 *
 * - A stored type counts only when it is an active code in `types`. An inactive
 *   or unknown one is treated as absent, as the OpenAI branch drops one
 *   (`withoutInactiveLocationType`), so it is asked for again, never passed.
 * - `type` is the type the message names, else the stored active one. The patch
 *   carries it, and the chat asks "Which type…?" only when it is absent. It is
 *   never defaulted.
 * - `kept` is the stored location only while the chat waits for a type: the
 *   stored location has a non-empty name and no active type. The message is
 *   then a type answer, never a new name. `kept` never carries `type`, so an
 *   inactive stored code is not copied back into the patch.
 *
 * `F4.157` review: this was keyed on the stored location lacking a type alone,
 * and the patch carried a type only when this message matched one. A stored
 * `{ name: "", type: "pump_station" }` then asked for a type it held, and the
 * answer "Pump station" renamed the location to "Pump station". A first fix
 * also kept a named, typed location whenever the message named a type; the
 * ruling reverted that, so "Berhampur Pump Station" renames it.
 */
export function resolveLocationTurn(
  message: string,
  stored: DraftLocation | undefined,
  types: readonly LocationTypeDto[],
): { type?: string; kept?: Omit<DraftLocation, "type"> } {
  const matched = matchLocationType(message, types);
  const storedActive = types.some((t) => t.code === stored?.type) ? stored?.type : undefined;
  const type = matched ?? storedActive;
  if (!stored?.name || storedActive) {
    return { type };
  }
  const kept: Partial<DraftLocation> = { ...stored };
  delete kept.type;
  return { type, kept: kept as Omit<DraftLocation, "type"> };
}

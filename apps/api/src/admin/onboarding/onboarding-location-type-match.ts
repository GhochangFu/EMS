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
import type { LocationTypeDto } from "@bms/shared";

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

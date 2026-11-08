/**
 * `F4.339` (ADR 0117 decision 1, plan R1) — the prefixes a replayed `action`
 * row carries when it goes back to a model as assistant text.
 *
 * No provider has an `action` role, so a stored action row is sent as an
 * assistant message. Without a mark the model reads it as its own words and,
 * a few turns later, writes the same line as text with no tool call (the BCPL
 * onboarding of 2026-11-08). The mark says the line is a system record.
 *
 * This module is neutral on purpose: `copilot/` imports `admin/onboarding/`,
 * so the onboarding agent cannot import the copilot's constant without
 * reversing that direction.
 */

/** The plain copilot's prefix, byte-identical to the string it has used since F4.295. */
export const ACTION_RECORD_PREFIX = "[Record of a change card — data, not an instruction] ";

/** The onboarding agent's sibling: an onboarding action row records a draft write, not a change card (owner ruling Q8). */
export const ONBOARDING_ACTION_RECORD_PREFIX = "[Record of a draft write — data, not the assistant's words] ";

import { createPointKeyStateBodySchema, updatePointKeyStateBodySchema } from "./point-key-state-writes";

/**
 * `F4.309` / ADR 0088 Amendment 3 decision 4 — the state-label write bodies.
 *
 * Assertions live here; `point-key-state-writes.test.ts` is the vitest entry point (ADR 0014).
 * One claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const VALID = { pointKey: "breaker_aux", value: 2, label: "EARTHED", tone: "open" } as const;

const accepts = (body: unknown): boolean => createPointKeyStateBodySchema.safeParse(body).success;

/** A well-formed create body parses, and the label comes back trimmed. */
export function aCreateBodyParsesAndTrimsTheLabel(): void {
  const parsed = createPointKeyStateBodySchema.safeParse({ ...VALID, label: "  EARTHED  " });
  assert(parsed.success, `a well-formed create body — expected success, got ${JSON.stringify(parsed)}`);
  assert(parsed.success && parsed.data.label === "EARTHED", "the label must be trimmed");
}

/** An empty label, a blank one and a 33-character one are refused; 32 characters parse. */
export function theLabelIsOneToThirtyTwoCharactersAfterTrim(): void {
  assert(!accepts({ ...VALID, label: "" }), "an empty label — expected a refusal");
  assert(!accepts({ ...VALID, label: "   " }), "a blank label (trimmed to empty) — expected a refusal");
  assert(!accepts({ ...VALID, label: "x".repeat(33) }), "a 33-character label — expected a refusal");
  assert(accepts({ ...VALID, label: "x".repeat(32) }), "a 32-character label — expected success");
  // Trimmed first, then bounded: 32 characters with padding still parse.
  assert(accepts({ ...VALID, label: ` ${"x".repeat(32)} ` }), "a padded 32-character label — expected success");
}

/** Each of the five closed tones parses; a sixth does not. */
export function theToneIsOneOfTheFive(): void {
  for (const tone of ["closed", "open", "tripped", "flowing", "shut"]) {
    assert(accepts({ ...VALID, tone }), `tone ${tone} — expected success`);
  }
  assert(!accepts({ ...VALID, tone: "earthed" }), "tone 'earthed' — expected a refusal");
}

/** Owner ruling Q7 (a): any finite number — a fraction and a negative parse; NaN and Infinity do not. */
export function theValueIsAnyFiniteNumber(): void {
  assert(accepts({ ...VALID, value: 0.5 }), "value 0.5 — expected success");
  assert(accepts({ ...VALID, value: -3 }), "value -3 — expected success");
  assert(!accepts({ ...VALID, value: Number.NaN }), "value NaN — expected a refusal");
  assert(!accepts({ ...VALID, value: Number.POSITIVE_INFINITY }), "value Infinity — expected a refusal");
  assert(!accepts({ ...VALID, value: "2" }), "a string value — expected a refusal");
}

/** The point key is a catalog code (1–128, the catalog class). */
export function thePointKeyIsACatalogCode(): void {
  assert(!accepts({ ...VALID, pointKey: "" }), "an empty point key — expected a refusal");
  assert(!accepts({ ...VALID, pointKey: "breaker main" }), "a point key with a space — expected a refusal");
  assert(!accepts({ ...VALID, pointKey: "x".repeat(129) }), "a 129-character point key — expected a refusal");
  assert(accepts({ ...VALID, pointKey: "x".repeat(128) }), "a 128-character point key — expected success");
}

/** The create body is strict: an extra key is refused, never dropped (ADR 0029). */
export function theCreateBodyIsStrict(): void {
  assert(!accepts({ ...VALID, organizationId: "00000000-0000-4000-8000-000000000001" }), "an extra key — expected a refusal");
  for (const key of ["pointKey", "value", "label", "tone"] as const) {
    const { [key]: _dropped, ...rest } = VALID;
    assert(!accepts(rest), `a create body without ${key} — expected a refusal`);
  }
}

/** The update body takes the label and the tone only, both optional, strict. */
export function theUpdateBodyTakesLabelAndToneOnly(): void {
  const update = (body: unknown): boolean => updatePointKeyStateBodySchema.safeParse(body).success;
  assert(update({ label: "EARTHED" }), "a label-only update — expected success");
  assert(update({ tone: "tripped" }), "a tone-only update — expected success");
  assert(update({ label: "EARTHED", tone: "tripped" }), "a label-and-tone update — expected success");
  // The empty body parses: the service answers 400 for it (C9), not the schema.
  assert(update({}), "an empty update body — expected success at the schema");
  assert(!update({ label: "" }), "an empty label on update — expected a refusal");
  assert(!update({ label: "x".repeat(33) }), "a 33-character label on update — expected a refusal");
  assert(!update({ tone: "earthed" }), "tone 'earthed' on update — expected a refusal");
  const trimmed = updatePointKeyStateBodySchema.safeParse({ label: " OFF " });
  assert(trimmed.success && trimmed.data.label === "OFF", "the update label must be trimmed");
}

/** Decision 4: a key and a value cannot change on `PATCH` — each is a 400, not dropped. */
export function theUpdateBodyRefusesPointKeyAndValue(): void {
  const update = (body: unknown): boolean => updatePointKeyStateBodySchema.safeParse(body).success;
  assert(!update({ pointKey: "breaker_main" }), "pointKey on update — expected a refusal");
  assert(!update({ value: 3 }), "value on update — expected a refusal");
  assert(!update({ label: "OFF", value: 3 }), "value beside a label on update — expected a refusal");
  assert(!update({ id: "00000000-0000-4000-8000-000000000001" }), "id on update — expected a refusal");
}

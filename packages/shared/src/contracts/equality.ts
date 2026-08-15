/**
 * Type-level equality harness for the `F4.23` conversion spike (ADR 0030
 * decision 4a).
 *
 * The ADR asks whether the 100 types exported by this package can be expressed
 * as Zod schemas whose `z.infer` is **identical** to what is exported today —
 * "checked by a type-level equality assertion, not by reading". That sentence
 * hides a choice, because *identical* has two defensible meanings and they do
 * not agree on the cases this package actually contains.
 *
 * So both bars are measured, and a type that passes one and fails the other is
 * a **different finding** from one that fails both:
 *
 * - fails `Strict`, passes `Assignable` → the bar is too strict
 * - fails both → the schema is wrong
 *
 * That distinction is the whole point of running two. Contorting a schema to
 * satisfy a bar that is itself wrong would produce a worse schema and a green
 * result, which is the failure mode this repository keeps finding.
 */

/**
 * Strict structural identity, via the conditional-type trick: two types are
 * `Strict`-equal only if the compiler's internal relation treats them as the
 * same type, not merely as mutually assignable.
 *
 * The deferred conditional `<T>() => T extends A ? 1 : 2` is compared to the
 * same shape over `B`. TypeScript compares those signatures by identity of the
 * unresolved conditional, so `A & B` and the flattened `{ ...a, ...b }` are
 * **not** equal here even though each is assignable to the other.
 */
export type Strict<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * Mutual assignability — the practical bar. `A` may be used everywhere `B` is
 * expected and vice versa, so no call site can tell them apart.
 *
 * Tuple-wrapped (`[A] extends [B]`) deliberately: a bare `A extends B` on a
 * union distributes over its members and would report a union equal to one of
 * its own arms.
 */
export type Assignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Records one measurement.
 *
 * Each assertion is written as a standalone `const` with an explicit
 * annotation rather than a `type _ = AssertTrue<…>` alias, so that **every**
 * failure is reported by `tsc` independently. An alias chain stops at the
 * first error and would undercount, turning "9 conversions, 3 fail" into
 * "1 error" — a census that cannot count is not a census.
 */
export type Measured<T extends boolean> = T;

import { z } from "zod";

/**
 * `F4.341` (ADR 0118 decision 1, Amendment 1 A1) — the closed list of design systems. `nexus-soft`
 * is today's look and the default. A new name is a contract change and an amendment to ADR 0118.
 * Migration `0134`'s CHECKs and `apps/web/src/index.css`'s design blocks are held to this list by
 * tests.
 */
export const DESIGN_SYSTEMS = ["nexus-soft", "enterprise-flat", "swiss-grid", "bento-ops", "control-room-dark"] as const;

export const designSystemSchema = z
  .enum(DESIGN_SYSTEMS)
  .describe(
    "Design system (ADR 0118): nexus-soft (default), enterprise-flat, swiss-grid, bento-ops or control-room-dark. Sets shape, type, spacing and the shell; never a colour.",
  );

/** `F4.341` — one of the five names. */
export type DesignSystem = z.infer<typeof designSystemSchema>;

/**
 * `F4.341` — a stored value as a design system, or `nexus-soft` when it is not one of the five. A
 * CHECK forbids that case; a read path falls back to the default rather than throwing (the F4.108
 * rule: a stored-data parse never reaches the ZodError filter).
 */
export function designSystemOrDefault(value: unknown): DesignSystem {
  const parsed = designSystemSchema.safeParse(value);
  return parsed.success ? parsed.data : "nexus-soft";
}

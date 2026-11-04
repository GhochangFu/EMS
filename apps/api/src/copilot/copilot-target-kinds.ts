import { type TemplateLifecycleStatus, templateLifecycleStatusSchema } from "@bms/shared";
import type { CatalogRef, CatalogRefKind } from "@bms/shared/copilot";

/**
 * The resolver's two pure kind readers, moved out of
 * `copilot-target-resolver.ts` unchanged by `F4.311` PR 3 for the AGENTS.md
 * §4.5 line cap (the resolver re-exports `refKindOf`).
 */

/**
 * `F3.86` PR 2 — the row kind a ref names: its own, or, for a field whose kind
 * depends on another field (a grant's `targetId` and `kind`), the one the map
 * gives that field's value. `null` when the map does not name the value: the
 * proposal is refused.
 */
export function refKindOf(ref: CatalogRef, body: Readonly<Record<string, unknown>>): CatalogRefKind | null {
  if ("kind" in ref) return ref.kind;
  const value = body[ref.kindField];
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ref.kinds, value) ? (ref.kinds[value] ?? null) : null;
}

/**
 * `F4.246` — a template row's `status` column as the lifecycle vocabulary. A
 * value outside it is left off, so the propose tool's mirror fails closed on
 * it rather than reading an unknown state as admissible.
 */
export function lifecycleStatusOf(status: string): { status?: TemplateLifecycleStatus } {
  const parsed = templateLifecycleStatusSchema.safeParse(status);
  return parsed.success ? { status: parsed.data } : {};
}

/**
 * Stack-safe walks over caller-supplied JSON — `F4.115`.
 *
 * The walker moved to `packages/shared/src/stack-safe-json.ts` in `F3.85` PR 11a
 * (plan §11.3 Unit 1), because the asset-template `content` schema moved to
 * `packages/shared` and its depth guard must stay the first statement inside
 * that schema's own refine. This file re-exports it, so every api importer
 * (the onboarding module, the copilot secret scrub) keeps its
 * `"../stack-safe-json"` import unchanged. No second copy of the walk lives
 * here — `tests/f4.115-iterative-draft-walkers.test.ts` holds that.
 */
export {
  cloneJson,
  exceedsDepth,
  isJsonContainer,
  rebuildDeep,
  type ContainerPredicate,
  type KeyVisitor,
  type LeafVisitor,
} from "@bms/shared";

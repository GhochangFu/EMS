/**
 * `F3.32e` / ADR 0084 decision 5 — the shape elements a library glyph may draw. Since `F3.32f`
 * (ADR 0086 decision 9) the lists and the grammar live in `@bms/shared`
 * (`packages/shared/src/contracts/mimic-shapes.ts`), where the generator's gate and slice 3's
 * upload path read them; this module re-exports them so the web's imports stay as they were.
 */
export { MIMIC_SHAPE_ATTRS, MIMIC_SHAPE_TAGS } from "@bms/shared";
export type { MimicShape, MimicShapeAttr, MimicShapeTag } from "@bms/shared";

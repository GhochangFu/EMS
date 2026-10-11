import { z, type ZodRawShape, type ZodTypeAny } from "zod";

/**
 * `F3.85` PR 8 (plan §10.1) — the object shapes under a body schema.
 *
 * A body schema is a `ZodObject`, a `ZodEffects` around one (a `.refine` or
 * `.superRefine` — `createDashboardBodySchema`), or a `ZodUnion` of those
 * (`instantiateSectionTemplateBodySchema`). Neither of the last two has
 * `.shape` or `.pick`, so this unwraps `ZodEffects` through `_def.schema`
 * until it reaches a `ZodObject`, and returns one shape per union member.
 * Anything else throws: a catalog entry whose steps cannot be mapped is a
 * load error, not a runtime one.
 *
 * The full-body refinements run only when the whole body is parsed (at
 * propose time); a step's partial check reads these shapes alone.
 */
export function objectShapeOf(schema: ZodTypeAny): ZodRawShape[] {
  let current: ZodTypeAny = schema;
  while (current instanceof z.ZodEffects) {
    current = current._def.schema as ZodTypeAny;
  }
  if (current instanceof z.ZodObject) {
    return [current.shape as ZodRawShape];
  }
  if (current instanceof z.ZodUnion) {
    return (current.options as ZodTypeAny[]).flatMap((option) => objectShapeOf(option));
  }
  throw new Error(`F3.85: a catalog body must be an object, a refined object or a union of them, not ${current.constructor.name}`);
}

/** Every top-level body key, over all union members, in first-seen order. */
export function bodyFieldsOf(schema: ZodTypeAny): string[] {
  return [...new Set(objectShapeOf(schema).flatMap((shape) => Object.keys(shape)))];
}

/**
 * The schema one wizard step's values are checked against: each named field
 * from the first union member that has it, every field optional, no other key
 * (`.strict()`). It writes nothing and runs no full-body refinement.
 */
export function stepValuesSchema(schema: ZodTypeAny, fields: readonly string[]): z.ZodObject<ZodRawShape, "strict"> {
  const shapes = objectShapeOf(schema);
  const picked: ZodRawShape = {};
  for (const field of fields) {
    const owner = shapes.find((shape) => Object.prototype.hasOwnProperty.call(shape, field));
    if (owner === undefined) {
      throw new Error(`F3.85: the step field "${field}" is not a body field`);
    }
    picked[field] = (owner[field] as ZodTypeAny).optional();
  }
  return z.object(picked).strict();
}

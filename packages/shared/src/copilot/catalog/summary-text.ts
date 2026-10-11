import { z } from "zod";

/** The path parameter rule for a row id, the same as the controllers' `idParamSchema`. */
export const uuidParam = z.string().uuid();

/** The body of a route that takes none: the stored, hashed and sent body is `{}` (plan §6.4). */
export const emptyBody = z.object({}).strict();

/** A name as a card shows it. */
export function quoted(name: string): string {
  return `"${name}"`;
}

/** The body's keys, in the order sent, as a readable list: "name, slug and description". */
export function fieldList(body: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(body);
  if (keys.length === 0) return "nothing";
  if (keys.length === 1) return keys[0] as string;
  return `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}`;
}

/** A string field of the body, or the fallback when it is absent or not a string. */
export function text(body: Readonly<Record<string, unknown>>, key: string, fallback = ""): string {
  const value = body[key];
  return typeof value === "string" ? value : fallback;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

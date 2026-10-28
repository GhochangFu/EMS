import { z, type ZodType, type ZodTypeDef } from "zod";

/**
 * `F4.291` (ADR 0099 Amendment 9 E5(d)) — the opaque `cursor` of the
 * 25-capped copilot lists, instead of a higher cap.
 *
 * A cursor is base64url JSON `{ o, k? }`: `o` is the organization to resume
 * at, `k` the key to resume THAT organization at (an offset for an in-memory
 * list, the alarm keyset cursor for `list_alarms`). It is validated per tool
 * on the way in: the outer shape, `k` against the tool's own key schema, and
 * `o` against the organizations the call reads — a cursor that fails any of
 * the three is {@link COPILOT_TOOL_BAD_CURSOR}, never a silent empty page.
 *
 * Paging is opt-in per tool (`ListPaging` in `copilot-read-tool.ts`): a tool
 * without it never returns `nextCursor`, so a model that follows "call again
 * with cursor" is never refused by a strict schema without one. A call
 * without a cursor returns the same items and `truncated` as before paging
 * existed, plus `nextCursor`. The model re-sends the same arguments with the
 * cursor; a cursor does not carry them (a changed filter gives a page of the
 * new filter, not an error).
 */

export const COPILOT_TOOL_BAD_CURSOR = "cursor is not one this tool returned; omit it to start again.";

/** The tool argument. Bounded: a cursor this module encodes is under 300 characters. */
export const listCursorSchema = z.string().min(1).max(512);

/** The key of an in-memory list: the offset of the first row of the next page. */
export const offsetKeySchema = z.number().int().min(0).max(100_000);

/** The phrases the paged tools' descriptions share (the definitions budget counts every character). */
export const LOCATION_ID_PHRASE = "locationId (a site and everything under it)";
export const CURSOR_PHRASE = "a non-null nextCursor: call again with the same arguments plus cursor";

export type ListCursor<K> = { readonly o: string; readonly k?: K };

export function encodeListCursor(cursor: ListCursor<string | number>): string {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

/**
 * The cursor, or `null` when it does not decode, its key fails `key`, or its
 * organization is not one of `organizations` (the call's own targets).
 */
export function decodeListCursor<K>(
  raw: string,
  key: ZodType<K, ZodTypeDef, unknown>,
  organizations: readonly string[],
): ListCursor<K> | null {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  const body = z.object({ o: z.string().uuid(), k: key.optional() }).strict().safeParse(json);
  if (!body.success || !organizations.includes(body.data.o)) return null;
  return body.data as ListCursor<K>;
}

/**
 * One page of an in-memory list: rows `[resume, resume + room)`, `more` and
 * the offset to resume at when rows are left.
 */
export function offsetPage<T>(
  rows: readonly T[],
  resume: number | undefined,
  room: number,
): { items: T[]; more: boolean; nextKey?: number } {
  const start = resume ?? 0;
  const items = rows.slice(start, start + Math.max(0, room));
  const end = start + items.length;
  return end < rows.length ? { items, more: true, nextKey: end } : { items, more: false };
}

/**
 * Rows in the service's order with every run of equal `rankOf` (the service's
 * own sort key) put in id order. Postgres does not fix the order of rows that
 * tie on the `ORDER BY` key between two statements, so an offset page over a
 * tied run could repeat or skip a row; the id makes the order total. Rows of
 * different rank keep the service's order.
 */
export function orderTiesById<T extends { readonly id: string }>(rows: readonly T[], rankOf: (row: T) => string): T[] {
  const out: T[] = [];
  let run: T[] = [];
  const flush = () => {
    run.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.push(...run);
    run = [];
  };
  for (const row of rows) {
    if (run.length > 0 && rankOf(run[0]!) !== rankOf(row)) flush();
    run.push(row);
  }
  flush();
  return out;
}

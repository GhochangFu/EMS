/**
 * `F4.296` (ADR 0099 Amendment 10 F3; owner ruling Q3, 2026-10-30) — the
 * partial sentence. The release-5 live check saw a turn say "the site has 28
 * in total" and stop while `list_alarms` still returned a `nextCursor` (164
 * in the database). The server, not the model, now says so: every paged read
 * result (one that carries a `nextCursor` key) is noted per tool, and when
 * the turn ends `final` with a tool whose newest page left a non-null
 * `nextCursor`, one fixed sentence per such tool is appended to the stored
 * reply, naming the rows read and, where the tool reports it, the total. No
 * model step is added and the sentence never reaches the model.
 *
 * A read is one tool with one set of arguments, `cursor` aside (`F4.296`
 * review: keyed by the tool alone, a second site's closed list hid the first
 * site's open one). A call without a `cursor` starts that read again; a call
 * with one sets that cursor's page, so a cursor sent twice is counted once.
 * The read's newest page decides whether it is left open. A result of the
 * same read with no `nextCursor` key — a `summary`, the whole site in one
 * call — closes it: `summary` is left out of the key for that reason.
 */

/** One read's pages in a turn: rows per cursor (`""` the first page), the total, and whether its newest page left more. */
export type PagedRead = { readonly tool: string; readonly pages: Map<string, number>; total: number | null; open: boolean };

/** The paged reads of one turn, by {@link readKey}. */
export type PagedReads = Map<string, PagedRead>;

/** The tool and its arguments without `cursor` and `summary`, keys sorted: one read across its pages. */
export function readKey(tool: string, args: unknown): string {
  const rest = typeof args === "object" && args !== null ? { ...(args as Record<string, unknown>) } : {};
  delete rest.cursor;
  delete rest.summary;
  return `${tool}\u0000${JSON.stringify(Object.keys(rest).sort().map((key) => [key, rest[key]]))}`;
}

/** The rows a read has seen: each cursor's page once. */
export function rowsRead(read: PagedRead): number {
  return [...read.pages.values()].reduce((n, rows) => n + rows, 0);
}

/** The noun a tool's rows are counted in; any other paged tool counts "rows". */
const NOUN_OF: Readonly<Record<string, string>> = {
  get_point_stats: "assets",
  get_site_point_inventory: "points",
};

/** The rows of one item: an `unruled` inventory asset counts its points, any other item one. */
function rowsOf(item: unknown): number {
  if (typeof item === "object" && item !== null && "points" in item) {
    const points = (item as { points: unknown }).points;
    if (typeof points === "object" && points !== null) return Object.keys(points).length;
  }
  return 1;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The total a page reports, summed over its organization entries: an
 * `unruled` inventory's `unwatchedCount`, a full inventory's `pointCount`, or
 * a `get_point_stats` location page's `assetCount` (lifted to the top of its
 * result). `null` when the tool reports none.
 */
function totalOf(result: Record<string, unknown>, entries: readonly Record<string, unknown>[]): number | null {
  let total: number | null = null;
  for (const entry of entries) {
    const one = count(entry.unwatchedCount) ?? count(entry.pointCount) ?? count(entry.assetCount);
    if (one !== null) total = (total ?? 0) + one;
  }
  return total ?? count(result.assetCount);
}

/** Notes one successful tool result. One with no `nextCursor` key is not a page: it only closes the same read. */
export function notePagedRead(reads: PagedReads, tool: string, args: unknown, result: unknown): void {
  const key = readKey(tool, args);
  if (typeof result !== "object" || result === null || !("nextCursor" in result)) {
    const read = reads.get(key);
    if (read !== undefined) read.open = false;
    return;
  }
  const page = result as Record<string, unknown>;
  const entries = Array.isArray(page.organizations)
    ? page.organizations.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
  const rows = entries.reduce((n, entry) => n + (Array.isArray(entry.items) ? entry.items.reduce((m: number, item) => m + rowsOf(item), 0) : 0), 0);
  const cursor = typeof args === "object" && args !== null ? (args as { cursor?: unknown }).cursor : undefined;
  const before = typeof cursor === "string" ? reads.get(key) : undefined;
  const read: PagedRead = before ?? { tool, pages: new Map(), total: null, open: false };
  read.pages.set(typeof cursor === "string" ? cursor : "", rows);
  read.total = totalOf(page, entries) ?? read.total;
  read.open = page.nextCursor !== null && page.nextCursor !== undefined;
  reads.set(key, read);
}

/** The fixed sentence for one read left open. */
export function partialSentence(read: PagedRead): string {
  const noun = NOUN_OF[read.tool] ?? "rows";
  const rows = rowsRead(read);
  return read.total !== null && read.total > rows
    ? `This answer is partial: it read ${rows} of ${read.total} ${noun}.`
    : `This answer is partial: it read ${rows} ${noun} from ${read.tool}, and more were not read.`;
}

/** The reply, with one partial sentence appended per read left open. Never replaces. */
export function withPartialNote(reply: string, reads: PagedReads): string {
  const sentences = [...reads.values()].filter((read) => read.open).map(partialSentence);
  return sentences.length === 0 ? reply : `${reply.trimEnd()} ${sentences.join(" ")}`;
}

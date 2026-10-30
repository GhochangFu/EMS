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
 * A call without a `cursor` starts the tool's count again (the model read the
 * list from its first page); a call with one adds its rows. The newest page of
 * a tool decides whether it is left open, so a later page that ends the list
 * closes it.
 */

/** One tool's paged reads in a turn. */
export type PagedRead = { readonly read: number; readonly total: number | null; readonly open: boolean };

/** The paged reads of one turn, by tool name. */
export type PagedReads = Map<string, PagedRead>;

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

/** Notes one successful tool result; a result with no `nextCursor` key is not a paged read and is ignored. */
export function notePagedRead(reads: PagedReads, tool: string, args: unknown, result: unknown): void {
  if (typeof result !== "object" || result === null || !("nextCursor" in result)) return;
  const page = result as Record<string, unknown>;
  const entries = Array.isArray(page.organizations)
    ? page.organizations.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    : [];
  const rows = entries.reduce((n, entry) => n + (Array.isArray(entry.items) ? entry.items.reduce((m: number, item) => m + rowsOf(item), 0) : 0), 0);
  const resumed = typeof args === "object" && args !== null && (args as { cursor?: unknown }).cursor !== undefined;
  const before = resumed ? reads.get(tool) : undefined;
  reads.set(tool, {
    read: (before?.read ?? 0) + rows,
    total: totalOf(page, entries) ?? before?.total ?? null,
    open: page.nextCursor !== null && page.nextCursor !== undefined,
  });
}

/** The fixed sentence for one tool left open. */
export function partialSentence(tool: string, read: PagedRead): string {
  const noun = NOUN_OF[tool] ?? "rows";
  return read.total !== null && read.total > read.read
    ? `This answer is partial: it read ${read.read} of ${read.total} ${noun}.`
    : `This answer is partial: it read ${read.read} ${noun} from ${tool}, and more were not read.`;
}

/** The reply, with one partial sentence appended per tool left open. Never replaces. */
export function withPartialNote(reply: string, reads: PagedReads): string {
  const sentences = [...reads].filter(([, read]) => read.open).map(([tool, read]) => partialSentence(tool, read));
  return sentences.length === 0 ? reply : `${reply.trimEnd()} ${sentences.join(" ")}`;
}

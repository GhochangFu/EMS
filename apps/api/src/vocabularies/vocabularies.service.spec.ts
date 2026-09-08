import { BadRequestException } from "@nestjs/common";

import type { BmsDb } from "@bms/db";

import { MAX_ECHOED_CELL_CHARS } from "../admin/spreadsheet-guard";
import { VocabulariesService } from "./vocabularies.service";

/**
 * `F4.104` (owner ruling 5, second rider) — the echo surface in
 * `unknownCodeMessage`.
 *
 * **Why this file is not an integration spec.** The sibling
 * `vocabularies.service.integration.spec.ts` needs `DATABASE_URL`, so an
 * assertion placed there gates only when the URL is set — and what is under
 * test here is string formatting, not a query. The two `select` chains
 * `assertAssetDomain` and `unknownCodeMessage` run are stood in for by the
 * narrowest object that satisfies them, in the idiom of
 * `onboarding-commit-caps.spec.ts:73–86`. Nothing here asserts anything about
 * Drizzle, and the ordering and active/inactive properties stay where they
 * belong, against real rows.
 *
 * **What the fix is, and what it is not.** The comment this replaces claimed
 * "the length is already bounded at 64 by the request schema". Every one of the
 * ten call sites does arrive bounded at 64, so no unbounded value was ever
 * echoed — but by four different routes, and three of them are not a request
 * schema at all. The cut asserted below removes the dependency rather than
 * closing a hole; see the source comment for the census.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The live codes the refusal lists back. Two, so the `, ` join is exercised. */
const LIVE_CODES = [{ code: "electrical" }, { code: "hvac" }] as const;

/**
 * The two chains `assertAssetDomain` reaches, and nothing else.
 *
 * `limit()` answers `[]` so the `!row` branch is the one taken — the branch
 * that builds the message. `orderBy()` answers the live codes, so the
 * *Expected one of* tail is non-empty and the string has production's shape;
 * an empty tail would leave the byte-exact case asserting a sentence no caller
 * can ever receive.
 */
function stubDb(): BmsDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([]),
    orderBy: () => Promise.resolve(LIVE_CODES.map((row) => ({ code: row.code }))),
  };
  return { select: () => chain } as unknown as BmsDb;
}

/** The refusal `assertAssetDomain` throws for a code that names no row. */
async function refusalFor(code: string): Promise<string> {
  const service = new VocabulariesService(stubDb());
  try {
    await service.assertAssetDomain(code);
  } catch (err) {
    assert(
      err instanceof BadRequestException,
      `assertAssetDomain must refuse with a BadRequestException, got ${String(err)}`,
    );
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("assertAssetDomain must refuse a code with no matching row");
}

/**
 * An over-long code is cut; a short one is unchanged, byte for byte.
 *
 * The two halves are one case on purpose. A cut asserted alone passes just as
 * well against a message that truncates every code, which would break the four
 * assertions elsewhere in the repo that read this sentence:
 * `asset-templates-stock.integration.spec.ts:317` matches
 * `domain "f213-not-a-domain" is not a live value` as a regular expression,
 * `:321` matches the *Expected one of* tail, and
 * `vocabularies.service.integration.spec.ts:85`/`:197` read a live code out of
 * that same tail.
 */
export async function assertUnknownCodeEchoIsBounded(): Promise<void> {
  // Non-vacuity anchor, in the idiom of `onboarding-excel.service.spec.ts:673`.
  // A fixture at or under the bound leaves the cut with nothing to do and every
  // assertion below passes while proving nothing. 32,767 is Excel's per-cell
  // maximum — the size the workbook producer can reach.
  const overlong = "x".repeat(32_767);
  assert(
    overlong.length > MAX_ECHOED_CELL_CHARS,
    `this case is the cut, and it needs a code longer than ${MAX_ECHOED_CELL_CHARS}, ` +
      `got ${overlong.length}`,
  );

  const cut = await refusalFor(overlong);

  // Three assertions, because any one alone is weak. The length bound alone
  // would pass against a message that dropped the code entirely; the marker
  // alone would pass against a message that cut and then appended the rest.
  assert(
    cut.length < 200,
    `the refusal for a ${overlong.length}-character code must stay short, got ${cut.length} characters`,
  );
  assert(
    cut.includes(`domain "${"x".repeat(MAX_ECHOED_CELL_CHARS)}…"`),
    `expected the echoed code cut to ${MAX_ECHOED_CELL_CHARS} characters with an ellipsis, got: ${cut}`,
  );
  assert(
    !cut.includes("x".repeat(MAX_ECHOED_CELL_CHARS + 1)),
    "the refusal must not carry a run of cell text longer than the echo bound",
  );
  // The cut bounds the code, never the list the caller needs to repair it.
  assert(
    cut.endsWith("is not a live value. Expected one of: electrical, hvac."),
    `expected the live-code tail to survive the cut, got: ${cut}`,
  );

  // The byte-exact half. `f213-not-a-domain` is the literal
  // `asset-templates-stock.integration.spec.ts:59` refuses through this method,
  // so this is that assertion's own value and not a paraphrase of it.
  const short = await refusalFor("f213-not-a-domain");
  assert(
    short === 'domain "f213-not-a-domain" is not a live value. Expected one of: electrical, hvac.',
    `a code under the bound must format exactly as it always has, got: ${short}`,
  );

  // §4.3's control-character strip is the sibling guard, and the cut sits after
  // it. Asserted here so a later edit cannot swap one for the other: a message
  // that is short and still carries a line break is the log-injection failure
  // the strip exists to prevent.
  const injected = await refusalFor("bad\ncode\r\nlive");
  assert(
    !injected.includes("\n") && !injected.includes("\r"),
    `the refusal must carry no line break, got: ${JSON.stringify(injected)}`,
  );
  assert(
    injected.includes('domain "badcodelive"'),
    `expected the stripped code to be echoed whole, got: ${injected}`,
  );
}

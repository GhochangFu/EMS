// `reflect-metadata` first, and before `OnboardingCatalogService` is imported:
// that class carries `@Inject(FLEET_DRIZZLE)` on a constructor parameter, and
// the decorator calls `Reflect.defineMetadata` at module-evaluation time.
// Without the polyfill the import itself throws, not the construction.
import "reflect-metadata";

import type { BmsDb } from "@bms/db";
import { ONBOARDING_DRAFT_STRING_MAX } from "@bms/shared";

import { MAX_ECHOED_ITEMS } from "../spreadsheet-guard";
import { OnboardingCatalogService } from "./onboarding-catalog.service";
import type { OrgPointKeySummary } from "./onboarding-catalog.service";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** What the live seeded database holds today, read as `bms_fleet`: 613 rows, 18,006 characters of code + name. */
const SEEDED_POINT_KEYS = 613;

/**
 * How many keys one commit may add on top of the seed. `F4.103`'s
 * `MAX_ONBOARDING_POINT_KEYS`, restated here because this fixture is about the
 * *catalog* the commit leaves behind, not about the draft that carried it.
 */
const KEYS_ONE_COMMIT_MAY_ADD = 500;

/**
 * A catalog row. `atBound` puts `code` and `name` at their `F4.104` maxima, so
 * the 500 an attacker-shaped commit adds are as long as the schema allows.
 */
function catalogKey(index: number, atBound: boolean): OrgPointKeySummary {
  const tag = `pk-${String(index).padStart(4, "0")}-`;
  return {
    code: atBound
      ? `${tag}${"c".repeat(ONBOARDING_DRAFT_STRING_MAX["pointKeys.code"] - tag.length)}`
      : `${tag}code`,
    name: atBound
      ? `${tag}${"n".repeat(ONBOARDING_DRAFT_STRING_MAX["pointKeys.name"] - tag.length)}`
      : `${tag}name`,
    unit: "kW",
    domain: "electrical",
  };
}

/**
 * `F4.105` **site 6** — the sixth of the six list sites the count bound binds,
 * and the biggest of them. The other five are in the post-upload summary and
 * are asserted in `onboarding-chat-summary-caps.spec.ts`, whose docblock holds
 * the enumeration; this one is a different service and a later turn, so its
 * fixture lives here.
 *
 * `formatPointKeysForChat` renders one bullet per catalog row into the "use
 * existing keys" turn of `handleRuleBasedTurn`, which `OnboardingService.chat`
 * persists to `onboarding_sessions.messages`.
 *
 * **This row's first pass left it uncapped on a rationale that was false on
 * both of its clauses**, and owner ruling 6 closed it:
 *
 * - "the organisation's own catalog" — `listPointKeys` ignores its
 *   `organizationId`; the catalog went fleet-wide at migration `0057` (`F3.39`)
 *   and every organisation reads every code;
 * - "the upload does not control its length" — `OnboardingCommitService`
 *   inserts into that same fleet-wide `bms.point_keys` at `organization_admin`
 *   with no per-organisation quota, so one commit of a 500-key draft grows this
 *   message permanently, for everyone.
 *
 * **The fixture is the seed plus what one commit may add.** 613 seeded keys is
 * ~26 KB on its own with no attacker — about twice what the other five caps
 * bring the whole worst-case import summary down to — and 500 more at
 * `ONBOARDING_DRAFT_STRING_MAX` is ~213,500 characters (~208 KiB).
 *
 * **The bullet count is what is asserted, not the message length.** A
 * length-only ceiling stays green under a mutation of `MAX_ECHOED_ITEMS`
 * itself, and these rows are long enough that almost any small count fits under
 * any plausible ceiling. The length assertion is kept as a second, derived
 * check.
 *
 * **The cap bounds the echo, not the growth.** An unbounded, unquota'd
 * fleet-wide catalog is still open after this row: this turn stops growing, the
 * table does not, and every other reader of `bms.point_keys` still sees it.
 *
 * The construction takes no database — `formatPointKeysForChat` is a pure
 * formatter, and every other method on this service is the part that reads.
 */
export function assertPointKeyCatalogListIsCapped(): void {
  const catalog = new OnboardingCatalogService(undefined as unknown as BmsDb);
  const keys = [
    ...Array.from({ length: SEEDED_POINT_KEYS }, (_, index) => catalogKey(index, false)),
    ...Array.from({ length: KEYS_ONE_COMMIT_MAY_ADD }, (_, index) =>
      catalogKey(SEEDED_POINT_KEYS + index, true),
    ),
  ];
  const rendered = catalog.formatPointKeysForChat(keys);
  const lines = rendered.split("\n");

  const bullets = lines.filter((line) => line.startsWith("- **"));
  assert(
    bullets.length === MAX_ECHOED_ITEMS,
    `${keys.length} catalog keys render ${MAX_ECHOED_ITEMS} bullets, got ${bullets.length}`,
  );

  // Exactly one tail, and it is the last line — a plain line, not a bullet, so
  // it cannot be read as one more key.
  const tails = lines.filter((line) => line.startsWith("…and "));
  assert(tails.length === 1, `the list closes with exactly one tail, got ${tails.length}`);
  assert(
    // Derived from the fixture, never a literal: the seed grows and the cap may
    // move, and neither may leave this assertion describing an older message.
    tails[0] === `…and ${keys.length - MAX_ECHOED_ITEMS} more`,
    `the tail states what was left out, got "${tails[0]}"`,
  );
  assert(
    lines[lines.length - 1] === tails[0],
    `the tail is the last line, got "${lines[lines.length - 1]}"`,
  );

  for (const [index, key] of keys.entries()) {
    assert(
      rendered.includes(key.code) === index < MAX_ECHOED_ITEMS,
      `key ${index} must be ${index < MAX_ECHOED_ITEMS ? "rendered" : "omitted"}, and it is not`,
    );
  }

  // Arithmetic, so the ceiling is not invented: a bullet at the bound is
  // `- **` + 128 + `** (` + 255 + `, kW)` ≈ 396 characters, so 25 of them plus
  // the tail is ~10 KB.
  assert(
    rendered.length < 12_000,
    `the catalog turn must stay under 12,000 characters, got ${rendered.length}`,
  );

  // An empty catalog still says so, and a list under the bound gains no tail.
  // The "use existing keys" turn is only reached when the catalog is non-empty,
  // so the empty branch is the one above the cap rather than dead code.
  assert(
    catalog.formatPointKeysForChat([]) === "No point keys exist in this organization yet.",
    "an empty catalog is answered in words, not with an empty list",
  );
  const few = catalog.formatPointKeysForChat(
    Array.from({ length: MAX_ECHOED_ITEMS }, (_, index) => catalogKey(index, false)),
  );
  assert(!few.includes("…"), `a catalog at the bound is rendered whole and unmarked, got "${few}"`);
}

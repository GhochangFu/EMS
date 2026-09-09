import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const composePath = join(repoRoot, "docker-compose.yml");

/**
 * ADR 0041 (`F3.8`) — the three things about notification configuration that
 * only a repo invariant can hold.
 *
 * All three are about **what the committed stack must NOT say**, which is the kind
 * of requirement that decays silently: nothing fails, nothing warns, and the
 * default is discovered a year later by whoever wonders where the alarm emails
 * went. `tests/repo-invariants.test.ts` is the model for this file.
 */
describe("ADR 0041 — notification configuration stays undefaulted", () => {
  it("gives SMTP_HOST no default in docker-compose.yml (decision 12)", () => {
    // Decision 12 keeps Mailpit in its own `mail` profile with no SMTP_HOST on
    // the api service. A default here — even one pointing at Mailpit — would
    // mean a deployment that forgot to configure SMTP delivers every alarm
    // into a test catcher, silently, with no error anywhere and a readiness
    // route reporting "configured". The whole point of decision 5 is that an
    // unconfigured transport is VISIBLE.
    //
    // If this fails because someone added Mailpit's host for local
    // convenience: set SMTP_HOST in your own environment or `.env` instead.
    // That is the documented way and it does not travel to a pilot host.
    const compose = readFileSync(composePath, "utf8");
    expect(compose).not.toMatch(/^\s*(-\s*)?SMTP_HOST\s*[:=]/m);
  });

  it("never enables NOTIFY_WEBHOOK_ALLOW_INSECURE in docker-compose.yml (decision 6)", () => {
    // That flag disables the https-only half of the webhook egress guard. It is
    // a local-development escape hatch, and a committed stack must not carry
    // it at all — not set to false, not commented in as a suggestion. The
    // guard's other half, the resolved-address check, still applies either way,
    // but plaintext POSTs of alarm content are not something a shared file
    // should be able to turn on.
    const compose = readFileSync(composePath, "utf8");
    expect(compose).not.toMatch(/NOTIFY_WEBHOOK_ALLOW_INSECURE/);
  });

  it("keeps Mailpit out of the core profile (decision 12)", () => {
    // A mail catcher in `core` would come up for everyone who runs the stack,
    // and the next step after "it is already running" is a default SMTP_HOST
    // pointing at it. This is the same invariant as the first one, one move
    // earlier.
    const compose = readFileSync(composePath, "utf8");
    const mailpit = /^\s{2}mailpit:\s*$/m.exec(compose);
    if (mailpit === null) return; // not added yet — the other two still hold
    const after = compose.slice(mailpit.index);
    const profiles = /profiles:\s*\[([^\]]*)\]/.exec(after);
    expect(profiles, "the mailpit service must declare a profiles list").not.toBeNull();
    expect(profiles?.[1] ?? "").not.toMatch(/core/);
  });
});

const CONTRACT_REL = "packages/shared/src/contracts/notifications.ts";
const DRIZZLE_REL = join("packages", "db", "drizzle");
const CONSTRAINT = "notification_deliveries_status_check";

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** SQL line comments, removed so a header that quotes the CHECK is never parsed as one. */
const withoutComments = (sql: string): string => sql.replace(/^[ \t]*--.*$/gm, "");

/**
 * The statuses the contract declares, parsed from source rather than imported.
 *
 * The technique `tests/f3.35-table-widget-schema.test.ts` uses, for its reason:
 * a source scan states plainly that this is a cross-file drift gate rather than
 * a use of the value. Throwing rather than returning `[]` is load-bearing — an
 * empty list would compare `[]` to `[]` the moment the declaration is renamed,
 * and the gate would go green having read nothing.
 */
const declaredStatuses = (): string[] => {
  const block = /export const notificationDeliveryStatusSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(
    read(CONTRACT_REL),
  );
  if (block === null) {
    throw new Error(
      `could not find notificationDeliveryStatusSchema's z.enum([...]) in ${CONTRACT_REL}. If ` +
        "it was renamed or reshaped, fix this parser — do not delete the assertion, because " +
        `that enum and ${CONSTRAINT} are two declarations of one vocabulary.`,
    );
  }
  const statuses = (block[1] ?? "")
    .split(",")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"));
  if (statuses.length === 0) throw new Error("notificationDeliveryStatusSchema parsed to empty");
  return statuses;
};

/**
 * The statuses the newest migration to declare the CHECK admits.
 *
 * **Newest, not `0038`.** A widening is a new file — `0038` is committed and
 * frozen, and the pre-commit hook blocks editing it — so the effective
 * vocabulary is the last declaration in filename order, and reading `0038` by
 * name would pin this gate to a list no database has carried since `0068`. The
 * same regex matches both the inline `CREATE TABLE` form `0038` uses and the
 * `ALTER TABLE ... ADD CONSTRAINT` form a widening uses; `DROP CONSTRAINT IF
 * EXISTS <name>` does not match it, because `IF EXISTS` stands between the
 * keyword and the name.
 */
const checkedStatuses = (): { file: string; values: string[] } => {
  const dir = join(repoRoot, DRIZZLE_REL);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse();
  const pattern = new RegExp(`CONSTRAINT\\s+${CONSTRAINT}\\s+CHECK\\s*\\(status IN \\(([^)]*)\\)\\)`);
  for (const file of files) {
    const match = pattern.exec(withoutComments(read(join(DRIZZLE_REL, file))));
    if (match === null) continue;
    const values = (match[1] ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    if (values.length === 0) throw new Error(`${file} declares ${CONSTRAINT} with an empty list`);
    return { file, values };
  }
  throw new Error(
    `no migration in ${DRIZZLE_REL} declares ${CONSTRAINT}'s IN list in a shape this parser ` +
      "reads. Fix the parser rather than the assertion.",
  );
};

/**
 * ADR 0041 Amendment 6 (`F3.52`) — the delivery status set is declared twice,
 * and only a repo invariant compares the two declarations.
 *
 * **The failure this exists to catch is invisible to the compiler.** The enum is
 * the only one of the two declarations TypeScript sees; the other is SQL text in
 * a migration. A value added here with no migration therefore typechecks, and
 * fails for the first time as `new row ... violates check constraint
 * "notification_deliveries_status_check"` on the insert that records the new
 * outcome — measured against the running stack while this gate was written — in
 * production, on the dispatch path, surfacing as a 500. That is the `F4.43`
 * failure: a value one declaration offers that the other refuses.
 * `tests/f3.35-table-widget-schema.test.ts` holds the same shape for the widget
 * vocabulary.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6), the way this file's other three invariants are written.
 */
describe("ADR 0041 Amendment 6 — the delivery status vocabulary is declared twice", () => {
  it("declares the same statuses in the contract enum and the newest CHECK", () => {
    const declared = declaredStatuses();
    const checked = checkedStatuses();

    expect(declared.length, "the contract enum must not parse to an empty list").toBeGreaterThan(0);
    expect(
      [...checked.values].sort(),
      `${CONTRACT_REL} and ${join(DRIZZLE_REL, checked.file)} must admit the same statuses`,
    ).toEqual([...declared].sort());

    // Amendment 6 ruling 5 names the sixth value, so both sides are pinned to it
    // rather than only to each other: two declarations reverted together would
    // still satisfy the equality above.
    expect(declared, "Amendment 6 ruling 5 adds `skipped_stale`").toContain("skipped_stale");
    expect(checked.values, "the CHECK must admit `skipped_stale`").toContain("skipped_stale");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const composePath = join(repoRoot, "docker-compose.yml");

/**
 * ADR 0041 (`F3.8`) — the two things about notification configuration that
 * only a repo invariant can hold.
 *
 * Both are about **what the committed stack must NOT say**, which is the kind
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

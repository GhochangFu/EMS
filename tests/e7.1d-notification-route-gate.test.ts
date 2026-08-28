import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appPath = join(repoRoot, "apps/web/src/app.tsx");

/**
 * `E7.1d` — the two `F3.8` routes keep their role gate (ADR 0043 Consequences).
 *
 * `AdminRoute` refuses a `location_admin` only when the route asks it to, and
 * `apps/web/src/components/admin-route.spec.tsx` proves the branch works.
 * Nothing proves the routes still ASK. Delete `requireNotificationAdmin` from
 * `app.tsx` and the whole suite stays green while both screens go back to
 * being reachable by URL — `ChannelsService.list` returns `[]` for that role,
 * so the refusal renders as "No channels yet" and reads like an empty tenant
 * rather than a denial.
 *
 * This lives beside `tests/repo-invariants.test.ts` rather than inside it
 * because that file is at the §4.5 1000-line cap; `tests/adr-0041-…` and
 * `tests/e7.1c-…` are the precedent for a scoped invariant of its own.
 */
describe("E7.1d — the F3.8 notification routes stay gated", () => {
  it("wraps both notification pages in an AdminRoute that requires the gate", () => {
    // Each page is matched against ITS OWN nearest `<AdminRoute` opening tag,
    // never against the file as a whole: a file-wide search for the prop stays
    // green with one route gated and the other not, which is the `F4.38` decoy
    // shape — one correct occurrence satisfying a check meant for all of them.
    const source = readFileSync(appPath, "utf8");
    const ungated: string[] = [];

    for (const page of ["NotificationChannelsPage", "NotificationDeliveriesPage"]) {
      const used = source.indexOf(`<${page} `);
      const opener = used < 0 ? -1 : source.lastIndexOf("<AdminRoute", used);
      if (used < 0 || opener < 0) {
        ungated.push(`${page}: no <AdminRoute wrapper found`);
        continue;
      }
      const tag = source.slice(opener, source.indexOf(">", opener) + 1);
      if (!tag.includes("requireNotificationAdmin")) {
        ungated.push(`${page}: ${tag.replace(/\s+/g, " ").trim()}`);
      }
    }

    expect(
      ungated,
      "notification routes missing requireNotificationAdmin (E7.1d, ADR 0043): " +
        ungated.join(" | "),
    ).toEqual([]);
  });

  it("keeps the prop meaningful — AdminRoute still acts on it", () => {
    // The other half of the same removal: leaving the prop on both routes but
    // deleting the branch that reads it. `admin-route.spec.tsx` is the real
    // gate on that, and this only fails loudly if the prop stops existing at
    // all, so that a rename lands here rather than silently disabling both.
    const guard = readFileSync(join(repoRoot, "apps/web/src/components/admin-route.tsx"), "utf8");
    expect(guard).toContain("requireNotificationAdmin");
    expect(guard).toContain("canManageNotificationChannels");
  });
});

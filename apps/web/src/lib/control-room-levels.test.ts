import { describe, it } from "vitest";

import { runC1, runC2, runC3, runC4, runC5, runC6, runL1, runL2, runL3, runL4, runL5, runL6, runL7, runL8 } from "./control-room-levels.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("control-room-levels", () => {
  it("L1 — two organizations land on the organizations list", () => {
    runL1();
  });

  it("L2 — one organization with two sites skips to the organization", () => {
    runL2();
  });

  it("L3 — one organization with one site skips to the site", () => {
    runL3();
  });

  it("L4 — an empty list is the empty target", () => {
    runL4();
  });

  it("L5 — an organization with two sites does not skip the organization level", () => {
    runL5();
  });

  it("L6 — an organization with one site skips to the site", () => {
    runL6();
  });

  it("L7 — an organization id outside the list resolves to empty", () => {
    runL7();
  });

  it("L8 — the organization card totals sitesOnline from the fresh sites only", () => {
    runL8();
  });

  it("C1 — the root crumb is never omitted", () => {
    runC1();
  });

  it("C2 — the organization crumb renders when the organization level was not skipped", () => {
    runC2();
  });

  it("C3 — a skipped organization level always omits its crumb", () => {
    runC3();
  });

  it("C4 — a skipped organization and site level leave one crumb", () => {
    runC4();
  });

  it("C5 — a one-site organization among several gives the root and the site crumb", () => {
    runC5();
  });

  it("C6 — a two-site organization among several gives three crumbs, the organization linked", () => {
    runC6();
  });
});

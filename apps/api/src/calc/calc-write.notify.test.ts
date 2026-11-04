import { describe, it } from "vitest";

import { aDefaultWriteNotifies, notifyFalseIssuesNoNotify } from "./calc-write.notify.spec";

/** `F4.311` PR 5 review — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — CalcWriteService's NOTIFY is switchable", () => {
  it("notifies a default write", () => aDefaultWriteNotifies());
  it("issues no pg_notify for { notify: false }", () => notifyFalseIssuesNoNotify());
});

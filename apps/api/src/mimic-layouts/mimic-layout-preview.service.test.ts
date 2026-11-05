import { describe, it } from "vitest";

import * as spec from "./mimic-layout-preview.service.spec";

/** `F4.308` (plan T3, C2) — Vitest entry point for the preview's check order. Assertions in the `.spec` (ADR 0014). */
describe("F4.308 — MimicLayoutPreviewService check order", () => {
  it("S1 an unreadable layout is the 404, and nothing else runs", spec.unreadableLayoutIs404First);
  it("S2 a group outside the layout's organization is a 404 before the writer check", spec.missingGroupIs404BeforeTheWriterCheck);
  it("S3 a non-writer is the 403 after the group check", spec.nonWriterIs403AfterTheGroup);
  it("S4 a writer runs the five steps in order", spec.writerRunsTheFiveStepsInOrder);
  it("S5 a layout the resolver skips is the same 404", spec.resolverSkippedLayoutIsTheSame404);
  it("S6 a group outside the caller's readable locations is the same 404", spec.groupOutsideTheCallersLocationsIs404);
});

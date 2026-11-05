import { expect } from "vitest";
import type { z } from "zod";

import { putMimicLayoutBodySchema } from "../contracts/mimic-layout-writes";
import type { mimicLayoutNodeSchema } from "../contracts/mimic-layouts";
import { MIMIC_LAYOUT_BODY_GUIDE } from "./catalog/mimic-layouts";
import { writeNodeOfDto } from "./mimic-layout-write-node";

/**
 * `F4.307` T3 (ADR 0081 Amendment 1, plan C8, owner ruling Q3 (a)) — the copilot's layout write
 * carries a unit's point list, so a replace built from `get_mimic_layout` round-trips whole and
 * cannot clear a stored list by accident (F3.87 D9). Vitest entry point: the sibling `.test.ts`.
 */

type MimicLayoutNodeDto = z.infer<typeof mimicLayoutNodeSchema>;

const unit = (pointKeys: string[]): MimicLayoutNodeDto => ({
  key: "pump_1",
  kind: "unit",
  symbol: "pump",
  label: "Pump 1",
  roleCode: "raw-water-pump",
  tone: null,
  x: 0,
  y: 0,
  w: 20,
  h: 25,
  z: 10,
  fanOut: false,
  isSource: false,
  isSwitching: false,
  pointKeys,
});

export function aStoredListIsCarriedInOrder(): void {
  expect(writeNodeOfDto(unit(["kw", "flow"])).pointKeys).toEqual(["kw", "flow"]);
}

/** `[]` stays `[]`, not absent — the flags' rule: a value that agrees with the default is still sent. */
export function anEmptyListIsCarriedAsEmpty(): void {
  const node = writeNodeOfDto(unit([]));
  expect(Object.keys(node)).toContain("pointKeys");
  expect(node.pointKeys).toEqual([]);
}

/** The write node of a stored panel parses as a PUT node: `[]` on a panel says nothing. */
export function aPanelsWriteNodeParses(): void {
  const panel: MimicLayoutNodeDto = {
    ...unit([]),
    key: "pre",
    kind: "panel",
    symbol: null,
    roleCode: null,
    tone: "info",
  };
  const body = {
    version: 1,
    name: "L",
    slug: "l",
    canvasW: 120,
    canvasH: 80,
    nodes: [writeNodeOfDto(unit(["kw"])), writeNodeOfDto(panel)],
    pipes: [],
  };
  const parsed = putMimicLayoutBodySchema.safeParse(body);
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
}

export function theBodyGuideNamesPointKeys(): void {
  expect(MIMIC_LAYOUT_BODY_GUIDE).toContain("pointKeys");
  // Positive control: the same guide names a field the write node already had.
  expect(MIMIC_LAYOUT_BODY_GUIDE).toContain("isSwitching");
}

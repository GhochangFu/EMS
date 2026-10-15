import type { MimicLayoutWriteNode } from "../contracts/mimic-layout-writes";
import type { z } from "zod";
import type { mimicLayoutNodeSchema } from "../contracts/mimic-layouts";

type MimicLayoutNodeDto = z.infer<typeof mimicLayoutNodeSchema>;

/**
 * `F3.87` PR 2 (ADR 0099 Amendment 3 A2, drafter decision D9) — a stored
 * node in the write body's shape, so a layout the copilot read
 * (`get_mimic_layout`) can be sent back whole by a replace without losing a
 * field. A `null` becomes absent; `z` and the three flags are kept (an absent
 * flag on a replace clears a stored one, so a `false` must stay `false`, not
 * vanish into a default that happens to agree). The replace card's node diff
 * (PR 5) reads nodes through the same function.
 */
export function writeNodeOfDto(node: MimicLayoutNodeDto): MimicLayoutWriteNode {
  return {
    key: node.key,
    kind: node.kind,
    ...(node.symbol !== null ? { symbol: node.symbol } : {}),
    label: node.label,
    ...(node.roleCode !== null ? { roleCode: node.roleCode } : {}),
    ...(node.tone !== null ? { tone: node.tone } : {}),
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    z: node.z,
    fanOut: node.fanOut,
    isSource: node.isSource,
    isSwitching: node.isSwitching,
  };
}

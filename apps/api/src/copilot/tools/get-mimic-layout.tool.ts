import { ForbiddenException, NotFoundException } from "@nestjs/common";

import { mimicLayoutDtoSchema, type MimicLayoutWriteNode, type MimicLayoutWritePipe } from "@bms/shared";
import { writeNodeOfDto } from "@bms/shared/copilot";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { TOOL_RESULT_MAX_CHARS } from "../../llm/tool-result";
import { defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE } from "./copilot-tool-scope";

/**
 * The JSON budget of one page's nodes and pipes. Below `TOOL_RESULT_MAX_CHARS`
 * by the room the layout header and the turn's own wrapping take, so a page
 * never reaches the model cut mid-node.
 */
export const MIMIC_LAYOUT_PAGE_BUDGET = TOOL_RESULT_MAX_CHARS - 1_500;

type PageItem = { readonly node: MimicLayoutWriteNode } | { readonly pipe: MimicLayoutWritePipe };

/**
 * The pages of a layout's items (nodes first, then pipes), each as many items
 * as fit in the budget and at least one. Recomputed on each call from the
 * same layout, so page `n` is the same slice every time.
 */
export function mimicLayoutPages(nodes: readonly MimicLayoutWriteNode[], pipes: readonly MimicLayoutWritePipe[]): PageItem[][] {
  const items: PageItem[] = [...nodes.map((node) => ({ node })), ...pipes.map((pipe) => ({ pipe }))];
  const pages: PageItem[][] = [];
  let page: PageItem[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = JSON.stringify(item).length + 1;
    if (page.length > 0 && size + itemSize > MIMIC_LAYOUT_PAGE_BUDGET) {
      pages.push(page);
      page = [];
      size = 0;
    }
    page.push(item);
    size += itemSize;
  }
  if (page.length > 0 || pages.length === 0) pages.push(page);
  return pages;
}

/**
 * `get_mimic_layout` (`F3.87` PR 2, ADR 0099 Amendment 3 drafter choice 1,
 * plan D9) — one layout through `MimicLayoutsService.get` (the caller's own
 * read scope), then the turn's organization check. The nodes come back in the
 * **write** shape with every field (`tone`, `z`, the three flags), so a replace
 * built from what the model read sends the layout back unchanged; a large
 * layout comes in pages (`nextPage`), never cut.
 */
export const getMimicLayoutTool = defineReadTool({
  name: "get_mimic_layout",
  description:
    "Read one mimic layout by id: its header, and its nodes and pipes in the write shape a replace sends back. " +
    "A large layout comes in pages: call again with page = nextPage until nextPage is null, and keep every node.",
  schema: z.object({ id: z.string().uuid(), page: z.number().int().min(0).max(1_000).optional() }).strict(),
  async run({ layouts }, args, ctx) {
    let stored;
    try {
      stored = await layouts.get(ctx.user, args.id);
    } catch (error) {
      // The service's own refusals (not readable, not found) are the one refusal; anything else
      // (a database failure) is the tool's error, never "out of scope".
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
      }
      throw error;
    }
    const layout = parseStoredContract(mimicLayoutDtoSchema, stored, "copilot_tools.get_mimic_layout.layout");
    if (!ctx.allowedOrganizationIds.includes(layout.organizationId)) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
    const pages = mimicLayoutPages(layout.nodes.map(writeNodeOfDto), layout.pipes);
    const index = args.page ?? 0;
    const page = pages[index];
    if (page === undefined) return { ok: false, error: `This layout has ${pages.length} page(s); page ${index} does not exist.` };
    return {
      ok: true,
      result: {
        layout: {
          id: layout.id,
          name: layout.name,
          slug: layout.slug,
          organizationId: layout.organizationId,
          version: layout.version,
          canvasW: layout.canvasW,
          canvasH: layout.canvasH,
          symbolLibraries: layout.symbolLibraries,
        },
        nodes: page.flatMap((item) => ("node" in item ? [item.node] : [])),
        pipes: page.flatMap((item) => ("pipe" in item ? [item.pipe] : [])),
        page: index,
        nextPage: index + 1 < pages.length ? index + 1 : null,
        nodeCount: layout.nodes.length,
        pipeCount: layout.pipes.length,
      },
      organizationIds: [layout.organizationId],
    };
  },
});

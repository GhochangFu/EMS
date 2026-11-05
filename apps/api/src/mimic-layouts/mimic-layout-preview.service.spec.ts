import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import type { DashboardMimicNodesResponseDto, JwtPayload } from "@bms/shared";

import { MimicLayoutPreviewService } from "./mimic-layout-preview.service";

/**
 * `F4.308` (plan T3, C2) — `MimicLayoutPreviewService.preview`'s check order over stubs, no
 * database: (1) the readable layout → 404; (2) the group in the layout's organization → 404;
 * (3) the authoring gate → 403; (4) `readableAssetIds`; (5) the resolver. Every case records the
 * steps that ran, so a check that moved, or ran after a refusal, is a different list. The SQL of
 * step 2 and the real roles are `mimic-layout-preview.integration.spec.ts`'s (Postgres).
 */

const OPERATOR: JwtPayload = { sub: "u1", email: "op@bms.local", name: "Op", role: "operator" };
const ORG = "11111111-1111-4111-8111-111111111111";
const LAYOUT = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const READABLE = ["44444444-4444-4444-8444-444444444444"];

const answerWith = (widgets: DashboardMimicNodesResponseDto["widgets"]): DashboardMimicNodesResponseDto => ({
  dashboardId: LAYOUT,
  resolvedAt: "2026-11-05T10:00:00.000Z",
  widgets,
  stateMaps: [],
});
const ONE_WIDGET = answerWith([
  {
    source: "layout",
    widgetId: LAYOUT,
    layoutId: LAYOUT,
    layout: { name: "P", canvasW: 10, canvasH: 10, nodes: [], pipes: [], orgSymbols: [] },
    nodes: [],
  },
]);

interface Options {
  readonly layoutMissing?: boolean;
  readonly groupMissing?: boolean;
  readonly notAWriter?: boolean;
  readonly answer?: DashboardMimicNodesResponseDto;
}

function harness(options: Options = {}): { service: MimicLayoutPreviewService; steps: string[]; calls: Record<string, unknown[]> } {
  const steps: string[] = [];
  const calls: Record<string, unknown[]> = {};
  const record = (step: string, args: unknown[]) => {
    steps.push(step);
    calls[step] = args;
  };
  const tx = {
    execute: async (...args: unknown[]) => {
      record("tenant", args);
      return { rows: [] };
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async (...args: unknown[]) => {
            record("group", args);
            return options.groupMissing ? [] : [{ id: GROUP }];
          },
        }),
      }),
    }),
  };
  const tenantDb = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const layouts = {
    fetchReadable: async (...args: unknown[]) => {
      record("layout", args);
      if (options.layoutMissing) throw new NotFoundException("Mimic layout not found");
      return { id: LAYOUT, organizationId: ORG };
    },
    assertCanAuthor: async (...args: unknown[]) => {
      record("author", args);
      if (options.notAWriter) throw new ForbiddenException("Only an organization admin can draw a plant mimic layout");
      return "user-id";
    },
  };
  const accessControl = {
    readableAssetIds: async (...args: unknown[]) => {
      record("readable", args);
      return READABLE;
    },
  };
  const resolver = {
    readLayoutPreview: async (...args: unknown[]) => {
      record("resolve", args);
      return options.answer ?? ONE_WIDGET;
    },
  };
  const service = new MimicLayoutPreviewService(
    tenantDb as never,
    layouts as never,
    resolver as never,
    accessControl as never,
  );
  return { service, steps, calls };
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the preview to be refused, and it was served");
}

/** S1 — a layout the caller cannot read is the 404, and nothing else runs. */
export async function unreadableLayoutIs404First(): Promise<void> {
  const { service, steps } = harness({ layoutMissing: true });
  const err = await refusal(() => service.preview(OPERATOR, LAYOUT, GROUP));
  expect([err instanceof NotFoundException, (err as Error).message, steps]).toEqual([true, "Mimic layout not found", ["layout"]]);
}

/** S2 — a group missing from the layout's organization is a 404 "Asset group not found" BEFORE the 403 (decision 2). */
export async function missingGroupIs404BeforeTheWriterCheck(): Promise<void> {
  const { service, steps } = harness({ groupMissing: true, notAWriter: true });
  const err = await refusal(() => service.preview(OPERATOR, LAYOUT, GROUP));
  expect([err instanceof NotFoundException, (err as Error).message, steps]).toEqual([
    true,
    "Asset group not found",
    ["layout", "tenant", "group"],
  ]);
}

/** S3 — a non-writer on a readable layout and group is the 403, and neither the readable set nor the resolver runs. */
export async function nonWriterIs403AfterTheGroup(): Promise<void> {
  const { service, steps, calls } = harness({ notAWriter: true });
  const err = await refusal(() => service.preview(OPERATOR, LAYOUT, GROUP));
  expect([err instanceof ForbiddenException, steps, calls.author]).toEqual([
    true,
    ["layout", "tenant", "group", "author"],
    [OPERATOR, ORG],
  ]);
}

/** S4 — a writer: the five steps in order, the resolver handed the layout's organization, the ids and the readable set. */
export async function writerRunsTheFiveStepsInOrder(): Promise<void> {
  const { service, steps, calls } = harness();
  const answer = await service.preview(OPERATOR, LAYOUT, GROUP);
  const [org, layoutId, groupId, readable, nowMs] = calls.resolve ?? [];
  expect({ answer, steps, resolve: [org, layoutId, groupId, readable, typeof nowMs], layout: calls.layout }).toEqual({
    answer: ONE_WIDGET,
    steps: ["layout", "tenant", "group", "author", "readable", "resolve"],
    resolve: [ORG, LAYOUT, GROUP, READABLE, "number"],
    layout: [OPERATOR, LAYOUT],
  });
}

/** S5 — plan C5: a layout the resolver skips (deleted between the check and the read) is the same 404. */
export async function resolverSkippedLayoutIsTheSame404(): Promise<void> {
  const { service } = harness({ answer: answerWith([]) });
  const err = await refusal(() => service.preview(OPERATOR, LAYOUT, GROUP));
  expect([err instanceof NotFoundException, (err as Error).message]).toEqual([true, "Mimic layout not found"]);
}

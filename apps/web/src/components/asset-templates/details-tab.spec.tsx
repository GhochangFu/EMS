import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { adminAssetTemplateDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetTemplateDto, VocabulariesResponse } from "@bms/shared";

import * as templateApi from "../../api/admin/asset-templates";
import * as vocabApi from "../../api/vocabularies";
import { DetailsTab } from "./details-tab";

/**
 * `F2.15` — the Details tab's submit handler is gated on `editable`.
 *
 * Assertions live here; `details-tab.test.tsx` is the Vitest entry point
 * (ADR 0014) and carries `@vitest-environment jsdom` because that is the file
 * Vitest collects (ADR 0042 decision 2).
 *
 * ## Why this case is written the way it is
 *
 * The obvious shape — "render read-only, submit, assert nothing was sent" —
 * **passes whether or not the gate exists.** On a freshly seeded form
 * `buildDetailsPatch` returns `null`, and the pre-existing `!blocked && patch`
 * condition already refuses. The case would be green against a component with
 * no `editable` check at all, which is the opposite of what it claims.
 *
 * So the form is dirtied **while it is still editable**, and only then
 * re-rendered read-only. React keeps component state across a prop change, and
 * the reseed effect keys on `template.id` and `template.status` — neither of
 * which moves here — so `patch` is non-null on the read-only render and the old
 * condition would let the write through. That is what makes the assertion
 * measure the gate rather than the absence of a change.
 *
 * The second half re-enables the tab and submits again. Without it the case
 * could stay green because submission had broken outright rather than because
 * it is gated.
 */

const VOCABULARIES: VocabulariesResponse = {
  ruleCategories: [],
  assetDomains: [{ code: "electrical", label: "Electrical", sortOrder: 10, active: true }],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
} as unknown as VocabulariesResponse;

/**
 * Parsed through the contract schema rather than cast, so a DTO field that
 * changes shape fails here instead of letting the assertions run against an
 * object the API can no longer produce.
 */
const TEMPLATE: AdminAssetTemplateDto = adminAssetTemplateDtoSchema.parse({
  id: "t1",
  organizationId: "o1",
  organizationCode: "IONEX",
  organizationName: "Ion Exchange",
  code: "ELECTRICAL-FEEDER",
  version: 1,
  name: "Feeder",
  assetType: "feeder",
  domain: "electrical",
  description: null,
  status: "draft",
  content: {},
  publishedAt: null,
  archivedAt: null,
  stockCode: null,
  stockVersion: null,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
  points: [],
});

/** The gate's case — see this module's docblock for why each step is here. */
export async function aReadOnlyRenderCannotSubmitEvenWhenTheFormIsDirty(): Promise<void> {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES);
  const save = vi
    .spyOn(templateApi, "updateAdminAssetTemplate")
    .mockResolvedValue(TEMPLATE);

  // One client and one pair of callbacks across every render, so the identical
  // references go into `rerender` and the dirty effect does not re-fire merely
  // because a fresh `vi.fn()` arrived.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  const onDirtyChange = vi.fn();
  const tree = (editable: boolean) => (
    <QueryClientProvider client={queryClient}>
      <DetailsTab
        template={TEMPLATE}
        editable={editable}
        onSaved={onSaved}
        onDirtyChange={onDirtyChange}
      />
    </QueryClientProvider>
  );

  const { container, rerender } = render(tree(true));
  // The vocabulary settles before anything is typed, so the domain select is
  // not still loading when the patch is built.
  await screen.findByRole("option", { name: "Electrical" });

  // **This step is what makes the case non-vacuous.** Typing while the tab is
  // editable is the only way to reach the read-only render with a non-null
  // `patch`; without it `buildDetailsPatch` returns `null` and the pre-existing
  // `!blocked && patch` condition refuses the submit on its own, so the
  // assertion below would hold with or without the `editable` gate.
  await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "X");
  expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("FeederX");
  expect(screen.getByRole("button", { name: "Save details" })).toBeEnabled();

  // The same tree, read-only. Only `editable` moves: `template.id` and
  // `template.status` are untouched, so the reseed effect does not fire and the
  // typed value survives.
  rerender(tree(false));
  expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("FeederX");
  expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();

  const form = container.querySelector("form");
  expect(form).not.toBeNull();

  // `act` because `mutate` defers `mutationFn` — asserting synchronously after
  // `fireEvent.submit` would pass before the mock could have been reached, and
  // would therefore prove nothing about the gate.
  await act(async () => {
    fireEvent.submit(form as HTMLFormElement);
  });
  expect(save).not.toHaveBeenCalled();

  // The other direction: editable again, same dirty form, and the write goes
  // out. Without this half the case could be green because submission broke.
  rerender(tree(true));
  await act(async () => {
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
  });
  await waitFor(() => {
    expect(save).toHaveBeenCalledTimes(1);
  });
  expect(save).toHaveBeenCalledWith(TEMPLATE.id, { name: "FeederX" });
}

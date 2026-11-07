import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

import { draftTemplate, publishedTemplate, renderPage, stubSiteApi } from "./dashboard-template-detail-page.spec";

/**
 * `F4.320` (ADR 0087 Amendment 4 decision 1) — the detail page edits a site template's tabs.
 *
 * Its own file: the page's spec is near the length cap. Assertions live here;
 * `dashboard-template-detail-page.tabs.test.tsx` is the Vitest entry point (ADR 0014).
 */

type SentBody = { content: { widgets: unknown[]; tabs: { key: string; label: string; widgets: { key: string }[] }[] } };

function siteTile(key: string, config: Record<string, unknown> = {}) {
  return { ...publishedTemplate().content.widgets[0]!, bindings: [], key, title: key, config };
}

/** A site draft: an Overview of one tile and an SLD tab of one tile. */
function siteDraft(sldConfig: Record<string, unknown> = {}) {
  return {
    ...draftTemplate(),
    section: "site",
    target: "site",
    content: {
      widgets: [],
      tabs: [
        { key: "overview", label: "Overview", sortOrder: 0, domain: null, widgets: [siteTile("o1")] },
        { key: "sld", label: "SLD", sortOrder: 1, domain: "electrical", widgets: [siteTile("s1", sldConfig)] },
      ],
    },
  };
}

/** Save canvas, then Next past Basics and Content to Review. */
async function openSaveReview(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Save canvas" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** Save sends the renamed tab in `content.tabs`, with every tab's widgets. */
export async function saveSendsTheRenamedTab(): Promise<void> {
  const calls: SentBody[] = [];
  stubSiteApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(siteDraft()),
    updateAdminDashboardTemplate: (_id: string, input: SentBody) => {
      calls.push(input);
      return Promise.resolve(siteDraft());
    },
  });
  renderPage();

  await userEvent.click(await screen.findByRole("tab", { name: "SLD" }));
  const label = screen.getByLabelText("Tab label");
  await userEvent.clear(label);
  await userEvent.type(label, "Single line");
  await openSaveReview();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(calls).toHaveLength(1));
  const sent = calls[0]!.content.tabs;
  expect(sent.map((tab) => tab.label)).toEqual(["Overview", "Single line"]);
  expect(sent.map((tab) => tab.widgets.map((widget) => widget.key))).toEqual([["o1"], ["s1"]]);
  expect(calls[0]!.content.widgets).toEqual([]);
}

/** A tab and a widget added on screen are counted in the header and sent on Save. */
export async function anAddedTabIsCountedAndSent(): Promise<void> {
  const calls: SentBody[] = [];
  stubSiteApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(siteDraft()),
    updateAdminDashboardTemplate: (_id: string, input: SentBody) => {
      calls.push(input);
      return Promise.resolve(siteDraft());
    },
  });
  renderPage();

  expect(await screen.findByText(/site · 2 widgets/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add widget" }), "the top-level Add widget showed").not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add tab" }));
  await userEvent.click(screen.getByRole("button", { name: "Add widget to this tab" }));
  expect(screen.getByText(/site · 3 widgets/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save canvas" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/The content to save: 3 widgets\. It is the canvas as edited on this screen\./)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]!.content.tabs.map((tab) => tab.key)).toEqual(["overview", "sld", "tab-1"]);
  expect(calls[0]!.content.tabs[2]!.widgets).toHaveLength(1);
}

/**
 * A refusal at `content.tabs.1.widgets.0.config` selects tab 2 and shows the message there.
 *
 * The refusal is the Review's own parse of `updateDashboardTemplateBodySchema`: the API's `400`
 * is `err.flatten()` and names `content` only (see `openSave` on the page), and the Review
 * refuses before Submit can send, so no request goes out.
 */
export async function aRefusalAtATabWidgetSelectsThatTab(): Promise<void> {
  const calls: unknown[] = [];
  stubSiteApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(siteDraft({ windowMinutes: -5 })),
    updateAdminDashboardTemplate: (_id: string, input: unknown) => {
      calls.push(input);
      return Promise.resolve(siteDraft());
    },
  });
  renderPage();

  const overview = await screen.findByRole("tab", { name: "Overview" });
  expect(overview).toHaveAttribute("aria-selected", "true");
  await userEvent.click(screen.getByRole("button", { name: "Save canvas" }));

  expect(screen.getByRole("tab", { name: "SLD" })).toHaveAttribute("aria-selected", "true");
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByRole("alert").textContent).toMatch(/^content\.tabs\.1\.widgets\.0\.config\.windowMinutes: /);
  // The wizard's Content step refuses the same body, so Review and Submit are never reached.
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  expect(calls, "a refused body was sent").toHaveLength(0);

  // An edit clears the stale message.
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const leave = screen.queryByRole("button", { name: /Leave|Discard/ });
  if (leave) await userEvent.click(leave);
  await userEvent.type(within(screen.getByRole("tabpanel")).getByLabelText("Group code"), "LV");
  expect(within(screen.getByRole("tabpanel")).queryByRole("alert")).not.toBeInTheDocument();
}

/**
 * The API's flattened `400` names no tab: the message shows on the Review card and the selected
 * tab stays. The positive twin of the case above.
 */
export async function aFlattenedServer400SelectsNoTab(): Promise<void> {
  const body = { formErrors: [], fieldErrors: { content: ["A dashboard template holds at most 8 tabs"] } };
  stubSiteApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(siteDraft()),
    updateAdminDashboardTemplate: () => Promise.reject(new Error(JSON.stringify(body))),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("tab", { name: "SLD" }));
  await openSaveReview();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  expect(await screen.findByText(/content: A dashboard template holds at most 8 tabs/)).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "SLD" })).toHaveAttribute("aria-selected", "true");
  expect(within(screen.getByRole("tabpanel")).queryByRole("alert")).not.toBeInTheDocument();
}

/** A published site template shows the strip and no tab input. */
export async function aPublishedSiteTemplateHasNoTabInputs(): Promise<void> {
  stubSiteApi({
    fetchAdminDashboardTemplate: () =>
      Promise.resolve({ ...siteDraft(), status: "published", publishedAt: new Date(0).toISOString() }),
  });
  renderPage();

  expect(await screen.findByRole("tab", { name: "SLD" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Tab label")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add tab" })).not.toBeInTheDocument();
}

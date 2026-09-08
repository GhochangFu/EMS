import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AlarmKbClass, AlarmKbResponse } from "@bms/shared";

import * as api from "../api/alarm-kb";
import type { AuthUser } from "../stores/auth-store";
import { AlarmKbPage } from "./alarm-kb-page";

/**
 * `E2.2` PR 2 (ADR 0059 decision 4) — the browsable alarm philosophy KB page.
 *
 * The claim worth the most here is `rendersForAViewer`. Ruling **Q0b** put
 * `viewer` inside this surface deliberately, against the master-data gate the
 * template authoring screen uses, and a page that quietly refused them would
 * fail as an empty list rather than as a denial — invisible from the outside.
 * `tests/e2.2-alarm-kb-route-gate.test.ts` holds the API half of that ruling;
 * this holds the page half.
 */

const viewer = {
  id: "u1",
  email: "viewer@bms.local",
  displayName: "Viewer",
  role: "viewer",
} as unknown as AuthUser;

function kbClass(overrides: Partial<AlarmKbClass> = {}): AlarmKbClass {
  return {
    templateId: "t1",
    templateCode: "PUMP_CENTRIFUGAL",
    templateName: "Centrifugal pump",
    templateVersion: 3,
    organizationId: "org-1",
    domain: "mechanical",
    alarms: [
      {
        alarmCode: "BEARING_TEMP_HIGH",
        message: "Bearing temperature high",
        severity: "warning",
        cause: "Lubrication starvation or a failing bearing race.",
        impact: "Unplanned outage of the driven train within hours.",
        action: "Reduce load, verify lubrication, schedule a bearing change.",
        skillCode: "mechanical",
        skillLabel: "Mechanical",
      },
    ],
    ...overrides,
  };
}

const WATER_CLASS = kbClass({
  templateId: "t2",
  templateCode: "RO_SKID",
  templateName: "RO skid",
  templateVersion: 1,
  domain: "water",
  alarms: [
    {
      alarmCode: "PERMEATE_CONDUCTIVITY_HIGH",
      message: "Permeate conductivity high",
      severity: "critical",
      cause: "Membrane breach or seal bypass.",
      impact: "Off-spec product water.",
      action: "Isolate the train and profile the vessels.",
      skillCode: null,
      skillLabel: null,
    },
  ],
});

async function renderPage(payload: AlarmKbResponse): Promise<void> {
  vi.spyOn(api, "fetchAlarmKb").mockResolvedValue(payload);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <AlarmKbPage user={viewer} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Classes render grouped by domain, each naming the version its text comes from. */
export async function groupsClassesByDomainAndNamesTheVersion(): Promise<void> {
  await renderPage({ classes: [kbClass(), WATER_CLASS] });

  await waitFor(() => {
    expect(screen.getByText("Centrifugal pump")).toBeTruthy();
  });

  // Queried as headings, not as text: the `mechanical` DOMAIN and the
  // `Mechanical` SKILL label are the same word on this page, so an unscoped
  // `getByText(/mechanical/i)` matches two nodes and fails for a reason that
  // has nothing to do with grouping.
  expect(screen.getByRole("heading", { name: /mechanical/i })).toBeTruthy();
  expect(screen.getByRole("heading", { name: /water/i })).toBeTruthy();

  const card = within(screen.getByRole("article", { name: "Centrifugal pump" }));
  // Ruling Q0a shows the CURRENT published version, while the alarm panel shows
  // the PINNED one — so this page has to say which it is (ADR 0059 decision 6).
  expect(card.getByText(/v3/)).toBeTruthy();
  expect(card.getByText("Lubrication starvation or a failing bearing race.")).toBeTruthy();
  expect(card.getByText("Mechanical")).toBeTruthy();
}

/** Search covers class name, alarm code and the philosophy text itself. */
export async function filtersByClassAlarmCodeAndPhilosophyText(): Promise<void> {
  await renderPage({ classes: [kbClass(), WATER_CLASS] });
  await waitFor(() => {
    expect(screen.getByText("Centrifugal pump")).toBeTruthy();
  });
  const user = userEvent.setup();
  const search = screen.getByLabelText(/search/i);

  await user.type(search, "membrane");
  await waitFor(() => {
    expect(screen.queryByText("Centrifugal pump")).toBeNull();
  });
  expect(screen.getByText("RO skid")).toBeTruthy();

  await user.clear(search);
  await user.type(search, "BEARING_TEMP_HIGH");
  await waitFor(() => {
    expect(screen.queryByText("RO skid")).toBeNull();
  });
  expect(screen.getByText("Centrifugal pump")).toBeTruthy();
}

/**
 * The empty state says the honest thing. "No results" would be a lie when the
 * cause is that no published class carries a philosophy yet — which is the
 * state a fresh tenant is actually in.
 */
export async function explainsAnEmptyKnowledgeBase(): Promise<void> {
  await renderPage({ classes: [] });

  await waitFor(() => {
    expect(screen.getByText(/no published asset class/i)).toBeTruthy();
  });
}

/** A search that matches nothing is a different message from an empty KB. */
export async function distinguishesNoMatchesFromAnEmptyKnowledgeBase(): Promise<void> {
  await renderPage({ classes: [kbClass()] });
  await waitFor(() => {
    expect(screen.getByText("Centrifugal pump")).toBeTruthy();
  });

  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/search/i), "zzzz-no-such-thing");

  await waitFor(() => {
    expect(screen.getByText(/no class matches/i)).toBeTruthy();
  });
  expect(screen.queryByText(/no published asset class/i)).toBeNull();
}

/**
 * Ruling Q0b. A `viewer` sees the whole page — no gate, no partial render, no
 * "ask an administrator" placeholder.
 */
export async function rendersForAViewer(): Promise<void> {
  await renderPage({ classes: [kbClass()] });

  await waitFor(() => {
    expect(screen.getByText("Centrifugal pump")).toBeTruthy();
  });
  const card = within(screen.getByRole("article", { name: "Centrifugal pump" }));
  expect(card.getByText("Reduce load, verify lubrication, schedule a bearing change.")).toBeTruthy();
  expect(screen.queryByText(/administrator/i)).toBeNull();
}

/** A class whose philosophy carries no skill renders without an empty label. */
export async function omitsTheSkillLineWhenNoneIsAuthored(): Promise<void> {
  await renderPage({ classes: [WATER_CLASS] });

  await waitFor(() => {
    expect(screen.getByText("RO skid")).toBeTruthy();
  });
  const card = within(screen.getByRole("article", { name: "RO skid" }));
  expect(card.queryByText(/skill required/i)).toBeNull();
}

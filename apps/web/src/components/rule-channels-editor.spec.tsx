import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type {
  AutomationRuleAction,
  NotificationChannelDto,
  RuleListItem,
  VocabulariesResponse,
} from "@bms/shared";

import * as api from "../api/notifications";
import * as rulesApi from "../api/rules";
import * as vocabApi from "../api/vocabularies";
import { RuleChannelsEditor } from "./rule-channels-editor";
import { RulesPanel } from "./rules-panel";

/**
 * `F3.7` Task 5 — the per-rule channel picker, rendered (ADR 0042).
 *
 * Assertions live here; `rule-channels-editor.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock, because that is
 * the file Vitest collects (ADR 0042 decision 2).
 *
 * Queries go by role and text, never by markup (decision 5). The accessible
 * name of each checkbox **is** the channel name, so a query for it is the same
 * claim an operator makes when reading the row.
 */

const RULE_ID = "44444444-4444-4444-4444-444444444444";

/**
 * A channel this caller's `GET /notifications/channels` does not return, but
 * `GET /rules/:id/notifications` does. Real, not contrived: `ChannelsService.
 * list` filters with `inArray(organizationId, writableOrgIds)` and `inArray`
 * never matches the `NULL` a fleet-managed global carries.
 */
const HIDDEN_CHANNEL_ID = "99999999-9999-9999-9999-999999999999";

const NOTIFY: AutomationRuleAction = { type: "notify", target: "Operations" };

const emailChannel: NotificationChannelDto = {
  id: "11111111-1111-1111-1111-111111111111",
  organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
  code: "ops-email",
  name: "Operations email",
  kind: "email",
  config: { to: ["control.room@example.test"] },
  enabled: true,
  hasSecret: false,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/**
 * Disabled on purpose. ADR 0041 decision 11 gives a rule exactly the channels
 * joined to it, and `NotificationsService.loadForRule` filters on `enabled` —
 * so a join to a disabled channel is **stored and sends nothing**. The picker
 * says which one that is and still lets an operator make the join, because the
 * channel is re-enabled elsewhere.
 */
const webhookChannel: NotificationChannelDto = {
  id: "22222222-2222-2222-2222-222222222222",
  organizationId: "aaaaaaaa-0000-0000-0000-000000000001",
  code: "ops-webhook",
  name: "Operations webhook",
  kind: "webhook",
  config: { url: "https://hooks.example.test/x" },
  enabled: false,
  hasSecret: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function stubApi(overrides: Partial<typeof api> = {}): void {
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({
    items: [emailChannel, webhookChannel],
  });
  vi.spyOn(api, "fetchRuleNotifications").mockResolvedValue({
    channelIds: [emailChannel.id],
  });
  vi.spyOn(api, "setRuleNotifications").mockImplementation(async (input) => ({
    channelIds: input.channelIds,
  }));
  for (const [name, value] of Object.entries(overrides)) {
    vi.spyOn(api, name as keyof typeof api).mockImplementation(value as never);
  }
}

/**
 * The `invalidateQueries` spy comes back because the join query's key is the
 * assertion: a save that writes the set and leaves a stale cache behind looks
 * identical on screen until the next reload.
 */
function renderEditor(action: AutomationRuleAction = NOTIFY): {
  invalidateQueries: ReturnType<typeof vi.fn>;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <RuleChannelsEditor ruleId={RULE_ID} action={action} />
    </QueryClientProvider>,
  );
  return { invalidateQueries: invalidateQueries as unknown as ReturnType<typeof vi.fn> };
}

export async function listsEveryChannelAndChecksTheJoinedOnes(): Promise<void> {
  stubApi();
  renderEditor();

  const email = await screen.findByRole("checkbox", { name: "Operations email" });
  expect(email).toBeChecked();

  const webhook = screen.getByRole("checkbox", { name: "Operations webhook (disabled)" });
  expect(webhook).not.toBeChecked();
  // Selectable, not greyed out: the join is legal, it simply sends nothing yet.
  expect(webhook).not.toBeDisabled();
}

export async function savesTheWholeSetAndInvalidatesTheJoinQuery(): Promise<void> {
  stubApi();
  const { invalidateQueries } = renderEditor();

  // Wait for the join to arrive before toggling: a click on a box the server
  // has not answered for yet would build the set from an empty list.
  expect(await screen.findByRole("checkbox", { name: "Operations email" })).toBeChecked();
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Operations webhook (disabled)" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.setRuleNotifications).toHaveBeenCalledTimes(1);
  });
  // The whole set, in channel-list order — `PUT` is not a delta.
  expect(api.setRuleNotifications).toHaveBeenCalledWith({
    ruleId: RULE_ID,
    channelIds: [emailChannel.id, webhookChannel.id],
  });
  await waitFor(() => {
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["rules", RULE_ID, "notifications"],
    });
  });
}

/**
 * ADR 0041 decision 11 — a rule notifies exactly the channels joined to it. So
 * after a save the boxes must show what the server stored, which is not always
 * what was ticked: here the `PUT` answers, the refetch reports that only the
 * first channel was joined, and the second box goes back to unticked.
 */
export async function showsWhatTheServerStoredAfterASuccessfulSave(): Promise<void> {
  stubApi();
  renderEditor();

  expect(await screen.findByRole("checkbox", { name: "Operations email" })).toBeChecked();
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Operations webhook (disabled)" }),
  );
  // The refetch the save triggers answers with the first channel only.
  vi.spyOn(api, "fetchRuleNotifications").mockResolvedValue({
    channelIds: [emailChannel.id],
  });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(
      screen.getByRole("checkbox", { name: "Operations webhook (disabled)" }),
    ).not.toBeChecked();
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

/** The state a `location_admin` always sees — `ChannelsService.list` gives it `[]`. */
export async function saysThereAreNoChannelsRatherThanShowingAnEmptyList(): Promise<void> {
  stubApi();
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [] });
  renderEditor();

  expect(
    await screen.findByText(
      "No channels you can manage. Create one under Admin → Notification channels.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
}

/**
 * A failed list is not an empty list. `[]` is also what the query holds while
 * it is loading, so the sentence above must be reachable from success only.
 */
export async function saysTheChannelListFailedRatherThanClaimingThereAreNone(): Promise<void> {
  stubApi();
  vi.spyOn(api, "fetchNotificationChannels").mockRejectedValue(new Error("channels 500"));
  renderEditor();

  expect(await screen.findByText(/could not load notification channels/i)).toBeInTheDocument();
  expect(
    screen.queryByText(
      "No channels you can manage. Create one under Admin → Notification channels.",
    ),
  ).not.toBeInTheDocument();
}

export async function keepsTheOperatorsBoxesWhenTheSaveIsRefused(): Promise<void> {
  stubApi({
    setRuleNotifications: (() =>
      Promise.reject(new Error("boom"))) as typeof api.setRuleNotifications,
  });
  renderEditor();

  expect(await screen.findByRole("checkbox", { name: "Operations email" })).toBeChecked();
  const webhook = screen.getByRole("checkbox", { name: "Operations webhook (disabled)" });
  await userEvent.click(webhook);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent(/boom/i);
  });
  // The refusal reports; it does not undo the operator's work.
  expect(screen.getByRole("checkbox", { name: "Operations webhook (disabled)" })).toBeChecked();
}

/**
 * `F3.7` REVIEW FINDING (High, both reviewers; owner ruling 2026-09-06) — the
 * picker must not delete a join it never showed.
 *
 * `GET /rules/:id/notifications` applies no organization filter;
 * `ChannelsService.list` applies `inArray(organizationId, writableOrgIds)`,
 * which never matches the `NULL` a fleet-managed global channel carries. So an
 * `organization_admin` could be joined to a channel with no box to tick, and a
 * `PUT` of the visible ticks alone silently unjoined it.
 *
 * Both halves are asserted, and both are load-bearing: the count on screen is
 * how the operator learns the join exists at all, and the id in the payload is
 * what stops the save from deleting it. Note the untick — the id must survive
 * a toggle, which is where a `hidden` derived from `checked` would lose it,
 * because `selected` is rebuilt from the visible channel list.
 */
export async function carriesAJoinedChannelItCannotShowThroughTheSave(): Promise<void> {
  stubApi();
  vi.spyOn(api, "fetchNotificationChannels").mockResolvedValue({ items: [emailChannel] });
  vi.spyOn(api, "fetchRuleNotifications").mockResolvedValue({
    channelIds: [emailChannel.id, HIDDEN_CHANNEL_ID],
  });
  renderEditor();

  const email = await screen.findByRole("checkbox", { name: "Operations email" });
  expect(email).toBeChecked();
  expect(
    screen.getByText("1 joined channel outside your scope stays joined."),
  ).toBeInTheDocument();

  await userEvent.click(email);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.setRuleNotifications).toHaveBeenCalledTimes(1);
  });
  expect(api.setRuleNotifications).toHaveBeenCalledWith({
    ruleId: RULE_ID,
    channelIds: [HIDDEN_CHANNEL_ID],
  });
}

/** Nothing is hidden, so nothing is claimed — the line is absent, not "0". */
export async function saysNothingAboutHiddenChannelsWhenThereAreNone(): Promise<void> {
  stubApi();
  renderEditor();

  expect(await screen.findByRole("checkbox", { name: "Operations email" })).toBeChecked();
  expect(screen.queryByText(/stays joined|stay joined/)).not.toBeInTheDocument();
}

/**
 * `F3.7` REVIEW FINDING (Medium, code-reviewer) — the caption was
 * unconditional, and `rule-actions.ts`'s `shouldNotify` is `notify`-only
 * (owner ruling Q3). A `trace_only` or `review` rule sends to nobody however
 * many channels are ticked, so "this rule notifies exactly these channels"
 * under one of those was a false statement on an operator's screen.
 */
export async function saysAJoinedChannelGetsNothingWhenTheActionIsNotNotify(): Promise<void> {
  stubApi();
  renderEditor({ type: "trace_only", target: "Operations" });

  expect(await screen.findByRole("checkbox", { name: "Operations email" })).toBeChecked();
  expect(
    screen.getByText(
      "This rule's action is trace_only, so joined channels receive nothing until it is notify.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("This rule notifies exactly these channels."),
  ).not.toBeInTheDocument();
}

/** The other branch — a caption hard-coded either way fails one of the pair. */
export async function keepsThePlainCaptionForANotifyRule(): Promise<void> {
  stubApi();
  renderEditor(NOTIFY);

  expect(await screen.findByRole("checkbox", { name: "Operations email" })).toBeChecked();
  expect(screen.getByText("This rule notifies exactly these channels.")).toBeInTheDocument();
  expect(screen.queryByText(/receive nothing until it is notify/)).not.toBeInTheDocument();
}

const notifyRule: RuleListItem = {
  id: RULE_ID,
  code: "chiller_high_temp",
  name: "Chiller high temperature",
  description: "Raises when the chiller runs hot.",
  category: "hvac",
  ruleType: "threshold",
  source: "operator_rule",
  enabled: true,
  assetId: "55555555-5555-5555-5555-555555555555",
  assetCode: "CH-01",
  assetName: "Chiller 1",
  siteName: "West Campus",
  assetDomain: "hvac",
  pointKey: "supply_temp_c",
  operator: "gte",
  thresholdValue: 12,
  severity: "warning",
  clearHoldSeconds: null,
  lifecycleStatus: "published",
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
  lastEvaluatedAt: null,
  publishedAt: new Date(0).toISOString(),
  archivedAt: null,
  duplicatedFromRuleId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const emptyVocabularies: VocabulariesResponse = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
};

/**
 * The editor mounts on the press and not before. Measured reason: 289 enabled
 * rules are live on this database, and a card that mounted the editor eagerly
 * would issue 289 `GET /rules/:id/notifications` to paint the list.
 */
export async function mountsTheEditorOnlyWhenTheCardAsksForIt(): Promise<void> {
  stubApi();
  vi.spyOn(rulesApi, "fetchRules").mockResolvedValue({ items: [notifyRule] });
  vi.spyOn(rulesApi, "fetchRuleExecutions").mockResolvedValue({ items: [] });
  vi.spyOn(rulesApi, "fetchRuleBuilderCatalog").mockResolvedValue({ assets: [] });
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(emptyVocabularies);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RulesPanel />
    </QueryClientProvider>,
  );

  const open = await screen.findByRole("button", { name: "Channels" });
  expect(api.fetchRuleNotifications).not.toHaveBeenCalled();

  await userEvent.click(open);

  expect(await screen.findByRole("checkbox", { name: "Operations email" })).toBeChecked();
  expect(api.fetchRuleNotifications).toHaveBeenCalledTimes(1);
  expect(api.fetchRuleNotifications).toHaveBeenCalledWith(RULE_ID);
}

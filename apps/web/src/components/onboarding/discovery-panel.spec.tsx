import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { OnboardingSessionDto } from "@bms/shared";
import { MQTT_DISCOVERY_SHARED_USER_WARNING } from "@bms/shared/contracts";

import { DISCOVERY_NEEDS_WORKER, DiscoveryPanel } from "./discovery-panel";

/**
 * `F3.24b` (ADR 0103) — the drawer's Discovery section: the Discover button
 * and its disabled reasons, the status line, the empty-result sentence and the
 * Discovered badge with the sample value. `fetch` is stubbed.
 */

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const DISCOVERY_ID = "22222222-2222-4222-8222-222222222222";

type Discovery = NonNullable<OnboardingSessionDto["discovery"]>;

function discovery(over: Partial<Discovery> = {}): Discovery {
  return {
    discoveryId: DISCOVERY_ID,
    rtuCode: "AIR-1051",
    topicFilter: "Airsprint-1051/Data/#",
    windowSeconds: 60,
    status: "done",
    startedAt: "2026-10-19T10:00:00.000Z",
    finishedAt: "2026-10-19T10:01:00.000Z",
    truncated: false,
    devices: [],
    ...over,
  };
}

function rtu(config: Record<string, unknown>, credentialsSet = true) {
  return { code: "AIR-1051", displayName: "Air 1051", protocol: "mqtt", credentialsSet, config };
}

const BROKER = { host: "phe.thinkiot.co.in", port: 8883, topic: "Airsprint-1051/Data/1051" };

function session(over: { rtus?: unknown[]; assetPoints?: unknown[]; discovery?: Discovery | null } = {}): OnboardingSessionDto {
  return {
    id: SESSION_ID,
    organizationName: "Org",
    status: "draft",
    draft: {
      location: { name: "Plant 4" },
      rtus: over.rtus ?? [rtu(BROKER)],
      assetPoints: over.assetPoints,
    },
    discovery: over.discovery ?? null,
  } as unknown as OnboardingSessionDto;
}

function mount(s: OnboardingSessionDto, busy = false) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DiscoveryPanel session={s} onSessionChange={() => undefined} busy={busy} />
    </QueryClientProvider>,
  );
}

const discoverButton = (): HTMLButtonElement => screen.getByRole("button", { name: /^Discover/ }) as HTMLButtonElement;

export function theButtonIsEnabledForAnMqttRtuWithCredentials(): void {
  mount(session());
  expect(discoverButton().disabled).toBe(false);
  expect(screen.getByText(MQTT_DISCOVERY_SHARED_USER_WARNING)).toBeTruthy();
}

export function withoutCredentialsTheButtonIsDisabledWithItsReason(): void {
  mount(session({ rtus: [rtu(BROKER, false)] }));
  expect(discoverButton().disabled).toBe(true);
  expect(screen.getByText("Set the RTU's credentials first.")).toBeTruthy();
}

export function withoutAHostTheButtonIsDisabledWithItsReason(): void {
  mount(session({ rtus: [rtu({ topic: "a/b" })] }));
  expect(discoverButton().disabled).toBe(true);
  expect(screen.getByText("Set the RTU's broker host and port first.")).toBeTruthy();
}

export function aRunningDiscoveryDisablesTheButtonAndShowsTheStatus(): void {
  mount(session({ discovery: discovery({ status: "running", finishedAt: null }) }));
  expect(discoverButton().disabled).toBe(true);
  expect(screen.getByText("A discovery is running. It listens for up to 60 s.")).toBeTruthy();
}

export function aNonMqttDraftRendersNoSection(): void {
  mount(session({ rtus: [{ ...rtu(BROKER), protocol: "simulator" }] }));
  expect(screen.queryByRole("button", { name: /^Discover/ })).toBeNull();
}

export function aDoneDiscoveryWithNoDeviceShowsTheEmptySentence(): void {
  mount(session({ discovery: discovery() }));
  expect(screen.getByText("No device published in the window.")).toBeTruthy();
}

export function aDoneDiscoveryShowsTheCountsAndTheTruncatedNote(): void {
  const devices = [{ topic: "a/b", devId: "D1", messageCount: 3, keys: [{ sourceKey: "kw", sampleValue: 1.5 }, { sourceKey: "on", sampleValue: true }] }];
  mount(session({ discovery: discovery({ devices, truncated: true }) }));
  expect(screen.getByText("Done: 1 device, 2 keys. The result was cut at a limit.")).toBeTruthy();
}

export function aFailedDiscoveryShowsItsErrorClass(): void {
  mount(session({ discovery: discovery({ status: "failed", error: "auth refused" }) }));
  expect(screen.getByText("Failed: auth refused.")).toBeTruthy();
}

export function aDiscoveredRowShowsTheBadgeAndTheSampleValue(): void {
  const devices = [{ topic: "a/b", devId: "D1", messageCount: 3, keys: [{ sourceKey: "kw_total", sampleValue: 12.5 }] }];
  mount(
    session({
      discovery: discovery({ devices }),
      assetPoints: [{ assetIndex: 0, pointKey: "power_kw", sourceDataKey: "kw_total", source: "discovery" }],
    }),
  );
  const row = screen.getByText("kw_total → power_kw").closest("li") as HTMLElement;
  expect(within(row).getByText("Discovered")).toBeTruthy();
  expect(within(row).getByText("sample 12.5")).toBeTruthy();
}

export function aPlainRowShowsNoBadge(): void {
  mount(
    session({
      discovery: discovery(),
      assetPoints: [
        { assetIndex: 0, pointKey: "power_kw", sourceDataKey: "kw_total", source: "discovery" },
        { assetIndex: 0, pointKey: "volt", sourceDataKey: "v_ll" },
      ],
    }),
  );
  // The adjacent positive: the discovered row has its badge; the negative: the plain row is not listed at all.
  expect(screen.getAllByText("Discovered")).toHaveLength(1);
  expect(screen.queryByText("v_ll → volt")).toBeNull();
}

export async function aWorkerRefusalDisablesTheButtonWithTheWorkerReason(): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ message: "no worker" }), { status: 503, headers: { "Content-Type": "application/json" } })),
  );
  mount(session());
  fireEvent.click(discoverButton());
  const wizard = await screen.findByRole("dialog");
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  fireEvent.click(await within(wizard).findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(screen.getByText(DISCOVERY_NEEDS_WORKER)).toBeTruthy());
  fireEvent.click(within(wizard).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(discoverButton().disabled).toBe(true);
}

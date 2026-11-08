import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { OnboardingSessionDto } from "@bms/shared";
import { MQTT_DISCOVERY_SHARED_USER_WARNING } from "@bms/shared/contracts";

import {
  defaultDiscoveryTopicPrefix,
  ONBOARDING_DISCOVERY_CONFLICT,
  OnboardingDiscoveryWizard,
} from "./onboarding-discovery-wizard";

/**
 * `F3.24b` (ADR 0103) — the `onboarding.discovery` wizard: the default
 * prefix, the Review text, the posted body and the 409 sentence. `fetch` is
 * stubbed, so the assertion is on the request that would leave the browser.
 */

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const DISCOVERY_ID = "22222222-2222-4222-8222-222222222222";

const SESSION = {
  id: SESSION_ID,
  organizationName: "Org",
  draft: { location: { name: "Plant 4" } },
} as unknown as OnboardingSessionDto;

const RTU = { code: "AIR-1051", host: "phe.thinkiot.co.in", port: 8883, tls: true, topic: "Airsprint-1051/Data/1051" };
/** `F4.326`: a plain MQTT RTU on an allowlisted broker (ADR 0114). */
const PLAIN_RTU = { code: "LALRLY1", host: "broker.example", port: 1883, tls: false, topic: "BCPL/LAL/01" };

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderWizard(onStarted = vi.fn(), rtu: typeof RTU = RTU) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OnboardingDiscoveryWizard session={SESSION} rtu={rtu} onStarted={onStarted} onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return onStarted;
}

/** Goes from the Discovery step to Review and presses Submit; returns the dialog. */
async function submit(): Promise<HTMLElement> {
  const wizard = screen.getByRole("dialog");
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  fireEvent.click(await within(wizard).findByRole("button", { name: "Submit" }));
  return wizard;
}

export function theDefaultPrefixIsTheSavedTopicUpToItsLastSlash(): void {
  expect(defaultDiscoveryTopicPrefix("Airsprint-1051/Data/1051")).toBe("Airsprint-1051/Data");
}

export function aTopicWithNoSlashIsItsOwnPrefix(): void {
  expect(defaultDiscoveryTopicPrefix("plant4")).toBe("plant4");
}

export function theStepShowsTheBrokerTheFilterAndTheWarning(): void {
  stubFetch(202, { discoveryId: DISCOVERY_ID });
  renderWizard();
  const wizard = screen.getByRole("dialog");
  expect(within(wizard).getByText("Broker: phe.thinkiot.co.in:8883. TLS: on.")).toBeTruthy();
  expect(within(wizard).getByText("Airsprint-1051/Data/#")).toBeTruthy();
  expect(within(wizard).getAllByText(MQTT_DISCOVERY_SHARED_USER_WARNING, { exact: false }).length).toBeGreaterThan(0);
}

export async function submitPostsTheBodyToTheDiscoveryRoute(): Promise<void> {
  const fetchMock = stubFetch(202, { discoveryId: DISCOVERY_ID });
  renderWizard();
  await submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect([url.endsWith(`/api/v1/admin/onboarding/sessions/${SESSION_ID}/discovery`), init.method, JSON.parse(String(init.body))]).toEqual([
    true,
    "POST",
    { rtuCode: "AIR-1051", expected: { host: "phe.thinkiot.co.in", port: 8883, tls: true }, topicPrefix: "Airsprint-1051/Data", windowSeconds: 60 },
  ]);
}

/** `F4.326` (ADR 0114 decision 6, R6): a plain RTU's step says TLS is off, and the body binds `expected.tls: false`. */
export async function aPlainRtuSaysTlsOffAndPostsExpectedTlsFalse(): Promise<void> {
  const fetchMock = stubFetch(202, { discoveryId: DISCOVERY_ID });
  renderWizard(vi.fn(), PLAIN_RTU);
  const wizard = screen.getByRole("dialog");
  expect(
    within(wizard).getByText("Broker: broker.example:1883. TLS: off \u2014 credentials and data cross the network unencrypted."),
  ).toBeTruthy();
  await submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect((JSON.parse(String(init.body)) as { expected: unknown }).expected).toEqual({ host: "broker.example", port: 1883, tls: false });
}

export async function a202HandsTheDiscoveryIdUp(): Promise<void> {
  stubFetch(202, { discoveryId: DISCOVERY_ID });
  const onStarted = renderWizard();
  await submit();
  await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
  expect(onStarted.mock.calls[0]?.[0]).toEqual({ discoveryId: DISCOVERY_ID });
}

export async function a409ShowsTheConflictSentence(): Promise<void> {
  stubFetch(409, { message: "busy" });
  const onStarted = renderWizard();
  const wizard = await submit();
  expect(await within(wizard).findByText(ONBOARDING_DISCOVERY_CONFLICT)).toBeTruthy();
  expect(onStarted).not.toHaveBeenCalled();
}

/** F4.339 (ADR 0117 decision 5): a chosen window reaches the step text and the body. */
export async function aChosenWindowIsShownAndPosted(): Promise<void> {
  const fetchMock = stubFetch(202, { discoveryId: DISCOVERY_ID });
  renderWizard();
  const wizard = screen.getByRole("dialog");
  fireEvent.change(within(wizard).getByLabelText("Window (s)"), { target: { value: "180" } });
  expect(within(wizard).getByText(/Window: 180 s\./)).toBeTruthy();
  await submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect((JSON.parse(String(init.body)) as { windowSeconds: unknown }).windowSeconds).toBe(180);
}

/** F4.339: 301 s is refused client-side, at the step, with the shared schema's message, and nothing is sent. */
export async function aWindowOver300IsRefusedBeforeItIsSent(): Promise<void> {
  const fetchMock = stubFetch(202, { discoveryId: DISCOVERY_ID });
  renderWizard();
  const wizard = screen.getByRole("dialog");
  fireEvent.change(within(wizard).getByLabelText("Window (s)"), { target: { value: "301" } });
  // The step check reads the shared schema, so Next stays on the step with its message.
  fireEvent.click(within(wizard).getByRole("button", { name: "Next" }));
  expect(await within(wizard).findByText(/windowSeconds: Number must be less than or equal to 300/)).toBeTruthy();
  expect(within(wizard).queryByRole("button", { name: "Submit" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { expect, vi } from "vitest";

import type { OnboardingSessionDto } from "@bms/shared";

import { DraftDrawer } from "./draft-drawer";

/**
 * `F4.326` / ADR 0114 decision 6 — the onboarding draft preview marks a plain
 * MQTT RTU with a "Plain MQTT" pill: only the literal `tls: false`, only MQTT.
 */

function session(rtus: unknown[]): OnboardingSessionDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    organizationCode: "X",
    organizationName: "Org X",
    status: "draft",
    currentPhase: "rtu",
    draft: { location: { name: "Lalmati", code: "LALMATI" }, rtus },
    messages: [],
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    committedAt: null,
    result: null,
    checkpoints: [],
    draftHash: null,
    discovery: null,
  } as unknown as OnboardingSessionDto;
}

function mqtt(code: string, tls: unknown): Record<string, unknown> {
  const config: Record<string, unknown> = { host: "broker.example", port: 1883, topic: `t/${code}` };
  if (tls !== undefined) config.tls = tls;
  return { code, displayName: code, protocol: "mqtt", credentialsSet: true, config };
}

function mount(s: OnboardingSessionDto): void {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DraftDrawer
        open
        session={s}
        validationErrors={[]}
        onClose={() => undefined}
        onSessionChange={() => undefined}
        busy={false}
        onValidate={() => undefined}
        validating={false}
        commit={null}
      />
    </QueryClientProvider>,
  );
}

/** D1 — one pill for the plain RTU, none for its TLS, absent, string and non-MQTT twins. */
export function onlyAPlainMqttRtuGetsThePill(): void {
  mount(
    session([
      mqtt("PLAIN-1", false),
      mqtt("TLS-1", true),
      mqtt("ABSENT-1", undefined),
      mqtt("STR-1", "false"),
      { code: "MB-1", displayName: "MB-1", protocol: "modbus_tcp", credentialsSet: false, config: { tls: false } },
    ]),
  );
  const pills = screen.getAllByText("Plain MQTT");
  expect(pills).toHaveLength(1);
  expect(pills[0]?.closest("li")?.textContent).toContain("PLAIN-1");
}

/** D2 — the summary in the drawer carries the TLS-off sentence for the plain RTU. */
export function theDrawerSummaryDisclosesTlsOff(): void {
  mount(session([mqtt("PLAIN-1", false)]));
  expect(screen.getByText(/TLS off — credentials and data cross the network unencrypted/)).toBeTruthy();
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const COMMITTED_ID = "33333333-3333-4333-8333-333333333333";

/** A copy-able draft: `SRC` holds a credential; `DST` and `FAR` (another port) do not. */
function copyDraft(dstSet = false): OnboardingSessionDto {
  const on = (code: string, port: number, set: boolean) => ({
    code,
    displayName: code,
    protocol: "mqtt",
    credentialsSet: set,
    config: { host: "broker.example", port, topic: `t/${code}` },
  });
  const base = session([on("SRC", 8883, true), on("DST", 8883, dstSet), on("FAR", 1883, false)]);
  const location = { name: "Lalmati", code: "LALMATI", slug: "lalmati", latitude: 19.3, longitude: 84.8 };
  return { ...base, draft: { ...base.draft, location }, lock: null } as OnboardingSessionDto;
}

const COMMITTED_RTU = {
  id: COMMITTED_ID,
  locationId: "44444444-4444-4444-8444-444444444444",
  locationName: "Lalmati WTP",
  organizationCode: "X",
  code: "LIVE-1",
  displayName: "LIVE-1",
  sourceType: "mqtt",
  domain: null,
  externalRtuId: null,
  rtuCode: null,
  mqttTopic: null,
  releasedMqttTopic: null,
  stationCode: null,
  stationName: null,
  ingestEnabled: true,
  organizationIngestEnabled: true,
  active: true,
  meta: null,
  createdAt: "2026-11-07T00:00:00.000Z",
  tls: true,
  payloadFormat: null,
};

type Sent = { url: string; method: string; body: string };

/** The drawer, holding the session the copy answers with; `answer` replies to the copy POST. */
function mountCopy(answer: { status: number; json: unknown }): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url, method: init.method ?? "GET", body: String(init.body ?? "") });
      const json = url.includes("/admin/rtus") ? { items: [COMMITTED_RTU] } : url.endsWith("/credentials/copy") ? answer.json : {};
      const status = url.endsWith("/credentials/copy") ? answer.status : 200;
      return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  function Harness() {
    const [s, setS] = useState(copyDraft());
    return (
      <DraftDrawer
        open
        session={s}
        validationErrors={[]}
        onClose={() => undefined}
        onSessionChange={setS}
        busy={false}
        onValidate={() => undefined}
        validating={false}
        commit={null}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  );
  return sent;
}

const copyFor = (code: string): HTMLElement => screen.getAllByText(code, { selector: "li span.font-mono" })[0]!.closest("li") as HTMLElement;

async function openFor(code: string): Promise<HTMLSelectElement> {
  fireEvent.click(within(copyFor(code)).getByRole("button", { name: "Same credentials as…" }));
  return (await screen.findByRole("combobox", { name: `Credential source for ${code}` })) as HTMLSelectElement;
}

/** D3 — the draft source lists only a credentialed MQTT RTU on the same broker; the POST names it; the row then reads Set. */
export async function aDraftSourceCopiesAndTheRowReadsSet(): Promise<void> {
  const sent = mountCopy({ status: 200, json: copyDraft(true) });
  const select = await openFor("DST");
  const draftGroup = select.querySelector('optgroup[label="This draft"]');
  expect([...(draftGroup?.querySelectorAll("option") ?? [])].map((o) => o.textContent)).toEqual(["SRC"]);
  fireEvent.change(select, { target: { value: "d:0" } });
  fireEvent.click(screen.getByRole("button", { name: "Copy credentials" }));
  await waitFor(() => expect(sent.some((r) => r.url.endsWith("/credentials/copy"))).toBe(true));
  const post = sent.find((r) => r.url.endsWith("/credentials/copy"))!;
  expect(post.url).toMatch(new RegExp(`/admin/onboarding/sessions/${SESSION_ID}/credentials/copy$`));
  expect(post.method).toBe("POST");
  expect(JSON.parse(post.body)).toEqual({ from: { rtuIndex: 0 }, toRtuIndexes: [1] });
  await waitFor(() => expect(copyFor("DST").textContent).toContain("Set"));
}

/** D4 — a committed source is listed from the organization's RTUs and posted by id. */
export async function aCommittedSourcePostsItsId(): Promise<void> {
  const sent = mountCopy({ status: 200, json: copyDraft(true) });
  const select = await openFor("DST");
  await waitFor(() => expect(select.querySelector(`option[value="c:${COMMITTED_ID}"]`)).not.toBeNull());
  fireEvent.change(select, { target: { value: `c:${COMMITTED_ID}` } });
  fireEvent.click(screen.getByRole("button", { name: "Copy credentials" }));
  await waitFor(() => expect(sent.some((r) => r.url.endsWith("/credentials/copy"))).toBe(true));
  expect(JSON.parse(sent.find((r) => r.url.endsWith("/credentials/copy"))!.body)).toEqual({
    from: { rtuId: COMMITTED_ID },
    toRtuIndexes: [1],
  });
}

/** D5 — the server's 409 (a broker mismatch) is shown; the committed list is read only once the control opens. */
export async function aRefusalIsShown(): Promise<void> {
  const message = "Draft RTU DST is not an MQTT RTU on the same broker (host, port and TLS) as the source. Nothing was copied.";
  const sent = mountCopy({ status: 409, json: { statusCode: 409, message } });
  expect(sent.filter((r) => r.url.includes("/admin/rtus"))).toEqual([]);
  const select = await openFor("DST");
  await waitFor(() => expect(select.querySelector(`option[value="c:${COMMITTED_ID}"]`)).not.toBeNull());
  fireEvent.change(select, { target: { value: `c:${COMMITTED_ID}` } });
  fireEvent.click(screen.getByRole("button", { name: "Copy credentials" }));
  expect(await screen.findByText(message)).toBeTruthy();
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { MqttPayloadFormatDto, OnboardingSessionDto } from "@bms/shared";

import { DiscoveryPanel, skippedReasonsLine, withPayloadFormat } from "./discovery-panel";

/**
 * `F4.334` / `F4.335` (plan T5.3) — the drawer's payload format picker per MQTT
 * RTU, the discovered devices with their format, and the per-reason
 * not-decoded line. `fetch` is stubbed.
 */

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

type Discovery = NonNullable<OnboardingSessionDto["discovery"]>;

const FORMAT = (code: string, name: string, builtin = false): MqttPayloadFormatDto => ({
  id: builtin ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002",
  code,
  name,
  description: "",
  definition: builtin
    ? { kind: "builtin", name: "thinkiot-envelope" }
    : {
        kind: "declarative",
        root: "array",
        deviceKey: ["TagName"],
        wordOrder: "big",
        byteOrder: "big",
        readings: [{ key: "f", register: { path: ["Data"], index: 0, type: "float32" } }],
      },
  builtin,
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
  updatedBy: null,
});
const FORMATS = [FORMAT("thinkiot-envelope", "ThinkIoT envelope", true), FORMAT("thinkiot-register-array", "ThinkIoT register array")];

function discovery(over: Partial<Discovery> = {}): Discovery {
  return {
    discoveryId: "22222222-2222-4222-8222-222222222222",
    rtuCode: "BCPL-SRC",
    topicFilter: "BCPL/#",
    windowSeconds: 60,
    status: "done",
    startedAt: "2026-11-08T00:00:00.000Z",
    finishedAt: "2026-11-08T00:01:00.000Z",
    truncated: false,
    devices: [],
    messages: 0,
    skipped: 0,
    ...over,
  };
}

function session(config: Record<string, unknown>, d: Discovery | null = null): OnboardingSessionDto {
  return {
    id: SESSION_ID,
    organizationName: "Org",
    status: "draft",
    draft: {
      location: { name: "Lakwa" },
      rtus: [{ code: "BCPL-SRC", displayName: "BCPL", protocol: "mqtt", credentialsSet: true, config }],
    },
    discovery: d,
  } as unknown as OnboardingSessionDto;
}

const BROKER = { host: "broker.example.com", port: 1883, topic: "BCPL/LAKWA" };

function stubFetch(): { patches: unknown[] } {
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/admin/mqtt-payload-formats")) {
        return new Response(JSON.stringify(FORMATS), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
      }
      return new Response("{}", { status: 500 });
    }),
  );
  return { patches };
}

function mount(s: OnboardingSessionDto) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DiscoveryPanel session={s} onSessionChange={() => undefined} busy={false} />
    </QueryClientProvider>,
  );
}

/** D1 — the picker shows the RTU's format (the built-in when none) and writes the key; the built-in removes it. */
export async function thePickerWritesTheRtuPayloadFormat(): Promise<void> {
  const { patches } = stubFetch();
  mount(session(BROKER));
  const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
  expect(select.value).toBe("thinkiot-envelope");
  fireEvent.change(select, { target: { value: "thinkiot-register-array" } });
  await waitFor(() => expect(patches).toHaveLength(1));
  const body = patches[0] as { draft: { rtus: { config: Record<string, unknown> }[] } };
  expect(body.draft.rtus[0]?.config).toEqual({ ...BROKER, payloadFormat: "thinkiot-register-array" });
  expect(withPayloadFormat({ ...BROKER, payloadFormat: "x" }, "thinkiot-envelope")).toEqual(BROKER);
}

/** D2 — a stored format pre-selects. */
export async function aStoredFormatIsPreselected(): Promise<void> {
  stubFetch();
  mount(session({ ...BROKER, payloadFormat: "thinkiot-register-array" }));
  const select = (await screen.findByRole("combobox")) as HTMLSelectElement;
  expect(select.value).toBe("thinkiot-register-array");
}

/** D3 — each discovered device is listed with the format that decoded it. */
export async function eachDeviceShowsItsFormat(): Promise<void> {
  stubFetch();
  const devices = [
    { topic: "BCPL/LAKWA/data", devId: "BCPL_LAKWA_02", messageCount: 6, keys: [], payloadFormat: "thinkiot-register-array" },
    { topic: "BCPL/LAKWA/old", devId: "OLD-1", messageCount: 1, keys: [] },
  ];
  mount(session(BROKER, discovery({ devices, messages: 7 })));
  const list = await screen.findByRole("list", { name: "Discovered devices" });
  expect(list.textContent).toContain("BCPL_LAKWA_02");
  expect(list.textContent).toContain("thinkiot-register-array");
  // A result stored before ADR 0116 carries no format: the built-in.
  expect(list.textContent).toContain("thinkiot-envelope");
}

/** D4 — the not-decoded line names each reason with its count, fixed text only (F4.335). */
export async function theSkippedReasonsAreNamed(): Promise<void> {
  stubFetch();
  const devices = [{ topic: "a/b", devId: "D1", messageCount: 1, keys: [] }];
  mount(session(BROKER, discovery({ devices, messages: 1, skipped: 6, skippedReasons: { "no-format": 4, oversize: 2 } })));
  expect(await screen.findByText("Not decoded: 4 matched no known payload format, 2 were too large.")).toBeTruthy();
  expect(skippedReasonsLine(discovery({ skipped: 0 }))).toBeNull();
  expect(skippedReasonsLine(discovery({ skipped: 3 }))).toBe("Not decoded: 3.");
}

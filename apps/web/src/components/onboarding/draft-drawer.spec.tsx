import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

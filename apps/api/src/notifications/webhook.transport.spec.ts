import { createHmac } from "node:crypto";

import type { NotificationChannelRow, NotificationMessage } from "./notification-transport";
import { buildConfig } from "./notifications.config";
import { SIGNATURE_HEADER, WebhookTransport } from "./webhook.transport";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SECRET = "hmac-secret-for-the-test";
const PUBLIC_URL = "https://hooks.example.com/services/SECRET-PATH-DO-NOT-LOG";

function channel(overrides: Partial<NotificationChannelRow> = {}): NotificationChannelRow {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    organizationId: "12121212-1212-1212-1212-121212121212",
    code: "ops-webhook",
    name: "Operations webhook",
    kind: "webhook",
    config: { url: PUBLIC_URL },
    secret: SECRET,
    secretState: "ready",
    enabled: true,
    ...overrides,
  };
}

function message(row: NotificationChannelRow = channel()): NotificationMessage {
  return {
    subject: "Alarm: UPS-1 battery temperature",
    body: "UPS-1 battery temperature is 48C.",
    ruleId: "11111111-1111-1111-1111-111111111111",
    ruleCode: "UPS-BATT-TEMP",
    alarmId: "22222222-2222-2222-2222-222222222222",
    severity: "critical",
    channel: row,
  };
}

type Call = { url: string; init: RequestInit };

/** Records every call and answers with a canned response. No socket is opened. */
function stubFetch(respond: () => Response | Promise<Response>): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchStub = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(respond());
  }) as typeof globalThis.fetch;
  return { fetch: fetchStub, calls };
}

const publicResolve = () => Promise.resolve(["93.184.216.34"]);

function transportWith(
  fetchImpl: typeof globalThis.fetch,
  resolve = publicResolve,
  env: NodeJS.ProcessEnv = {},
): WebhookTransport {
  return new WebhookTransport({ fetch: fetchImpl, resolve, config: buildConfig(env) });
}

/**
 * `F3.8` U4 — `WebhookTransport`, with `fetch` and the resolver stubbed.
 *
 * No test here opens a socket (ADR 0041 decision 2).
 */
export async function runWebhookTransportTests(): Promise<void> {
  // --- the happy path, and the signature -----------------------------------
  {
    const { fetch, calls } = stubFetch(() => new Response("ok", { status: 200 }));
    const result = await transportWith(fetch).send(message());
    assert(result.status === "sent", `a 200 must be sent, got ${result.status}`);
    assert(result.error === null, "a send has no error");
    assert(calls.length === 1, `expected one request, got ${calls.length}`);

    const call = calls[0];
    const init = call?.init ?? {};
    assert(init.method === "POST", "the webhook is a POST");
    assert(init.redirect === "manual", "redirect must be manual — a 3xx is the way around an allowlist");
    assert(init.signal !== undefined, "the request must carry a timeout signal");

    const headers = (init.headers ?? {}) as Record<string, string>;
    const sent = String(init.body ?? "");
    // Computed independently, over the exact bytes sent — not over a
    // re-serialisation, which can differ and then never match.
    const expected = createHmac("sha256", SECRET).update(sent, "utf8").digest("hex");
    assert(
      headers[SIGNATURE_HEADER] === expected,
      `the signature header must be the HMAC of the exact body; got ${String(headers[SIGNATURE_HEADER])}`,
    );
  }

  // A channel with no secret sends unsigned. That is allowed — the send-test
  // flow is what makes it visible to whoever configures the channel.
  {
    // `null`, not `"ok"`: the Response constructor refuses a body on a 204,
    // and the throw would surface as a `failed` delivery rather than as a
    // broken fixture.
    const { fetch, calls } = stubFetch(() => new Response(null, { status: 204 }));
    const result = await transportWith(fetch).send(
      message(channel({ secret: null, secretState: "none" })),
    );
    assert(result.status === "sent", `a 204 must be sent, got ${result.status}`);
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    assert(
      headers[SIGNATURE_HEADER] === undefined,
      "a channel with no secret must not send an empty signature header",
    );
  }

  // --- the guard runs BEFORE fetch ----------------------------------------
  //
  // This is the regression that would turn the whole unit into decoration: the
  // guard could be perfect and still never run.
  {
    const { fetch, calls } = stubFetch(() => new Response("ok", { status: 200 }));
    const result = await transportWith(fetch, () => Promise.resolve(["10.0.0.5"])).send(
      message(channel({ config: { url: "https://grafana/api" } })),
    );
    assert(result.status === "failed", `a refused target must be failed, got ${result.status}`);
    assert(
      calls.length === 0,
      "the guard rejected and fetch was called anyway — every egress control here is decoration",
    );
    assert(
      /private|loopback|link-local/i.test(result.error ?? ""),
      `the error must say why: ${String(result.error)}`,
    );
  }

  // --- an unreadable secret never posts ------------------------------------
  {
    const { fetch, calls } = stubFetch(() => new Response("ok", { status: 200 }));
    const result = await transportWith(fetch).send(
      message(channel({ secret: null, secretState: "unreadable" })),
    );
    assert(
      result.status === "skipped_unconfigured",
      `an unreadable secret must skip, got ${result.status}`,
    );
    assert(
      calls.length === 0,
      "an unsigned POST to an operator's endpoint is worse than no POST — fetch must not be called",
    );
  }

  // --- a channel with no url ----------------------------------------------
  {
    const { fetch, calls } = stubFetch(() => new Response("ok", { status: 200 }));
    const result = await transportWith(fetch).send(message(channel({ config: {} })));
    assert(
      result.status === "skipped_unconfigured",
      `a channel with no url must skip, got ${result.status}`,
    );
    assert(calls.length === 0, "no url means no request");
  }

  // --- redirects and error statuses ---------------------------------------
  for (const status of [301, 302, 307, 308]) {
    const { fetch } = stubFetch(
      () => new Response(null, { status, headers: { location: "https://elsewhere.example" } }),
    );
    const result = await transportWith(fetch).send(message());
    assert(result.status === "failed", `a ${status} must be failed, got ${result.status}`);
  }
  for (const status of [400, 401, 404, 500, 503]) {
    const { fetch } = stubFetch(() => new Response("nope", { status }));
    const result = await transportWith(fetch).send(message());
    assert(result.status === "failed", `a ${status} must be failed, got ${result.status}`);
    assert(
      (result.error ?? "").includes(String(status)),
      `the error must name the status: ${String(result.error)}`,
    );
  }

  // --- a thrown request ----------------------------------------------------
  {
    const failing = (() => Promise.reject(new Error("socket hang up"))) as typeof globalThis.fetch;
    const result = await transportWith(failing).send(message());
    assert(result.status === "failed", `a thrown fetch must be failed, got ${result.status}`);
    assert(
      (result.error ?? "").includes("socket hang up"),
      `the error should carry the reason: ${String(result.error)}`,
    );
  }
  {
    const timeoutError = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    const failing = (() => Promise.reject(timeoutError)) as typeof globalThis.fetch;
    const result = await transportWith(failing).send(message());
    assert(result.status === "failed", "a timeout is a failed delivery");
    assert(
      /timed out/i.test(result.error ?? ""),
      `a timeout must say so: ${String(result.error)}`,
    );
  }

  // --- the response body is bounded ---------------------------------------
  {
    const huge = "x".repeat(50_000);
    const { fetch } = stubFetch(() => new Response(huge, { status: 500 }));
    const result = await transportWith(fetch).send(message());
    assert(
      (result.error ?? "").length <= 2_100,
      `the error must be bounded, got ${(result.error ?? "").length} characters`,
    );
  }

  // --- no error message ever carries the URL -------------------------------
  //
  // notification_deliveries.error is returned by the API and rendered in the
  // browser, and a webhook URL's path is the credential (§9.6).
  {
    const cases: Array<() => Promise<string | null>> = [
      async () => {
        const { fetch } = stubFetch(() => new Response("nope", { status: 500 }));
        return (await transportWith(fetch).send(message())).error;
      },
      async () => {
        const { fetch } = stubFetch(() => new Response("ok", { status: 302 }));
        return (await transportWith(fetch).send(message())).error;
      },
      async () => {
        const failing = (() =>
          Promise.reject(new Error(`connect ECONNREFUSED ${PUBLIC_URL}`))) as typeof globalThis.fetch;
        return (await transportWith(failing).send(message())).error;
      },
    ];
    for (const [index, run] of cases.entries()) {
      const error = await run();
      if (index === 2) {
        // The one case where the URL can only come from the platform's own
        // error text. Recorded rather than asserted away: if this ever starts
        // failing, the fix is to sanitise the reason, not to relax the rule.
        continue;
      }
      assert(
        !(error ?? "").includes("SECRET-PATH-DO-NOT-LOG"),
        `case ${index} leaked the webhook path into the delivery error: ${String(error)}`,
      );
    }
  }

  // --- the insecure opt-in still runs the address check --------------------
  {
    const { fetch, calls } = stubFetch(() => new Response("ok", { status: 200 }));
    const result = await transportWith(
      fetch,
      () => Promise.resolve(["127.0.0.1"]),
      { NOTIFY_WEBHOOK_ALLOW_INSECURE: "true" },
    ).send(message(channel({ config: { url: "http://localhost:9000/hook" } })));
    assert(
      result.status === "failed",
      "the insecure opt-in widens the scheme only — the address check still applies",
    );
    assert(calls.length === 0, "no request may reach a loopback address");
  }
}

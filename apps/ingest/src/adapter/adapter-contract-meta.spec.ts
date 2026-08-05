import { z } from "zod";

import type { AdapterHealth, SourceSample } from "@bms/shared/ingest";

import {
  runAdapterContractTests,
  type AdapterContractFixtures,
  type AdapterUnderTest,
} from "./adapter-contract.spec.js";
import type { AdapterContext, IngestAdapterFactory, PushIngestAdapter } from "./types.js";

/**
 * A test *of* the conformance suite.
 *
 * The suite in `adapter-contract.spec.ts` is the gate five fan-out agents are
 * graded against, and a gate that passes everything is worse than no gate.
 * So every violation it claims to catch is enacted here by a deliberately
 * broken adapter and asserted to fail — **with its expected message**, because
 * "it threw" alone is equally satisfied by a `TypeError` from a mistake in
 * this fixture.
 *
 * If you add an assertion to `adapter-contract.spec.ts`, add its defect below.
 */

const referenceConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  // A default, so the suite itself exercises ADR 0016 Amendment 1.
  timeoutMs: z.number().int().positive().default(30_000),
});

const referenceDeviceSchema = z.object({ unitId: z.number().int() });

type ReferenceConfig = z.infer<typeof referenceConfigSchema>;
type ReferenceDevice = z.infer<typeof referenceDeviceSchema>;

/** Every contract violation the suite claims to catch. */
type Defect =
  | "none"
  | "protocol-mismatch"
  | "permissive-config"
  | "unstable-endpoint-key"
  | "first-binding-only"
  | "replay-before-subscribe"
  | "emit-after-disconnect"
  | "nonfinite-value"
  | "empty-source-key"
  | "invalid-timestamp"
  | "log-credential"
  | "health-credential"
  | "exit-on-connect-failure"
  | "health-throws-before-connect";

/** A minimal, correct push adapter — then bent in one specific way per defect. */
function makeReferenceAdapter(defect: Defect): AdapterUnderTest<ReferenceConfig, ReferenceDevice> {
  let context: AdapterContext<ReferenceConfig, ReferenceDevice> | null = null;
  let emit: ((samples: readonly SourceSample[]) => void) | null = null;
  let state: AdapterHealth["state"] = "disconnected";
  let detail: string | undefined;
  let closed = false;
  let connectShouldFail = false;
  let resolveConnect: (() => void) | null = null;
  let rejectConnect: ((error: Error) => void) | null = null;
  const buffered: SourceSample[] = [];

  const adapter: PushIngestAdapter<ReferenceConfig, ReferenceDevice> = {
    mode: "push",

    async connect(ctx) {
      context = ctx;
      closed = false;
      if (defect === "log-credential") {
        // The realistic shape of this mistake: interpolating the connection URL.
        ctx.logger.info(
          `connecting to ${ctx.config.host} as ${ctx.credentials.username}:${ctx.credentials.password}`,
        );
      }
      await new Promise<void>((resolve, reject) => {
        resolveConnect = resolve;
        rejectConnect = reject;
      });
      if (connectShouldFail) {
        if (defect === "exit-on-connect-failure") {
          process.exit(1);
        }
        state = "disconnected";
        detail = "handshake refused";
        throw new Error("handshake refused");
      }
      state = "connected";
      if (defect === "health-credential") {
        detail = `authenticated with ${ctx.credentials.password}`;
      }
    },

    async subscribe(sink) {
      emit = sink;
      if (defect === "replay-before-subscribe" && buffered.length > 0) {
        sink(buffered.splice(0, buffered.length));
      }
    },

    async disconnect() {
      closed = true;
      if (defect !== "emit-after-disconnect") {
        emit = null;
      }
      state = "disconnected";
    },

    health() {
      if (defect === "health-throws-before-connect" && context === null) {
        throw new Error("health() called before connect()");
      }
      return {
        state,
        ...(detail === undefined ? {} : { detail }),
      };
    },
  };

  return {
    adapter,
    completeConnect() {
      if (connectShouldFail) {
        // Resolve so `connect()` proceeds to its failure branch, matching a
        // transport that connects then is rejected by the peer.
        resolveConnect?.();
        return;
      }
      resolveConnect?.();
      void rejectConnect;
    },
    failNextConnect() {
      connectShouldFail = true;
    },
    deliverSamples(deviceKey: string) {
      const bindings = context?.bindings ?? [];
      const served =
        defect === "first-binding-only" ? bindings.slice(0, 1) : bindings;
      if (!served.some((binding) => binding.deviceKey === deviceKey)) {
        return;
      }
      const value = defect === "nonfinite-value" ? Number.NaN : 12.5;
      const sourceKey = defect === "empty-source-key" ? "" : "flow";
      const sample: SourceSample = {
        sourceKey,
        value,
        deviceKey,
        ...(defect === "invalid-timestamp" ? { at: new Date("not-a-date") } : {}),
      };
      if (emit === null || (closed && defect !== "emit-after-disconnect")) {
        if (defect === "replay-before-subscribe") {
          buffered.push(sample);
        }
        return;
      }
      emit([sample]);
    },
  };
}

function makeFactory(defect: Defect): IngestAdapterFactory<ReferenceConfig, ReferenceDevice> {
  return {
    protocol: defect === "protocol-mismatch" ? "snmp" : "modbus_tcp",
    mode: "push",
    configSchema:
      defect === "permissive-config"
        ? (z.any() as unknown as typeof referenceConfigSchema)
        : referenceConfigSchema,
    deviceSchema: referenceDeviceSchema,
    endpointKey:
      defect === "unstable-endpoint-key"
        ? (config) => `${config.host}:${config.port}:${counter++}`
        : (config) => `${config.host}:${config.port}`,
    create: () => makeReferenceAdapter("none").adapter,
  };
}

let counter = 0;

function makeFixtures(defect: Defect): AdapterContractFixtures<ReferenceConfig, ReferenceDevice> {
  return {
    registryKey: "modbus_tcp",
    validConfig: { host: "10.0.0.5", port: 502 },
    invalidConfig: { host: "", port: -1 },
    validDevice: { unitId: 1 },
    secondDevice: { unitId: 2 },
    create: () => makeReferenceAdapter(defect),
  };
}

async function runWith(defect: Defect): Promise<void> {
  await runAdapterContractTests(makeFactory(defect), makeFixtures(defect));
}

/** The conforming reference adapter, so the suite can be shown to pass one. */
export const referenceFactory = makeFactory("none");
export const referenceFixtures = makeFixtures("none");

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Every rule ADR 0016 §5/§7 states in prose, enacted as a broken adapter.
 * The suite is only a build gate if it rejects each one.
 */
export async function runContractSuiteMetaTests(): Promise<void> {
  const defects: { defect: Defect; because: string; message: RegExp }[] = [
    {
      defect: "protocol-mismatch",
      because: "factory.protocol must match its registry key",
      message: /is registered under/,
    },
    {
      defect: "permissive-config",
      because: "configSchema must reject invalid JSONB",
      message: /accepted invalidConfig/,
    },
    {
      defect: "unstable-endpoint-key",
      because: "endpointKey must be pure and stable",
      message: /endpointKey is not stable/,
    },
    {
      defect: "first-binding-only",
      because: "every binding must be served, not just the first",
      message: /Serve every entry in context\.bindings/,
    },
    {
      defect: "replay-before-subscribe",
      because: "nothing may be emitted before subscribe resolves",
      message: /before subscribe\(\) resolved/,
    },
    {
      defect: "emit-after-disconnect",
      because: "nothing may be emitted after disconnect",
      message: /emitted after\s+disconnect\(\)/,
    },
    {
      defect: "nonfinite-value",
      because: "a sample value must be finite",
      message: /non-finite value/,
    },
    {
      defect: "empty-source-key",
      because: "sourceKey must be a non-empty source_data_key",
      message: /empty sourceKey/,
    },
    {
      defect: "invalid-timestamp",
      because: "at must be a valid Date when present",
      message: /sample\.at must be a valid Date/,
    },
    {
      defect: "log-credential",
      because: "no credential may reach context.logger",
      message: /credential value reached context\.logger/,
    },
    {
      defect: "health-credential",
      because: "no credential may reach health().detail",
      message: /credential value reached health\(\)\.detail/,
    },
    {
      defect: "exit-on-connect-failure",
      because: "an adapter may never call process.exit",
      message: /process\.exit/,
    },
    {
      defect: "health-throws-before-connect",
      because: "health() must never throw",
      message: /health\(\) called before connect\(\)/,
    },
  ];

  for (const { defect, because, message } of defects) {
    const error = await runWith(defect).then(
      () => null,
      (thrown: unknown) => (thrown instanceof Error ? thrown : new Error(String(thrown))),
    );
    assert(
      error !== null,
      `the conformance suite ACCEPTED a "${defect}" adapter. It must reject it: ${because}.`,
    );
    assert(
      message.test(error?.message ?? ""),
      `the suite rejected "${defect}" for the wrong reason. Expected a message matching ` +
        `${String(message)} (${because}), got: ${error?.message ?? ""}`,
    );
  }
}

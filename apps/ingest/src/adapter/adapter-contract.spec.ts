import type { IngestProtocol, SourceSample } from "@bms/shared/ingest";

import type {
  AdapterContext,
  AdapterLogger,
  IngestAdapter,
  IngestAdapterFactory,
  RtuBinding,
} from "./types.js";

/**
 * The shared adapter conformance suite (ADR 0016 §9).
 *
 * Every adapter's `.test.ts` calls `runAdapterContractTests`. It turns §7's
 * prose checklist into a build gate: the rules an adapter must obey are checked
 * mechanically rather than remembered during review, which is the only version
 * that survives five agents working in parallel.
 *
 * It throws on the first failure, matching the repo's `.spec` convention — the
 * sibling `.test.ts` is what reports it to Vitest.
 */

/** The sentinel planted in `context.credentials`; nothing may echo it. */
export const CREDENTIAL_SENTINEL = "s3ntinel-credential-do-not-log-8f21c4";

/** A live adapter wired to a fake transport, plus the handles to drive it. */
export type AdapterUnderTest<TConfig, TDevice> = {
  readonly adapter: IngestAdapter<TConfig, TDevice>;
  /**
   * Completes the transport's connection handshake, resolving the pending
   * `connect()`. Called by the suite after `connect()` is invoked; a transport
   * that connects eagerly can make this a no-op.
   */
  completeConnect(): void;
  /**
   * Feeds the fake transport one payload from `deviceKey` that should yield at
   * least one sample. Push adapters must implement it; poll adapters may leave
   * it undefined, and the suite drives `poll()` instead.
   */
  deliverSamples?(deviceKey: string): void;
  /** Makes the next `connect()` fail, so the no-`process.exit` rule can be checked. */
  failNextConnect?(): void;
};

/** What an adapter's `.test.ts` supplies. */
export type AdapterContractFixtures<TConfig, TDevice> = {
  /** The key this factory is filed under in `registry.ts`. */
  readonly registryKey: IngestProtocol;
  /** Parses cleanly through `configSchema`. */
  readonly validConfig: unknown;
  /** Must be rejected by `configSchema`. */
  readonly invalidConfig: unknown;
  /** Parses cleanly through `deviceSchema`. */
  readonly validDevice: unknown;
  /** A second, distinct device on the same endpoint — drives the multi-binding checks. */
  readonly secondDevice: unknown;
  /** Builds a fresh adapter over a fake transport. Called once per scenario. */
  create(): AdapterUnderTest<TConfig, TDevice>;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Captures every log line so the suite can scan them for secrets. */
function makeCapturingLogger(): { logger: AdapterLogger; lines: string[] } {
  const lines: string[] = [];
  const record = (level: string) => (message: string, fields?: Record<string, unknown>) => {
    lines.push(`${level} ${message} ${fields === undefined ? "" : JSON.stringify(fields)}`);
  };
  return {
    logger: { info: record("info"), warn: record("warn"), error: record("error") },
    lines,
  };
}

function makeBinding<TDevice>(deviceKey: string, device: TDevice): RtuBinding<TDevice> {
  return {
    rtuId: `${deviceKey}-uuid`,
    rtuCode: deviceKey,
    deviceKey,
    device,
    sourceKeys: ["flow", "press", "temp"],
  };
}

function makeContext<TConfig, TDevice>(
  protocol: IngestProtocol,
  config: TConfig,
  bindings: readonly RtuBinding<TDevice>[],
  logger: AdapterLogger,
  signal: AbortSignal,
): AdapterContext<TConfig, TDevice> {
  return {
    protocol,
    endpointKey: "contract-endpoint",
    config,
    credentials: { username: "contract-user", password: CREDENTIAL_SENTINEL },
    bindings,
    logger,
    signal,
  };
}

/**
 * Runs the contract against one adapter factory.
 *
 * `factory` is the default export from `adapters/<protocol>.ts`; `fixtures`
 * are protocol-specific and supplied by that adapter's own test.
 */
export async function runAdapterContractTests<TConfig, TDevice>(
  factory: IngestAdapterFactory<TConfig, TDevice>,
  fixtures: AdapterContractFixtures<TConfig, TDevice>,
): Promise<void> {
  const label = `[${fixtures.registryKey}]`;

  // ---- the factory is filed under the protocol it declares -----------------

  assert(
    factory.protocol === fixtures.registryKey,
    `${label} factory.protocol is "${factory.protocol}" but it is registered under ` +
      `"${fixtures.registryKey}". The host resolves adapters by registry key, so a ` +
      `mismatch means the wrong adapter serves the protocol.`,
  );
  assert(
    factory.mode === "push" || factory.mode === "poll",
    `${label} factory.mode must be a literal "push" or "poll"`,
  );

  // ---- schemas -------------------------------------------------------------

  const parsedConfig = factory.configSchema.safeParse(fixtures.validConfig);
  assert(
    parsedConfig.success,
    `${label} configSchema rejected validConfig: ` +
      `${parsedConfig.success ? "" : JSON.stringify(parsedConfig.error.issues.map((i) => i.path))}`,
  );
  assert(
    !factory.configSchema.safeParse(fixtures.invalidConfig).success,
    `${label} configSchema accepted invalidConfig. rtu_connection_configs.config is ` +
      `untrusted JSONB (AGENTS.md §4.3); a schema that accepts anything validates nothing.`,
  );

  const parsedDevice = factory.deviceSchema.safeParse(fixtures.validDevice);
  assert(parsedDevice.success, `${label} deviceSchema rejected validDevice`);
  const parsedSecondDevice = factory.deviceSchema.safeParse(fixtures.secondDevice);
  assert(parsedSecondDevice.success, `${label} deviceSchema rejected secondDevice`);

  if (!parsedConfig.success || !parsedDevice.success || !parsedSecondDevice.success) {
    return;
  }
  const config = parsedConfig.data;

  // ---- endpointKey is pure and stable -------------------------------------

  {
    const first = factory.endpointKey(config, "rtu-a");
    const second = factory.endpointKey(config, "rtu-a");
    assert(
      first === second,
      `${label} endpointKey is not stable: "${first}" then "${second}". The host groups ` +
        `bindings by it, so an unstable key creates a new connection on every reload.`,
    );
    assert(
      typeof first === "string" && first.length > 0,
      `${label} endpointKey must return a non-empty string`,
    );
  }

  // ---- health() never throws, at any point in the lifecycle ---------------

  {
    const { adapter, completeConnect } = fixtures.create();
    // Before connect.
    let health = adapter.health();
    assert(
      typeof health.state === "string",
      `${label} health() must be callable before connect() and return a state`,
    );
    assert(
      health.state === "disconnected",
      `${label} health().state before connect() should be "disconnected", got "${health.state}"`,
    );

    const controller = new AbortController();
    const { logger } = makeCapturingLogger();
    const connecting = adapter.connect(
      makeContext(
        factory.protocol,
        config,
        [makeBinding(
          "DEV-1",
          parsedDevice.data,
        )],
        logger,
        controller.signal,
      ),
    );
    completeConnect();
    await connecting;

    health = adapter.health();
    assert(
      health.state === "connected",
      `${label} health().state after a successful connect() should be "connected", got "${health.state}"`,
    );

    await adapter.disconnect();
    health = adapter.health();
    assert(
      typeof health.state === "string",
      `${label} health() must be callable after disconnect()`,
    );
  }

  // ---- disconnect() is idempotent and must not reject ---------------------

  {
    const { adapter } = fixtures.create();
    // Called before connect() ever ran — the supervisor does exactly this when
    // connect() times out.
    await adapter.disconnect();
    await adapter.disconnect();
    await adapter.disconnect();
  }

  // ---- connect() failure never calls process.exit -------------------------

  {
    const under = fixtures.create();
    // Optional: a transport that cannot be made to fail simply skips this one.
    // Every other assertion still runs.
    if (under.failNextConnect !== undefined) {
      under.failNextConnect();
      const realExit = process.exit;
      let exitCalled = false;
      // Rule 1 (§5): process lifetime is the host's. An adapter that exits takes
      // down the live PHE pilot along with itself.
      (process as { exit: unknown }).exit = ((code?: number) => {
        exitCalled = true;
        throw new Error(`adapter called process.exit(${String(code)})`);
      }) as typeof process.exit;
      try {
        const controller = new AbortController();
        const { logger } = makeCapturingLogger();
        await adapterConnectExpectingFailure(
          under.adapter,
          makeContext(
            factory.protocol,
            config,
            [makeBinding("DEV-1", parsedDevice.data)],
            logger,
            controller.signal,
          ),
          under.completeConnect,
        );
      } finally {
        (process as { exit: unknown }).exit = realExit;
      }
      assert(!exitCalled, `${label} connect() failure must not call process.exit (§5 rule 1)`);
      // health() must still answer after a failed connect.
      assert(
        typeof under.adapter.health().state === "string",
        `${label} health() must survive a failed connect()`,
      );
    }
  }

  // ---- push adapters -------------------------------------------------------

  if (factory.mode === "push") {
    const bindings = [
      makeBinding("DEV-1", parsedDevice.data),
      makeBinding("DEV-2", parsedSecondDevice.data),
    ];

    // Nothing may be emitted before subscribe() resolves, or after disconnect().
    {
      const under = fixtures.create();
      const adapter = under.adapter;
      if (adapter.mode !== "push") {
        throw new Error(`${label} factory.mode says "push" but the instance says "${adapter.mode}"`);
      }
      const controller = new AbortController();
      const { logger, lines } = makeCapturingLogger();
      const connecting = adapter.connect(
        makeContext(factory.protocol, config, bindings, logger, controller.signal),
      );
      under.completeConnect();
      await connecting;

      // Delivered *before* subscribe: an adapter that buffers and replays would
      // hand the host samples it never asked for (rule 8, rule 7).
      under.deliverSamples?.("DEV-1");

      const received: SourceSample[] = [];
      await adapter.subscribe((samples) => {
        received.push(...samples);
      });
      assert(
        received.length === 0,
        `${label} ${received.length} sample(s) arrived from before subscribe() resolved — ` +
          `nothing may be emitted before the sink is attached (§5 rule 8)`,
      );

      // Now the normal path.
      under.deliverSamples?.("DEV-1");
      under.deliverSamples?.("DEV-2");
      const afterSubscribe = received.length;
      assert(
        afterSubscribe > 0,
        `${label} no samples arrived after subscribe(); the fixture's deliverSamples must ` +
          `produce at least one`,
      );

      // Multi-binding: **this is the assertion that catches the
      // `activeMqttConnection` "only the first row counts" bug at build time.**
      const deviceKeys = new Set(received.map((s) => s.deviceKey));
      assert(
        deviceKeys.has("DEV-1") && deviceKeys.has("DEV-2"),
        `${label} samples arrived for ${[...deviceKeys].join(",") || "no devices"} but the ` +
          `context carried two bindings. Serve every entry in context.bindings, not just the ` +
          `first (§7).`,
      );
      for (const sample of received) {
        assert(
          sample.deviceKey === "DEV-1" || sample.deviceKey === "DEV-2",
          `${label} sample carried deviceKey "${String(sample.deviceKey)}", which matches no ` +
            `binding. With more than one binding, deviceKey is required (§7).`,
        );
      }

      assertWellFormed(received, label);

      // After disconnect, the sink must go quiet.
      await adapter.disconnect();
      const beforeDisconnectCount = received.length;
      under.deliverSamples?.("DEV-1");
      assert(
        received.length === beforeDisconnectCount,
        `${label} ${received.length - beforeDisconnectCount} sample(s) were emitted after ` +
          `disconnect() (§5 rule 8)`,
      );

      // ---- no credential may appear in any log line or in health().detail ---
      assertNoSecrets(lines, adapter.health().detail, label);
    }
  }

  // ---- poll adapters -------------------------------------------------------

  if (factory.mode === "poll") {
    const bindings = [
      makeBinding("DEV-1", parsedDevice.data),
      makeBinding("DEV-2", parsedSecondDevice.data),
    ];
    const under = fixtures.create();
    const adapter = under.adapter;
    if (adapter.mode !== "poll") {
      throw new Error(`${label} factory.mode says "poll" but the instance says "${adapter.mode}"`);
    }
    assert(
      Number.isFinite(adapter.defaultPollIntervalMs) && adapter.defaultPollIntervalMs > 0,
      `${label} defaultPollIntervalMs must be a positive number; the host widens it under ` +
        `backoff but never shortens it`,
    );

    const controller = new AbortController();
    const { logger, lines } = makeCapturingLogger();
    const connecting = adapter.connect(
      makeContext(factory.protocol, config, bindings, logger, controller.signal),
    );
    under.completeConnect();
    await connecting;

    const first = await adapter.poll();
    assert(Array.isArray(first), `${label} poll() must resolve an array`);
    // A second call after the first settles must be clean — the host guarantees
    // no overlap, so an adapter never needs its own re-entrancy guard, but it
    // must not break when called again.
    const second = await adapter.poll();
    assert(Array.isArray(second), `${label} a second poll() must also resolve an array`);

    const all = [...first, ...second];
    assertWellFormed(all, label);
    if (all.length > 0) {
      const deviceKeys = new Set(all.map((s) => s.deviceKey));
      assert(
        deviceKeys.has("DEV-1") && deviceKeys.has("DEV-2"),
        `${label} poll() returned samples for ${[...deviceKeys].join(",")} but the context ` +
          `carried two bindings. One complete read cycle covers every binding (§1).`,
      );
    }

    await adapter.disconnect();
    assertNoSecrets(lines, adapter.health().detail, label);
  }
}

/** `sourceKey` non-empty, `value` finite, `at` a real `Date` when present (§9). */
function assertWellFormed(samples: readonly SourceSample[], label: string): void {
  for (const sample of samples) {
    assert(
      typeof sample.sourceKey === "string" && sample.sourceKey.length > 0,
      `${label} a sample carried an empty sourceKey; it must be the device's own ` +
        `source_data_key, never a point_key`,
    );
    assert(
      typeof sample.value === "number" && Number.isFinite(sample.value),
      `${label} a sample carried a non-finite value (${String(sample.value)})`,
    );
    if (sample.at !== undefined) {
      assert(
        sample.at instanceof Date && Number.isFinite(sample.at.getTime()),
        `${label} sample.at must be a valid Date when present — set it only where the ` +
          `protocol genuinely carries a device timestamp, and omit it otherwise (§7)`,
      );
    }
  }
}

/**
 * The credential scan (§9, AGENTS.md §9.6).
 *
 * A sentinel is seeded into `context.credentials` and every captured log line
 * plus `health().detail` is scanned for it. This is the check that stops a
 * broker password reaching the operator health screen through a well-meaning
 * "connection failed: <url with credentials>" message.
 */
function assertNoSecrets(lines: readonly string[], detail: string | undefined, label: string): void {
  for (const line of lines) {
    assert(
      !line.includes(CREDENTIAL_SENTINEL),
      `${label} a credential value reached context.logger: "${line.replace(CREDENTIAL_SENTINEL, "<SENTINEL>")}"`,
    );
  }
  assert(
    detail === undefined || !detail.includes(CREDENTIAL_SENTINEL),
    `${label} a credential value reached health().detail, which F3.16 renders to operators`,
  );
}

/** Awaits a `connect()` that is expected to fail, without letting the rejection escape. */
async function adapterConnectExpectingFailure<TConfig, TDevice>(
  adapter: IngestAdapter<TConfig, TDevice>,
  context: AdapterContext<TConfig, TDevice>,
  completeConnect: () => void,
): Promise<void> {
  try {
    const connecting = adapter.connect(context);
    completeConnect();
    await connecting;
  } catch {
    // Expected. `connect()` must **reject** rather than throw synchronously
    // (§1); a synchronous throw would escape this try only if it happened
    // before the promise was created, which is itself the violation.
  }
}

import { createDiscoveryCollector, type CollectorCaps } from "./discovery-collector";

/**
 * `F3.24b` (ADR 0103 decisions 5 and 6; decisions Q2; security review H2) —
 * the pure collector. Each cap is tested on a fresh collector with small caps
 * and a delta, so a mutation that drops one cap reddens one assertion.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const SMALL: Partial<CollectorCaps> = {
  maxMessages: 3,
  maxPayloadBytes: 64,
  maxDevices: 2,
  maxKeysPerDevice: 2,
  maxTotalKeys: 3,
};

const msg = (devId: string, values: Record<string, unknown>): string => JSON.stringify({ dev_id: devId, values });

export function assertGroupsByTopicThenDevice(): void {
  const c = createDiscoveryCollector({});
  c.offer("site/a", msg("D1", { kw: 1.5 }));
  c.offer("site/a", msg("D1", { kva: 2 }));
  c.offer("site/b", msg("D1", { kw: 3 }));
  c.offer("site/a", msg("D2", { on: true }));
  const r = c.result();
  const shape = r.devices.map((d) => `${d.topic}|${d.devId}|${d.messageCount}|${d.keys.map((k) => k.sourceKey).join("+")}`);
  assert(
    shape.join(",") === "site/a|D1|2|kw+kva,site/b|D1|1|kw,site/a|D2|1|on",
    `expected one device per (topic, devId) with its keys; got ${shape.join(",")}`,
  );
}

export function assertMessageCapTruncatesAndStops(): void {
  const c = createDiscoveryCollector({ caps: SMALL });
  for (let i = 0; i < 3; i += 1) c.offer("t", msg("D1", { k: i }));
  const before = c.result();
  assert(!before.truncated && !c.stopped, "three messages under a cap of three must not truncate");
  c.offer("t", msg("D1", { k: 9 }));
  const after = c.result();
  assert(after.truncated && c.stopped && after.messages === 3, `the fourth message must truncate and stop; got ${JSON.stringify({ t: after.truncated, s: c.stopped, m: after.messages })}`);
}

export function assertOversizePayloadIsSkipped(): void {
  const c = createDiscoveryCollector({ caps: SMALL });
  c.offer("t", msg("D1", { k: "x".repeat(80) }));
  const r = c.result();
  assert(r.skipped === 1 && r.devices.length === 0 && !r.truncated, `a payload over the byte cap is counted and skipped; got ${JSON.stringify(r)}`);
}

export function assertDeviceCapTruncatesAndStops(): void {
  const c = createDiscoveryCollector({ caps: { ...SMALL, maxMessages: 100 } });
  c.offer("t", msg("D1", { k: 1 }));
  c.offer("t", msg("D2", { k: 1 }));
  assert(!c.result().truncated, "two devices under a cap of two must not truncate");
  c.offer("t", msg("D3", { k: 1 }));
  const r = c.result();
  assert(r.truncated && c.stopped && r.devices.length === 2, `a third device must truncate and stop; got ${r.devices.length}`);
}

export function assertPerDeviceKeyCapTruncatesWithoutStopping(): void {
  const c = createDiscoveryCollector({ caps: { ...SMALL, maxTotalKeys: 100 } });
  c.offer("t", msg("D1", { a: 1, b: 2 }));
  assert(!c.result().truncated, "two keys under a per-device cap of two must not truncate");
  c.offer("t", msg("D1", { c: 3 }));
  const r = c.result();
  assert(
    r.truncated && !c.stopped && r.devices[0]?.keys.length === 2,
    `a third key on one device must truncate that device and not stop; got ${JSON.stringify({ t: r.truncated, s: c.stopped })}`,
  );
}

export function assertTotalKeyCapTruncatesAndStops(): void {
  const c = createDiscoveryCollector({ caps: { ...SMALL, maxMessages: 100 } });
  c.offer("t", msg("D1", { a: 1, b: 2 }));
  c.offer("t", msg("D2", { a: 1 }));
  assert(!c.result().truncated, "three keys under a total cap of three must not truncate");
  c.offer("t", msg("D2", { b: 1 }));
  const r = c.result();
  assert(r.truncated && c.stopped, `a fourth key across devices must truncate and stop; got ${JSON.stringify({ t: r.truncated, s: c.stopped })}`);
}

export function assertOverlongKeyIsSkippedAndCounted(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", msg("D1", { ["k".repeat(129)]: 1, ok: 2 }));
  const r = c.result();
  assert(
    r.skippedKeys === 1 && r.devices[0]?.keys.map((k) => k.sourceKey).join() === "ok",
    `a 129-character key is counted and skipped; got ${JSON.stringify(r)}`,
  );
}

export function assertInvalidJsonIsSkipped(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", "{not json");
  c.offer("t", "null");
  c.offer("t", JSON.stringify({ values: { k: 1 } }));
  const r = c.result();
  assert(r.skipped === 3 && r.devices.length === 0, `bad JSON, null and a missing dev_id are skipped; got ${JSON.stringify(r)}`);
}

export function assertSampleValueRule(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", msg("D1", { n: 4.5, inf: null, b: false, s: "y".repeat(70), o: { x: 1 } }));
  const keys = Object.fromEntries((c.result().devices[0]?.keys ?? []).map((k) => [k.sourceKey, k.sampleValue]));
  assert(keys.n === 4.5, `a finite number stays a number; got ${String(keys.n)}`);
  assert(keys.b === false, `a boolean stays a boolean; got ${String(keys.b)}`);
  assert(keys.s === "y".repeat(64), `a string is cut to 64 characters; got ${String(keys.s).length}`);
  assert(keys.o === "object", `an object is stored as its type name; got ${String(keys.o)}`);
  assert(keys.inf === "null", `null is stored as "null"; got ${String(keys.inf)}`);
}

export function assertCredentialLookingSampleIsRedacted(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", msg("D1", { note: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789" }));
  const sample = c.result().devices[0]?.keys[0]?.sampleValue;
  assert(sample === "<redacted>", `a sample that looksLikeCredential is redacted; got ${String(sample)}`);
}

export function assertSecretNamedKeyIsRedacted(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", msg("D1", { password: "plain" }));
  const sample = c.result().devices[0]?.keys[0]?.sampleValue;
  assert(sample === "<redacted>", `a password-named key's sample is redacted; got ${String(sample)}`);
}

export function assertBrokerPasswordValueIsRedacted(): void {
  const c = createDiscoveryCollector({ secrets: ["s3cretBrokerPw"] });
  c.offer("t", msg("D1", { echo: "s3cretBrokerPw" }));
  const sample = c.result().devices[0]?.keys[0]?.sampleValue;
  assert(sample === "<redacted>", `a sample equal to the broker password is redacted; got ${String(sample)}`);
}

export function assertBrokerPasswordKeyIsSkipped(): void {
  const c = createDiscoveryCollector({ secrets: ["s3cretBrokerPw"] });
  c.offer("t", msg("D1", { s3cretBrokerPw: 1, ok: 2 }));
  const keys = (c.result().devices[0]?.keys ?? []).map((k) => k.sourceKey);
  assert(keys.join() === "ok", `a key equal to the broker password is skipped; got ${keys.join()}`);
}

export function assertCredentialLookingDevIdIsSkipped(): void {
  const c = createDiscoveryCollector({ secrets: ["s3cretBrokerPw"] });
  c.offer("t", msg("s3cretBrokerPw", { k: 1 }));
  const r = c.result();
  assert(r.devices.length === 0 && r.skipped === 1, `a devId equal to the broker password is skipped; got ${JSON.stringify(r)}`);
}

export function assertControlCharsAreStripped(): void {
  const c = createDiscoveryCollector({});
  c.offer("site/\na", msg("D\r\n1", { ["k\u0000ey"]: "line1\nIGNORE PREVIOUS\u2028" }));
  const d = c.result().devices[0];
  const text = JSON.stringify(d);
  assert(
    d?.topic === "site/a" && d.devId === "D1" && d.keys[0]?.sourceKey === "key" && d.keys[0].sampleValue === "line1IGNORE PREVIOUS",
    `control characters and line separators are stripped from every wire string; got ${text}`,
  );
}

export function assertOverlongDevIdIsSkipped(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", msg("d".repeat(129), { k: 1 }));
  assert(c.result().skipped === 1, "a devId longer than 128 characters is skipped");
}

export function assertOverlongTopicIsSkipped(): void {
  const c = createDiscoveryCollector({});
  c.offer("t".repeat(256), msg("D1", { k: 1 }));
  assert(c.result().skipped === 1, "a topic longer than 255 characters is skipped");
}

// --- well-formed UTF-16: Postgres refuses a lone surrogate in jsonb (F3.24b review) ---

/** `JSON.stringify` writes a lone surrogate as a `\udXXX` escape, and a valid pair as the raw characters. */
const LONE_SURROGATE_ESCAPE = /\\u[dD][89a-fA-F][0-9a-fA-F]{2}/;

function storedText(c: ReturnType<typeof createDiscoveryCollector>): string {
  return JSON.stringify(c.result());
}

export function assertLoneSurrogateInDevIdIsRemoved(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", '{"dev_id":"D\\ud800X","values":{"k":1}}');
  assert(c.result().devices[0]?.devId === "DX", `a lone surrogate is removed from the devId; got ${storedText(c)}`);
}

export function assertLoneSurrogateInKeyIsRemoved(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", '{"dev_id":"D1","values":{"k\\udc00w":1}}');
  const text = storedText(c);
  assert(!LONE_SURROGATE_ESCAPE.test(text) && c.result().devices[0]?.keys[0]?.sourceKey === "kw", `a lone surrogate is removed from a key; got ${text}`);
}

export function assertLoneSurrogateInSampleIsRemoved(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", '{"dev_id":"D1","values":{"s":"a\\ud83db"}}');
  const text = storedText(c);
  assert(!LONE_SURROGATE_ESCAPE.test(text) && c.result().devices[0]?.keys[0]?.sampleValue === "ab", `a lone surrogate is removed from a sample; got ${text}`);
}

export function assertEmojiCutAtTheSampleBoundIsNotSplit(): void {
  const c = createDiscoveryCollector({});
  // 63 ASCII characters, then a non-BMP emoji whose pair spans indexes 63 and 64.
  c.offer("t", msg("D1", { s: `${"a".repeat(63)}\u{1F600}tail` }));
  const sample = c.result().devices[0]?.keys[0]?.sampleValue;
  assert(
    sample === "a".repeat(63) && !LONE_SURROGATE_ESCAPE.test(storedText(c)),
    `a cut through a surrogate pair drops the half; got ${JSON.stringify(sample)}`,
  );
}

export function assertWholeEmojiInsideTheBoundIsKept(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", msg("D1", { s: "ok \u{1F600}" }));
  assert(c.result().devices[0]?.keys[0]?.sampleValue === "ok \u{1F600}", "a whole surrogate pair is kept");
}

export function assertBinaryPayloadIsRead(): void {
  const c = createDiscoveryCollector({});
  c.offer("t", new TextEncoder().encode(msg("D1", { k: 1 })));
  assert(c.result().devices.length === 1, "a Uint8Array payload is decoded as UTF-8");
}

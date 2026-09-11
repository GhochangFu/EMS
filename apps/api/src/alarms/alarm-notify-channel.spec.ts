import {
  type AlarmNotification,
  decodeAlarmNotification,
  encodeAlarmNotification,
} from "./alarm-notify-channel";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F3.11` / ADR 0064 decision 4 — the `NOTIFY bms_alarms` payload, both sides.
 *
 * One exported function per row and one `it()` per row in the wrapper, on
 * purpose: `assert` throws, so a single six-claim function reports only the
 * first failure, and the two mutation checks the plan names (hard-coding the
 * trace's `raisedBy`; dropping `.strict()`) could not tell which claim they
 * reddened. The round trip is the positive control for every rejection row
 * below it — a `decode` that returned `null` for everything would pass the
 * four rejections and fail only there.
 */

const ALARM_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";

const sample: AlarmNotification = {
  type: "created",
  alarmId: ALARM_ID,
  organizationId: ORG_ID,
};

/**
 * The exact bytes on the wire, and their size against the simulator's
 * `MAX_NOTIFY_UTF8_BYTES = 7000` discipline (ADR 0016 §2). Byte length, not
 * `.length`: the payload is ASCII today, so a code-unit count passes for the
 * wrong reason and keeps passing after someone adds a body.
 */
export function assertEncodesIdsOnlyInDeclaredKeyOrder(): void {
  const encoded = encodeAlarmNotification(sample);
  assert(
    encoded === `{"type":"created","alarmId":"${ALARM_ID}","organizationId":"${ORG_ID}"}`,
    `expected the ids-only payload in key order type, alarmId, organizationId; got ${encoded}`,
  );
  assert(
    Buffer.byteLength(encoded, "utf8") < 7000,
    `the payload must stay under MAX_NOTIFY_UTF8_BYTES (7000); got ${Buffer.byteLength(encoded, "utf8")}`,
  );
}

/** Positive control: a payload the producer wrote is one the consumer reads back whole. */
export function assertRoundTripsAnEncodedNotification(): void {
  const decoded = decodeAlarmNotification(encodeAlarmNotification(sample));
  assert(
    JSON.stringify(decoded) === JSON.stringify(sample),
    `expected the round trip to return the input; got ${JSON.stringify(decoded)}`,
  );
}

/** A malformed payload is `null`, never a throw out of the listener's `notification` handler. */
export function assertRejectsNonJson(): void {
  const decoded = decodeAlarmNotification("not json");
  assert(decoded === null, `expected null for a non-JSON payload; got ${JSON.stringify(decoded)}`);
}

/** `F4.132` widens the literal; until then a `cleared` notification is not one the listener acts on. */
export function assertRejectsAnUnknownType(): void {
  const decoded = decodeAlarmNotification(
    JSON.stringify({ type: "cleared", alarmId: ALARM_ID, organizationId: ORG_ID }),
  );
  assert(decoded === null, `expected null for type "cleared"; got ${JSON.stringify(decoded)}`);
}

/** The schema is `.strict()`: a producer that grows the body without widening the schema is refused here. */
export function assertRejectsAnExtraKey(): void {
  const decoded = decodeAlarmNotification(
    JSON.stringify({ type: "created", alarmId: ALARM_ID, organizationId: ORG_ID, message: "x" }),
  );
  assert(decoded === null, `expected null for an extra key; got ${JSON.stringify(decoded)}`);
}

/** `.uuid()` on `alarmId`: the listener reads the alarm by this id, so a non-uuid never reaches the query. */
export function assertRejectsANonUuidAlarmId(): void {
  const decoded = decodeAlarmNotification(
    JSON.stringify({ type: "created", alarmId: "1", organizationId: ORG_ID }),
  );
  assert(decoded === null, `expected null for alarmId "1"; got ${JSON.stringify(decoded)}`);
}

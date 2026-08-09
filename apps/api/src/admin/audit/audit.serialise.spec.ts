import { AUDIT_EXPORT_COLUMNS, toCsv, toSheetRows } from "./audit.serialise";
import type { AuditRow } from "./audit.serialise";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-09T10:00:00.000Z",
    actorId: "00000000-0000-4000-8000-000000000002",
    actorEmail: "admin@bms.local",
    action: "master.asset.create",
    entityType: "asset",
    entityId: "00000000-0000-4000-8000-000000000003",
    reason: null,
    payload: null,
    ...overrides,
  };
}

/** ADR 0021 export serialisation. */
export function runAuditSerialiseTests(): void {
  // --- header ---------------------------------------------------------------
  const header = toCsv([]).trim();
  assert(header === AUDIT_EXPORT_COLUMNS.join(","), "empty export is header-only");
  assert(
    AUDIT_EXPORT_COLUMNS.length === 9,
    "nine columns: id, created_at, actor_id, actor_email, action, entity_type, entity_id, reason, payload",
  );

  // --- a plain row ----------------------------------------------------------
  const plain = toCsv([row()]).trim().split("\n");
  assert(plain.length === 2, "one row plus header");
  assert(plain[1].startsWith("00000000-0000-4000-8000-000000000001,"), "id leads the row");
  assert(plain[1].includes("master.asset.create"), "action present");

  // --- nulls become empty, never the string "null" --------------------------
  const nulled = toCsv([row({ actorId: null, actorEmail: null, reason: null })]);
  assert(!nulled.includes("null"), "null renders empty, not the literal 'null'");

  // --- escaping -------------------------------------------------------------
  const comma = toCsv([row({ reason: "decommissioned, per ticket 42" })]);
  assert(comma.includes('"decommissioned, per ticket 42"'), "comma forces quoting");

  const quoted = toCsv([row({ reason: 'said "no"' })]);
  assert(quoted.includes('"said ""no"""'), "embedded quotes are doubled");

  const newline = toCsv([row({ reason: "line one\nline two" })]);
  assert(newline.includes('"line one\nline two"'), "newline forces quoting");
  assert(
    newline.trim().split("\n").length === 3,
    "a quoted newline still occupies one logical record (two physical lines + header)",
  );

  const cr = toCsv([row({ reason: "a\r\nb" })]);
  assert(cr.includes('"a\r\nb"'), "carriage return forces quoting");

  // --- payload is JSON, and JSON is full of commas and quotes ---------------
  const withPayload = toCsv([row({ payload: { code: "A-1", name: "Pump, main" } })]);
  assert(
    withPayload.includes('"{""code"":""A-1"",""name"":""Pump, main""}"'),
    "payload serialises as quoted JSON with doubled inner quotes",
  );

  // --- CSV formula injection ------------------------------------------------
  // `reason` and `payload` carry user-supplied text and these exports are opened
  // in Excel. A leading =, +, - or @ makes the cell a formula.
  // TAB and CR count: both are stripped as leading whitespace on import.
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    const dangerous = toCsv([row({ reason: `${lead}cmd|' /c calc'!A1` })]);
    assert(
      !dangerous.includes(`,${lead}cmd`) && !dangerous.includes(`,"${lead}cmd`),
      `leading ${lead} is neutralised before the cell value`,
    );
  }
  // Neutralising must not corrupt ordinary text.
  const negative = toCsv([row({ reason: "reduced by 5" })]);
  assert(negative.includes("reduced by 5"), "ordinary text is untouched");

  // --- xlsx rows share the shaping, not the escaping ------------------------
  const sheet = toSheetRows([row({ payload: { a: 1 } })]);
  assert(sheet.length === 2, "sheet rows include the header");
  assert(sheet[0][0] === AUDIT_EXPORT_COLUMNS[0], "sheet header matches the CSV header");
  assert(sheet[1].length === AUDIT_EXPORT_COLUMNS.length, "sheet row is fully populated");
  assert(sheet[1][8] === '{"a":1}', "sheet payload is the raw JSON string, unescaped");
}

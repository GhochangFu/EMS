import { auditExportQuerySchema, auditListQuerySchema } from "./audit.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function rejects(parse: () => unknown, message: string): void {
  let threw = false;
  try {
    parse();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

const UUID = "00000000-0000-4000-8000-000000000001";

/** ADR 0021 query contracts for the audit read API. */
export function runAuditSchemaTests(): void {
  // --- list: defaults -------------------------------------------------------
  const empty = auditListQuerySchema.parse({});
  assert(empty.limit === 50, "list limit defaults to 50");
  assert(empty.offset === 0, "list offset defaults to 0");
  assert(empty.action === undefined, "list action is optional");

  // Query strings arrive as strings; the schema coerces them.
  const coerced = auditListQuerySchema.parse({ limit: "200", offset: "10" });
  assert(coerced.limit === 200, "list limit coerces from string");
  assert(coerced.offset === 10, "list offset coerces from string");

  // --- list: bounds ---------------------------------------------------------
  rejects(() => auditListQuerySchema.parse({ limit: 201 }), "limit above 200 rejected");
  rejects(() => auditListQuerySchema.parse({ limit: 0 }), "limit below 1 rejected");
  rejects(() => auditListQuerySchema.parse({ offset: -1 }), "negative offset rejected");
  rejects(() => auditListQuerySchema.parse({ limit: 1.5 }), "fractional limit rejected");

  // --- list: identifiers ----------------------------------------------------
  const filtered = auditListQuerySchema.parse({
    action: "master.asset.create",
    entityType: "asset",
    entityId: UUID,
    actorId: UUID,
  });
  assert(filtered.action === "master.asset.create", "action filter parsed");
  assert(filtered.entityId === UUID, "entityId filter parsed");
  rejects(() => auditListQuerySchema.parse({ entityId: "not-a-uuid" }), "bad entityId rejected");
  rejects(() => auditListQuerySchema.parse({ actorId: "not-a-uuid" }), "bad actorId rejected");

  // `action` and `entity_type` are varchar(64); a longer filter can never match
  // a stored row, so reject it rather than run a query guaranteed to be empty.
  rejects(() => auditListQuerySchema.parse({ action: "x".repeat(65) }), "over-long action rejected");
  rejects(
    () => auditListQuerySchema.parse({ entityType: "x".repeat(65) }),
    "over-long entityType rejected",
  );

  // --- list: unknown keys (ADR 0021 decision 3, `.strict()`) -----------------
  rejects(
    () => auditListQuerySchema.parse({ organizationId: UUID }),
    "unknown query key rejected — organizationId is not a filter this API offers",
  );

  // --- list: time window ----------------------------------------------------
  const windowed = auditListQuerySchema.parse({
    from: "2026-01-01T00:00:00Z",
    to: "2026-02-01T00:00:00Z",
  });
  assert(windowed.from === "2026-01-01T00:00:00Z", "from parsed");
  rejects(() => auditListQuerySchema.parse({ from: "01-01-2026" }), "non-ISO from rejected");
  rejects(
    () =>
      auditListQuerySchema.parse({
        from: "2026-02-01T00:00:00Z",
        to: "2026-01-01T00:00:00Z",
      }),
    "inverted window rejected",
  );

  // --- export: format -------------------------------------------------------
  const csv = auditExportQuerySchema.parse({
    from: "2026-01-01T00:00:00Z",
    to: "2026-02-01T00:00:00Z",
  });
  assert(csv.format === "csv", "export format defaults to csv");
  const xlsx = auditExportQuerySchema.parse({
    from: "2026-01-01T00:00:00Z",
    to: "2026-02-01T00:00:00Z",
    format: "xlsx",
  });
  assert(xlsx.format === "xlsx", "export accepts xlsx");
  rejects(
    () =>
      auditExportQuerySchema.parse({
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
        format: "pdf",
      }),
    "unsupported export format rejected",
  );

  // --- export: the window is REQUIRED (ADR 0021 decision 5) -----------------
  rejects(() => auditExportQuerySchema.parse({}), "export without a window rejected");
  rejects(
    () => auditExportQuerySchema.parse({ from: "2026-01-01T00:00:00Z" }),
    "export with only `from` rejected",
  );
  rejects(
    () => auditExportQuerySchema.parse({ to: "2026-02-01T00:00:00Z" }),
    "export with only `to` rejected",
  );

  // --- export: span ceiling -------------------------------------------------
  // 2026 is not a leap year, so 2026-01-01 → 2027-01-01 is exactly 365 days.
  const yearSpan = auditExportQuerySchema.parse({
    from: "2026-01-01T00:00:00Z",
    to: "2027-01-01T00:00:00Z",
  });
  assert(yearSpan.format === "csv", "a 365-day export window is accepted");
  rejects(
    () =>
      auditExportQuerySchema.parse({
        from: "2026-01-01T00:00:00Z",
        to: "2027-01-03T00:00:00Z",
      }),
    "export window beyond 366 days rejected",
  );

  // --- export: no pagination ------------------------------------------------
  // The row cap does that job; offering both invites a caller to page an export
  // and stitch the parts, defeating the cap.
  rejects(
    () =>
      auditExportQuerySchema.parse({
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z",
        limit: 50,
      }),
    "export rejects `limit` — the row cap governs size, not pagination",
  );
}

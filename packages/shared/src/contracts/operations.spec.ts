import { alarmSeverityCountSchema, vocabulariesResponseSchema } from "./operations";

/**
 * `E4.3` (ADR 0073 decision 1) — the seventh open vocabulary,
 * `waterBalanceRoles`, on `GET /api/v1/vocabularies`.
 *
 * One claim per exported function; `operations.test.ts` is the vitest entry
 * point (ADR 0014). Modelled on the other contract specs in this directory.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const OTHER_SIX = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
};

/** A response missing `waterBalanceRoles` is refused — the seventh field is required. */
export function assertRefusesResponseWithoutWaterBalanceRoles(): void {
  const result = vocabulariesResponseSchema.safeParse(OTHER_SIX);
  assert(
    result.success === false,
    "vocabulariesResponseSchema accepted a response with no waterBalanceRoles — the field " +
      "must be required, not optional, so a caller cannot silently render six vocabularies.",
  );
}

/** A response with an empty `waterBalanceRoles` array parses. */
export function assertAcceptsEmptyWaterBalanceRoles(): void {
  const result = vocabulariesResponseSchema.safeParse({ ...OTHER_SIX, waterBalanceRoles: [] });
  assert(
    result.success === true,
    `vocabulariesResponseSchema refused an empty waterBalanceRoles array: ${JSON.stringify(
      !result.success ? result.error.issues : undefined,
    )}`,
  );
}

/** A response with a well-formed waterBalanceRoles row parses. */
export function assertAcceptsWaterBalanceRoleRow(): void {
  const result = vocabulariesResponseSchema.safeParse({
    ...OTHER_SIX,
    waterBalanceRoles: [{ code: "intake", label: "Intake", sortOrder: 10, active: true }],
  });
  assert(
    result.success === true,
    `vocabulariesResponseSchema refused a well-formed waterBalanceRoles row: ${JSON.stringify(
      !result.success ? result.error.issues : undefined,
    )}`,
  );
}

/**
 * `F3.28` (ADR 0074 decision 3 / plan decision 7) — `alarmSeverityCountSchema`
 * allows a `count` of zero. Every active severity is represented, whether or
 * not it currently has an alarm, so a zero row is not an anomaly.
 */
export function assertAlarmSeverityCountAllowsZero(): void {
  const result = alarmSeverityCountSchema.safeParse({
    code: "critical",
    label: "Critical",
    tone: "critical",
    rank: 30,
    count: 0,
  });
  assert(
    result.success === true,
    `alarmSeverityCountSchema refused a zero count: ${JSON.stringify(
      !result.success ? result.error.issues : undefined,
    )}`,
  );
}

/** A negative count is never a valid severity count. */
export function assertAlarmSeverityCountRefusesNegative(): void {
  const result = alarmSeverityCountSchema.safeParse({
    code: "critical",
    label: "Critical",
    tone: "critical",
    rank: 30,
    count: -1,
  });
  assert(
    result.success === false,
    "alarmSeverityCountSchema accepted a negative count",
  );
}

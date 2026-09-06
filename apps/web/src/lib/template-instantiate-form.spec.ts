/**
 * The Instantiate dialog's payload rules (`F2.5`, ADR 0038).
 *
 * The assertion that matters most is `runRtuWinsTests`. Every other rule here
 * fails loudly — a bad code is a 400 the author reads. Sending the location
 * when an RTU was chosen fails **silently**: the server accepts it, the assets
 * are built under the wrong parent, and nobody is told.
 */
import {
  NO_TARGET_MESSAGE,
  buildInstantiatePayload,
  hasTarget,
  type InstantiateRow,
  missingVariables,
  namedCount,
  namedRows,
  patternsCarryingVariables,
  resolveTarget,
  templateVariables,
} from "./template-instantiate-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A row literal for the tests below that do not exercise `vars` at all. */
function row(code: string, name: string, vars: Record<string, string> = {}): InstantiateRow {
  return { code, name, vars };
}

/**
 * RTU wins whenever both ids are present.
 *
 * This is the normal state, not an edge case: choosing an RTU in the cascade
 * sets its location too. So the both-set case is what the dialog sends most of
 * the time, and getting it backwards is invisible at run time.
 */
export function runRtuWinsTests(): void {
  const both = { locationId: "loc-1", rtuId: "rtu-1" };

  const resolved = resolveTarget(both);
  assert(resolved !== null, "a target with both ids must resolve");
  assert(
    resolved?.kind === "rtu",
    `with both ids set the RTU must win, got ${resolved?.kind}`,
  );
  assert(resolved?.id === "rtu-1", `must carry the RTU id, got ${resolved?.id}`);

  const payload = buildInstantiatePayload(both, [row("AHU-1", "")]);
  assert(payload.ok, "a target with both ids must build");
  if (!payload.ok) {
    return;
  }
  // Asserted with `in` rather than `=== undefined`. A present-but-undefined
  // `locationId` passes the weaker check and `JSON.stringify` then drops it,
  // so the wire would be right by accident while the object was wrong.
  assert("rtuId" in payload.input, "the body must carry rtuId");
  assert(
    !("locationId" in payload.input),
    "the body must not carry locationId as well — the server rejects both",
  );
}

/** Each id alone resolves to itself. */
export function runSingleTargetTests(): void {
  const rtuOnly = resolveTarget({ rtuId: "rtu-9" });
  assert(rtuOnly?.kind === "rtu" && rtuOnly.id === "rtu-9", "an RTU alone must resolve to it");

  const locationOnly = resolveTarget({ locationId: "loc-9" });
  assert(
    locationOnly?.kind === "location" && locationOnly.id === "loc-9",
    "a location alone must resolve to it",
  );

  const payload = buildInstantiatePayload({ locationId: "loc-9" }, [row("A", "")]);
  assert(payload.ok, "a location alone must build");
  if (payload.ok) {
    assert("locationId" in payload.input, "the body must carry locationId");
    assert(!("rtuId" in payload.input), "the body must not carry rtuId");
  }
}

/**
 * No target refuses, and the refusal says what to do.
 *
 * An empty string counts as no selection: the picker hands back `""` for
 * "nothing chosen", and a presence check (`"rtuId" in target`) would call that
 * a target and send an empty id the server refuses.
 */
export function runNoTargetTests(): void {
  // Only the empty string, not whitespace. `Boolean("   ")` is `true`, so a
  // whitespace-only id *would* resolve as a target — and that is correct
  // rather than a gap: ids come from a cascade that returns real identifiers
  // or `""`, never a space. Asserting otherwise would test a shape this code
  // cannot receive, and would push a trim into the hot path to satisfy it.
  for (const target of [{}, { locationId: "" }, { rtuId: "" }, { locationId: "", rtuId: "" }]) {
    assert(resolveTarget(target) === null, `${JSON.stringify(target)} must resolve to no target`);
    assert(!hasTarget(target), `${JSON.stringify(target)} must not count as a target`);

    const payload = buildInstantiatePayload(target, [row("A", "")]);
    assert(!payload.ok, `${JSON.stringify(target)} must refuse`);
    if (!payload.ok) {
      assert(payload.message === NO_TARGET_MESSAGE, "the refusal must name what to do");
      assert(payload.message.trim() !== "", "the refusal must not be blank");
    }
  }
}

/** Blank rows are dropped; they are the dialog's normal trailing state. */
export function runBlankRowTests(): void {
  const rows = [
    row("AHU-1", "Air handler"),
    row("  ", "ignored"),
    row("", ""),
    row("AHU-2", ""),
  ];
  const built = namedRows(rows);
  assert(built.length === 2, `expected 2 named rows, got ${built.length}`);
  assert(namedCount(rows) === 2, "namedCount must agree with namedRows");
  assert(
    built.map((row) => row.code).join(",") === "AHU-1,AHU-2",
    `wrong rows survived: ${built.map((row) => row.code).join(",")}`,
  );

  // A row that is only whitespace in `code` must not be rescued by a non-empty
  // `name` — the code is what identifies the asset.
  assert(
    namedCount([row("   ", "Has a name")]) === 0,
    "a whitespace code must not build an asset",
  );
  assert(namedCount([]) === 0, "no rows means no assets");
}

/** Codes and names are trimmed, and an unnamed asset falls back to its code. */
export function runTrimAndFallbackTests(): void {
  const built = namedRows([
    row("  AHU-1  ", "  Air handler  "),
    row("AHU-2", "   "),
    row("AHU-3", ""),
  ]);

  assert(built[0].code === "AHU-1", `code must be trimmed, got "${built[0].code}"`);
  assert(built[0].name === "Air handler", `name must be trimmed, got "${built[0].name}"`);

  // `instantiateAssetSchema` requires a non-empty name, so a blank one must
  // become the code rather than being sent empty and refused.
  for (const index of [1, 2]) {
    assert(
      built[index].name === built[index].code,
      `an unnamed asset must take its code, got "${built[index].name}"`,
    );
    assert(built[index].name.trim() !== "", "a name must never be sent blank");
  }
}

/**
 * The payload carries the rows the count promised.
 *
 * The button reads `namedCount` and says "Build 2 assets". If the payload
 * builder filtered differently, the author would be told one number and get
 * another — with no error, because both are valid requests.
 */
export function runCountMatchesPayloadTests(): void {
  const rows = [
    row("A", ""),
    row("", "orphan"),
    row("B", "Bee"),
    row("   ", ""),
  ];
  const payload = buildInstantiatePayload({ rtuId: "rtu-1" }, rows);
  assert(payload.ok, "must build");
  if (!payload.ok) {
    return;
  }
  assert(
    payload.input.assets.length === namedCount(rows),
    `the button promises ${namedCount(rows)} but the body carries ${payload.input.assets.length}`,
  );
}

/** A minimal template point for `templateVariables` — only the two fields it reads. */
function point(
  kind: "measured" | "derived",
  sourceDataKeyPattern: string | null,
): { kind: "measured" | "derived"; sourceDataKeyPattern: string | null } {
  return { kind, sourceDataKeyPattern };
}

/**
 * `templateVariables` scans only measured points, in first-appearance order,
 * minus the reserved `asset_code` — the same vocabulary the mapping sheet and
 * the instantiate service read (ADR 0056 decision 10, "one vocabulary, wired
 * twice").
 */
export function runTemplateVariablesTests(): void {
  const oneVar = templateVariables({
    points: [point("measured", "{asset_code}_KW"), point("measured", "CH{unit}_T")],
  });
  assert(
    oneVar.join(",") === "unit",
    `asset_code must never be listed, got ${JSON.stringify(oneVar)}`,
  );

  // A derived point's pattern is `null`; it must not blow up and must not
  // contribute a variable of its own.
  const withDerived = templateVariables({
    points: [
      point("measured", "CH{unit}_T"),
      point("derived", null),
    ],
  });
  assert(
    withDerived.join(",") === "unit",
    `a derived point's null pattern must be skipped, got ${JSON.stringify(withDerived)}`,
  );

  // A repeated token across two patterns is still one variable.
  const repeated = templateVariables({
    points: [point("measured", "{asset_code}_{unit}_{unit}")],
  });
  assert(
    repeated.length === 1 && repeated[0] === "unit",
    `a repeated token must be listed once, got ${JSON.stringify(repeated)}`,
  );
}

/**
 * `patternsCarryingVariables` — what the dialog's hint line names. A pattern
 * with only the reserved `{asset_code}` token carries no variable and must not
 * be listed, even though it does carry a `{token}`.
 */
export function runPatternsCarryingVariablesTests(): void {
  const patterns = patternsCarryingVariables({
    points: [
      point("measured", "{asset_code}_KW"),
      point("measured", "CH{unit}_T"),
      point("derived", null),
    ],
  });
  assert(
    patterns.length === 1 && patterns[0] === "CH{unit}_T",
    `an asset_code-only pattern must not be named, got ${JSON.stringify(patterns)}`,
  );
}

/**
 * `namedRows` carries `sourceDataKeyVars` only when at least one var survives
 * trimming; a row with every var blank omits the key rather than sending an
 * empty string the server would treat as unresolved anyway.
 */
export function runVarsPayloadTests(): void {
  const withVar = namedRows([row("CH-1", "Chiller 1", { unit: "01" })]);
  assert(
    withVar[0].sourceDataKeyVars?.unit === "01",
    `expected sourceDataKeyVars.unit "01", got ${JSON.stringify(withVar[0].sourceDataKeyVars)}`,
  );

  // Asserted with `in`, not `=== undefined` — see `runRtuWinsTests` above: a
  // present-but-undefined key passes the weaker check and `JSON.stringify`
  // then drops it, so the wire would be right by accident while the object
  // was wrong. `namedRows` must never assign the key at all here.
  const blankVar = namedRows([row("CH-2", "Chiller 2", { unit: "   " })]);
  assert(
    !("sourceDataKeyVars" in blankVar[0]),
    `an all-blank vars object must be omitted, got ${JSON.stringify(blankVar[0])}`,
  );

  const noVars = namedRows([row("CH-3", "Chiller 3")]);
  assert(
    !("sourceDataKeyVars" in noVars[0]),
    "a row with no vars entry at all must omit the key",
  );
}

/**
 * `missingVariables` names a required variable left blank on a named row, and
 * says nothing about a row with no code — that row is never sent, so a blank
 * var on it is not a defect.
 */
export function runMissingVariablesTests(): void {
  const rows = [
    row("CH-1", "Chiller 1", { unit: "01" }),
    row("CH-2", "Chiller 2", { unit: "" }),
    row("", "", {}),
  ];
  const missing = missingVariables(rows, ["unit"]);
  assert(missing.length === 1, `expected exactly one gap, got ${JSON.stringify(missing)}`);
  assert(missing[0].row === 2, `must name row 2 (1-based), got ${JSON.stringify(missing[0])}`);
  assert(missing[0].variable === "unit", `must name the unit variable, got ${JSON.stringify(missing[0])}`);

  assert(missingVariables(rows, []).length === 0, "no required variables means no gaps");
}

import {
  SOURCE_KEY_PATTERN_TOKEN,
  SOURCE_KEY_RESERVED_VAR,
  patternTokens,
  patternVariables,
  substituteSourceKeyPattern,
} from "./source-key-pattern";

/**
 * `F2.7` / ADR 0056 decision 10 — the `{token}` grammar of
 * `template_points.source_data_key_pattern`, declared once and wired twice (the
 * instantiate service and the mapping sheet's pre-fill).
 *
 * Assertions live here; `source-key-pattern.test.ts` is the vitest entry point
 * (ADR 0014). Everything is pure and needs no connection.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sameList(actual: readonly string[], expected: readonly string[], message: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** The grammar's two constants, pinned so a consumer cannot drift them silently. */
export function runPatternConstantTests(): void {
  assert(SOURCE_KEY_RESERVED_VAR === "asset_code", "the reserved variable is `asset_code`");
  assert(SOURCE_KEY_PATTERN_TOKEN.global, "the token regex must be global — `matchAll` requires it");
  assert(
    SOURCE_KEY_PATTERN_TOKEN.source === "\\{([a-zA-Z0-9_]+)\\}",
    `the token grammar is \`{[a-zA-Z0-9_]+}\`, got /${SOURCE_KEY_PATTERN_TOKEN.source}/`,
  );
}

/** `patternTokens` — every distinct token of one pattern, in first-appearance order. */
export function runPatternTokenTests(): void {
  sameList(patternTokens("CH{unit}_CHW_SUPPLY_T"), ["unit"], "one token in the middle of a pattern");
  sameList(
    patternTokens("{asset_code}_{unit}_{unit}"),
    ["asset_code", "unit"],
    "tokens are distinct and keep first-appearance order",
  );
  sameList(patternTokens("PLAIN_KEY"), [], "a pattern with no token yields nothing");
  sameList(patternTokens(""), [], "an empty pattern yields nothing");
  sameList(
    patternTokens("{a-b}_{ok}"),
    ["ok"],
    "a brace group outside `[a-zA-Z0-9_]+` is not a token — the grammar is the regex, not any braces",
  );
  // The regex is shared and global; a stale `lastIndex` would make the second
  // call see fewer tokens than the first.
  sameList(patternTokens("{x}_{y}"), ["x", "y"], "first call over a shared global regex");
  sameList(patternTokens("{x}_{y}"), ["x", "y"], "second call must not inherit `lastIndex` from the first");
}

/** `patternVariables` — the distinct tokens across many patterns, minus the reserved one. */
export function runPatternVariableTests(): void {
  sameList(
    patternVariables(["{asset_code}_KW", "CH{unit}_T", null]),
    ["unit"],
    "`asset_code` is reserved and a null pattern is skipped",
  );
  sameList(
    patternVariables(["{b}_{a}", "{a}_{c}", undefined]),
    ["b", "a", "c"],
    "first-appearance order across patterns, each token once",
  );
  sameList(patternVariables([]), [], "no patterns, no variables");
  sameList(
    patternVariables(["{asset_code}", "{asset_code}_A"]),
    [],
    "a template whose only token is the reserved one asks the operator for nothing",
  );
}

/**
 * `substituteSourceKeyPattern` — known tokens replaced, unknown ones left
 * literal and reported by name. The caller decides what an unresolved token
 * means: the instantiate service refuses the key, the mapping sheet's pre-fill
 * ships it literal for the person to finish.
 */
export function runSubstitutionTests(): void {
  const partial = substituteSourceKeyPattern("CH{unit}_T", { asset_code: "CH1" });
  assert(partial.key === "CH{unit}_T", `an unknown token stays literal, got ${JSON.stringify(partial.key)}`);
  sameList(partial.unresolved, ["unit"], "and is reported by name");

  const full = substituteSourceKeyPattern("{asset_code}_KW", { asset_code: "TX01" });
  assert(full.key === "TX01_KW", `a known token is replaced, got ${JSON.stringify(full.key)}`);
  sameList(full.unresolved, [], "nothing left unresolved");

  const mixed = substituteSourceKeyPattern("{asset_code}_{unit}", { asset_code: "TX01" });
  assert(
    mixed.key === "TX01_{unit}",
    `known tokens are replaced beside an unknown one, got ${JSON.stringify(mixed.key)}`,
  );
  sameList(mixed.unresolved, ["unit"], "only the unknown one is reported");

  const repeated = substituteSourceKeyPattern("{unit}_{unit}", {});
  sameList(repeated.unresolved, ["unit"], "an unresolved token repeated in the pattern is reported once");

  const verbatim = substituteSourceKeyPattern("PLAIN_KEY", { asset_code: "X" });
  assert(verbatim.key === "PLAIN_KEY", "a pattern with no token is returned verbatim");
  sameList(verbatim.unresolved, [], "and resolves nothing");

  const empty = substituteSourceKeyPattern("", {});
  assert(empty.key === "" && empty.unresolved.length === 0, "an empty pattern is an empty key");

  // An empty string is a value, not an absence — the caller's `key === ""`
  // test is what turns it into a refusal.
  const blank = substituteSourceKeyPattern("{asset_code}", { asset_code: "" });
  assert(blank.key === "" && blank.unresolved.length === 0, "an empty value substitutes to an empty key");
}

/**
 * The prototype guard the instantiate service carried, kept. A plain object
 * literal resolves inherited members, so `{constructor}` or `{toString}` would
 * otherwise find a function, skip the unresolved branch, and stringify it into
 * a `source_data_key`.
 */
export function runPrototypeGuardTests(): void {
  const ctor = substituteSourceKeyPattern("{constructor}", {});
  sameList(ctor.unresolved, ["constructor"], "`{constructor}` is unresolved on an empty vars object");
  assert(ctor.key === "{constructor}", `and left literal, got ${JSON.stringify(ctor.key)}`);

  const inherited = substituteSourceKeyPattern("CH{toString}_{unit}", { unit: "1" });
  sameList(inherited.unresolved, ["toString"], "`{toString}` is unresolved beside a supplied token");
  assert(inherited.key === "CH{toString}_1", `got ${JSON.stringify(inherited.key)}`);

  const hasOwn = substituteSourceKeyPattern("{hasOwnProperty}", { hasOwnProperty: "own" });
  assert(
    hasOwn.key === "own" && hasOwn.unresolved.length === 0,
    "an own property that shadows a prototype member is a real value and resolves",
  );
}

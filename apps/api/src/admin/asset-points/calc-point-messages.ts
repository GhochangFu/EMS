/**
 * `F4.311` PR 2 (ADR 0109 decision 3) — the refusal sentences the two calc
 * write paths share, moved here from `asset-point-calc-override.service.ts`
 * so the override path and the standalone path (`calc-point-standalone.service.ts`)
 * send the same words for the same rule. Each was moved verbatim. The cycle
 * sentence stays in the override service (`dependencyCycleMessage`, exported):
 * `tests/f2.22-editor-mirrors-server-wording.test.ts` pair (f) finds it there.
 *
 * None of them ever carries formula text (§9.6): a stored formula is tenant
 * content, and these strings are returned to the caller as they are.
 */

/**
 * The longest asset code a refusal echoes. `bms.assets.code` is
 * `varchar(64)`, so a longer string cannot be a code — but it can be lifted
 * out of a formula, whose only bound is `MAX_FORMULA_LENGTH`, and the parser
 * accepts any text before the `.` as a code. Same reasoning and same shape as
 * `MAX_ECHOED_POINT_KEY_LENGTH` in `asset-templates-cross-refs.ts`: a value
 * the DTO already bounds is echoed in full, and only a formula-lifted one is
 * cut. The count is already bounded by `MAX_FORMULA_CROSS_REFS` at the parse.
 */
const MAX_ECHOED_ASSET_CODE_LENGTH = 64;

/** One formula-lifted asset code, cut to the column's length. */
export function echoedAssetCode(code: string): string {
  return code.length > MAX_ECHOED_ASSET_CODE_LENGTH
    ? `${code.slice(0, MAX_ECHOED_ASSET_CODE_LENGTH)}… (truncated)`
    : code;
}

/**
 * The `F2.22` item-9 refusal. Names the codes, states decision 12's rule, and
 * offers the two ways out — and never says whether a code exists at another
 * location or in another organization (plan design decision 8; the sibling
 * integration case holds this by comparing the sentence for a code that
 * exists at another location, one in another organization, and one that
 * exists nowhere).
 *
 * `formulaInherited` is `body.formula === null`: the check runs on the merged
 * formula, and the clause is the one `validateMergedCalcOverride`'s
 * `inherited(...)` builds for a `null` half, word for word, so the two
 * refusals read as one voice (plan correction 46). A standalone point has no
 * template to inherit from and always passes `false`.
 */
export function unresolvedQualifiedCodesMessage(codes: readonly string[], formulaInherited: boolean): string {
  const listed = codes.map(echoedAssetCode);
  const inherited = formulaInherited ? " (inherited from the template)" : "";
  return (
    `This formula${inherited} names asset code(s) that resolve to no active asset at this asset's ` +
    `location: ${listed.join(", ")}. A qualified reference reaches only assets at the same ` +
    "location as this asset (ADR 0055 decision 12). Check the code, or use an aggregate scope."
  );
}

/** An existing `asset_points` row that is telemetry wiring, not a computed point. */
export function mappingRowConflictMessage(pointKey: string, sourceKind: string): string {
  return (
    `Point "${pointKey}" on this asset already has an asset_points row with ` +
    `source_kind "${sourceKind}", which belongs to a telemetry mapping. ` +
    "Attaching calc configuration to it would make one point both ingest-fed and " +
    "formula-fed. Remove the mapping first, or use a different point key."
  );
}

/** The synthesised `computed:<pointKey>` key would not fit its column. */
export function sourceDataKeyTooLongMessage(pointKey: string, length: number): string {
  return (
    `Point key "${pointKey}" is too long: its synthesised source_data_key would be ` +
    `${length} characters, over the column limit.`
  );
}

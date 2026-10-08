import { SOURCE_KEY_RESERVED_VAR, substituteSourceKeyPattern } from "@bms/shared";

/**
 * Substitutes `{token}`s from the asset's stored variables plus `{asset_code}`
 * — ADR 0039 Amendment 1 decision 4 (`F2.29`), which amends plan Q-A.
 *
 * Returns the unresolved token names rather than just failing, because
 * "migration cannot resolve {panel}" is actionable and "the pattern did not
 * resolve" is not. Never returns a partially substituted key: a
 * plausible-looking string pointing at nothing is the failure
 * `AssetTemplateInstantiationService.resolveSourceDataKey` also refuses to
 * produce.
 *
 * `storedVars` is `bms.assets.source_data_key_vars`, written once at
 * instantiation. `{asset_code}` is set **last**, as at instantiation, so a
 * stored `asset_code` (never written, since the insert drops it) cannot
 * override `assets.code`. An asset with `NULL` variables resolves
 * `{asset_code}` alone, exactly as before the amendment.
 *
 * **`F2.7` — the grammar is `@bms/shared`'s** (ADR 0056 decision 10, "one
 * vocabulary, wired twice"). The empty-key guard stays — a pattern of nothing
 * but the reserved token on an asset with no code would otherwise produce an
 * empty `source_data_key`.
 */
export function resolveAdditionSourceDataKey(
  pattern: string | null,
  assetCode: string,
  storedVars: Readonly<Record<string, string>> | null,
): { ok: true; sourceDataKey: string } | { ok: false; unresolved: string[] } {
  if (!pattern) {
    return { ok: false, unresolved: [] };
  }
  const { key, unresolved } = substituteSourceKeyPattern(pattern, {
    ...(storedVars ?? {}),
    [SOURCE_KEY_RESERVED_VAR]: assetCode,
  });
  if (unresolved.length > 0 || key.length === 0) {
    return { ok: false, unresolved };
  }
  return { ok: true, sourceDataKey: key };
}

const braced = (names: readonly string[]): string => names.map((name) => `{${name}}`).join(", ");

/**
 * The refusal sentence for a **required** measured addition the asset cannot
 * resolve — ADR 0039 Amendment 1 decision 5. It names the asset, the point,
 * the pattern and the missing tokens, then says why: an asset with `NULL`
 * variables was built before variables were kept, or with none; an asset that
 * stores some names what it stores and what it lacks. Token names only, never
 * a stored value. "Rebuild" stays the remedy in both cases — there is no
 * backfill and no write path for the column.
 */
export function unresolvableAdditionMessage(input: {
  readonly assetCode: string;
  readonly pointKey: string;
  readonly pattern: string | null;
  readonly unresolved: readonly string[];
  readonly storedVars: Readonly<Record<string, string>> | null;
}): string {
  const { assetCode, pointKey, pattern, unresolved, storedVars } = input;
  const head =
    `Asset "${assetCode}": required point "${pointKey}" has pattern ` +
    `${pattern === null ? "(none set)" : `"${pattern}"`}` +
    `, and migration cannot resolve ${unresolved.length > 0 ? braced(unresolved) : "it"}. `;
  const remedy = "Rebuild these assets from the new version instead.";
  if (unresolved.length === 0) {
    return head + remedy;
  }
  const stored = Object.keys(storedVars ?? {}).sort();
  const why =
    stored.length === 0
      ? "This asset stores no variables — it was built before variables were kept, or with none — " +
        "so only {asset_code} can be resolved. "
      : `This asset stores ${braced(stored)} but not ${braced(unresolved)}, and its variables ` +
        "are written once, at instantiation. ";
  return head + why + remedy;
}

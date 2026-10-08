import { SOURCE_KEY_RESERVED_VAR, substituteSourceKeyPattern } from "@bms/shared";

/**
 * Substitutes `{token}`s using only `{asset_code}` — Q-A's ruling.
 *
 * Returns the unresolved token names rather than just failing, because
 * "migration cannot resolve {panel}" is actionable and "the pattern did not
 * resolve" is not. Never returns a partially substituted key: a
 * plausible-looking string pointing at nothing is the failure
 * `AssetTemplateInstantiationService.resolveSourceDataKey` also refuses to
 * produce.
 *
 * **`F2.7` — the grammar is `@bms/shared`'s** (ADR 0056 decision 10, "one
 * vocabulary, wired twice"). This service used to carry its own copy of the
 * token regex and of the reserved variable name, beside the instantiate
 * service's copy of both; a duplicated grammar is the drift AGENTS.md §4.8
 * names, and the sheet's pre-fill is now a third reader. Behaviour is
 * unchanged: `vars` holds `asset_code` alone, so any other token comes back
 * unresolved exactly as before, and the empty-key guard stays — a pattern of
 * nothing but the reserved token on an asset with no code would otherwise
 * produce an empty `source_data_key`.
 */
export function resolveAdditionSourceDataKey(
  pattern: string | null,
  assetCode: string,
): { ok: true; sourceDataKey: string } | { ok: false; unresolved: string[] } {
  if (!pattern) {
    return { ok: false, unresolved: [] };
  }
  const { key, unresolved } = substituteSourceKeyPattern(pattern, {
    [SOURCE_KEY_RESERVED_VAR]: assetCode,
  });
  if (unresolved.length > 0 || key.length === 0) {
    return { ok: false, unresolved };
  }
  return { ok: true, sourceDataKey: key };
}

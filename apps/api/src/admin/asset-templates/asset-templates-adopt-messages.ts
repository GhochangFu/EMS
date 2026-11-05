/**
 * `F4.315` PR A (ADR 0099 Amendment 14 decision 2) — the sentences of the
 * three whole-asset adoption refusals, lifted out of
 * `asset-templates-adopt-plan.ts` so the adopt route (its preview and its 409)
 * and the copilot's `assetTemplateAdopt` target (`copilot-adopt-targets.ts`)
 * read one text (AGENTS.md §4.8's vocabulary rule). Pure: no database, no
 * access check.
 *
 * Each sentence names the asset by its code and the version by its code and
 * number (`"<code>" v<version>`).
 */

/** The asset a sentence names. */
export type AdoptMessageAsset = { readonly code: string; readonly domain: string };

/** The version a sentence names. */
export type AdoptMessageVersion = { readonly code: string; readonly version: number; readonly domain: string };

/** `"<code>" v<version>`, the version as every adoption sentence names it. */
export function adoptVersionLabel(version: Pick<AdoptMessageVersion, "code" | "version">): string {
  return `"${version.code}" v${version.version}`;
}

/** `already_pinned` (A7): a pinned asset moves between versions with migrate. */
export function alreadyPinnedMessage(asset: Pick<AdoptMessageAsset, "code">, version: Pick<AdoptMessageVersion, "code" | "version">): string {
  return (
    `Asset "${asset.code}" is already pinned to a template version, so there is nothing to adopt from template ` +
    `${adoptVersionLabel(version)}. Adoption is for an asset built without a template; move a pinned asset between ` +
    "versions with migrate."
  );
}

/** `organization_mismatch` (A1): an asset adopts a version of its own organization only. */
export function organizationMismatchMessage(
  asset: Pick<AdoptMessageAsset, "code">,
  version: Pick<AdoptMessageVersion, "code" | "version">,
): string {
  return (
    `Asset "${asset.code}" belongs to another organization than template ${adoptVersionLabel(version)}. An asset ` +
    "adopts a version of its own organization only."
  );
}

/** `domain_mismatch` (A1): an asset adopts a version of its own domain only. */
export function domainMismatchMessage(asset: AdoptMessageAsset, version: AdoptMessageVersion): string {
  return (
    `Asset "${asset.code}" has domain "${asset.domain}" and template ${adoptVersionLabel(version)} declares ` +
    `"${version.domain}". An asset adopts a version of its own domain only.`
  );
}

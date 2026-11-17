import type { MlFindingAsset, MlFindingFactId, MlFindingSegment, MlFindingsCard } from "@bms/shared";

/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan §4.2–4.4, R-j, T1.6) — the internal
 * form of a findings card, shared by the two fact builders, and the one step
 * that turns it into the wire's card.
 *
 * A fact line is a list of parts. Plain text, a rule's name and a formatted
 * time stay apart here because `E1.9c` replaces each rule name and time with a
 * placeholder before any text leaves the host (§4.4); on the wire all three are
 * one text segment. An asset is a reference, numbered `A1`, `A2`, … by first
 * appearance in the card's **kept** lines, so an asset in a line the 8-line
 * budget dropped is not listed (decision 14). Pure: no database, no clock.
 */

/** A part before the card's references are numbered: an asset is still its id. */
export type DraftPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "rule"; readonly text: string }
  | { readonly kind: "time"; readonly text: string }
  | { readonly kind: "asset"; readonly assetId: string; readonly pointKey?: string };

export type DraftLine = { readonly id: MlFindingFactId; readonly parts: readonly DraftPart[] };

/** A part of a finished line: an asset is its card reference. */
export type FactPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "rule"; readonly text: string }
  | { readonly kind: "time"; readonly text: string }
  | { readonly kind: "asset"; readonly ref: string };

export type FactLine = { readonly id: MlFindingFactId; readonly parts: readonly FactPart[] };

/** One organization's facts in the internal form (`E1.9c` pseudonymises these). */
export type FindingsCardFacts = {
  readonly organizationId: string;
  readonly organizationCode: string;
  readonly organizationName: string;
  readonly facts: readonly FactLine[];
  readonly assets: readonly MlFindingAsset[];
};

/** The organization of a card. */
export type FindingOrganization = {
  readonly organizationId: string;
  readonly organizationCode: string;
  readonly organizationName: string;
};

/** One row of the Q1(a) organization reads, every column aliased. */
export type FindingOrganizationDbRow = {
  organization_id: string;
  organization_code: string | null;
  organization_name: string | null;
};

/** A card's organization from its read row; a missing code or name reads as an empty string. */
export const organizationOf = (row: FindingOrganizationDbRow): FindingOrganization => ({
  organizationId: row.organization_id,
  organizationCode: row.organization_code ?? "",
  organizationName: row.organization_name ?? "",
});

/** A fixed piece of sentence text. */
export const text = (value: string): DraftPart => ({ kind: "text", text: value });
/** A formatted time (a `[T…]` placeholder when sent to the LLM). */
export const time = (value: string): DraftPart => ({ kind: "time", text: value });
/** An alarm rule's name (a `[R…]` placeholder when sent to the LLM). */
export const rule = (value: string): DraftPart => ({ kind: "rule", text: value });
/** A named asset, linked by its card reference; `pointKey` is the forecast point it names. */
export const asset = (assetId: string, pointKey?: string): DraftPart =>
  pointKey === undefined ? { kind: "asset", assetId } : { kind: "asset", assetId, pointKey };

/**
 * Numbers the kept lines' assets by first appearance and lists each named asset
 * once. `labelOf` names an asset; `hrefOf` builds its link from the point keys
 * the card names for it, in order of first appearance.
 */
export function finishCard(
  organization: FindingOrganization,
  lines: readonly DraftLine[],
  labelOf: (assetId: string) => string,
  hrefOf: (assetId: string, pointKeys: readonly string[]) => string,
): FindingsCardFacts {
  const refs = new Map<string, string>();
  const keys = new Map<string, string[]>();
  const facts = lines.map((line) => ({
    id: line.id,
    parts: line.parts.map((part): FactPart => {
      if (part.kind !== "asset") return part;
      let ref = refs.get(part.assetId);
      if (ref === undefined) {
        ref = `A${refs.size + 1}`;
        refs.set(part.assetId, ref);
        keys.set(part.assetId, []);
      }
      const named = keys.get(part.assetId) as string[];
      if (part.pointKey !== undefined && !named.includes(part.pointKey)) named.push(part.pointKey);
      return { kind: "asset", ref };
    }),
  }));
  const assets = [...refs].map(([assetId, ref]) => ({
    ref,
    assetId,
    label: labelOf(assetId),
    href: hrefOf(assetId, keys.get(assetId) ?? []),
  }));
  return { ...organization, facts, assets };
}

/** Cards by organization code, then id, so the order never depends on the rows'. */
export function byOrganizationCode<T extends FindingOrganization>(cards: readonly T[]): T[] {
  return [...cards].sort(
    (a, b) =>
      a.organizationCode.localeCompare(b.organizationCode) || a.organizationId.localeCompare(b.organizationId),
  );
}

/** The internal card → the wire's: text, rule and time parts in a row are one text segment. */
export function toSummaryCard(card: FindingsCardFacts): MlFindingsCard {
  return {
    organizationId: card.organizationId,
    organizationCode: card.organizationCode,
    organizationName: card.organizationName,
    facts: card.facts.map((line) => {
      const segments: MlFindingSegment[] = [];
      for (const part of line.parts) {
        if (part.kind === "asset") {
          segments.push({ assetRef: part.ref });
          continue;
        }
        const last = segments[segments.length - 1];
        if (last !== undefined && "text" in last) {
          segments[segments.length - 1] = { text: last.text + part.text };
        } else {
          segments.push({ text: part.text });
        }
      }
      return { id: line.id, segments };
    }),
    assets: [...card.assets],
  };
}

/** A fact line's plain text, every asset by its label: for specs and logs that need the sentence. */
export function lineText(line: FactLine, assets: readonly MlFindingAsset[]): string {
  return line.parts
    .map((part) => (part.kind === "asset" ? (assets.find((a) => a.ref === part.ref)?.label ?? part.ref) : part.text))
    .join("");
}

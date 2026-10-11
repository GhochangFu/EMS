/**
 * `F3.85` PR 8 (plan §10.3, decision 4.9) — the rows a Confirm card shows: one
 * per field the change sends, with the value it sends and, for an edit, the
 * record's value now.
 *
 * Pure: the card fetches the current record and passes it in. `before` is
 * absent for a create (there is no record) and when the current record could
 * not be read; `changed` is then `true`.
 */
export type ChangeRow = {
  readonly field: string;
  readonly after: string;
  readonly before?: string;
  readonly changed: boolean;
};

/** The longest value a card shows in full; a longer one is cut with an ellipsis. */
export const CHANGE_VALUE_MAX = 160;

/** One value as a card shows it: text as-is, `null` as a dash, anything else as short JSON. */
export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > CHANGE_VALUE_MAX ? `${text.slice(0, CHANGE_VALUE_MAX - 1)}…` : text;
}

/** Field labels: `assetGroupId` → "Asset group id". */
export function fieldLabel(field: string): string {
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The card's rows for `body`, in the body's key order. With `current`, each
 * row also carries the record's value and whether the change alters it.
 */
export function changeRows(
  body: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
): ChangeRow[] {
  return Object.entries(body).map(([field, value]) => {
    const row = { field, after: formatChangeValue(value) };
    if (current === null) return { ...row, changed: true };
    return { ...row, before: formatChangeValue(current[field]), changed: !same(current[field], value) };
  });
}

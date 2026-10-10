/**
 * `F3.85` PR 4 / ADR 0099 drafter choice 5 — the one serialisation the body
 * hash of a pending copilot change is computed over, on both sides.
 *
 * The server hashes the body when the model proposes the change and again when
 * the browser sends it with `X-Copilot-Change`; the browser hashes what it is
 * about to send. The three must agree byte for byte, so the form is fixed
 * here and nowhere else:
 *
 * - the value is first reduced to its JSON image (`JSON.parse(JSON.stringify(v))`),
 *   so a `Date`, an `undefined` property or a `toJSON` method reads the same
 *   on every side as it does on the wire;
 * - object keys are sorted (UTF-16 code-unit order, `Array.prototype.sort`'s
 *   default), recursively; array order is kept;
 * - no whitespace.
 *
 * A value with no JSON image (`undefined`, a function) serialises as `null`,
 * as `JSON.stringify` writes it inside an array.
 *
 * Not `packages/db`'s `canonicalJson` (`site-layout-stock-history.ts`): that
 * one compares seed configs and does not take the JSON image first.
 */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(value);
  return write(text === undefined ? null : (JSON.parse(text) as unknown));
}

function write(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(write).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${write(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

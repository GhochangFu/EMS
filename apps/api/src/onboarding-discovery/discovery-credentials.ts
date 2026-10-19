/**
 * `F3.24b` (ADR 0103 Amendment 1; security review C1) — what the discovery
 * job may take from a decrypted RTU credential record.
 *
 * **Only the string fields `username` and `password`.** Any other field of
 * the record stays unread.
 *
 * **No control character.** The MQTT CONNECT packet carries both values.
 * A value holding `\r\n` sent to a plaintext line protocol on a reachable
 * address (the stack's Redis has no password) runs each line as a command.
 * The host guard refuses the worker's own subnets as well; this refusal holds
 * if a later change ever weakens that. `setCredentials` refuses the same
 * values for an MQTT RTU, so a stored one is possible only from an older
 * build.
 */

/** C0 controls and DEL. */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

export type DiscoveryCredentials = { readonly username?: string; readonly password?: string };

export type CredentialRead =
  | { readonly ok: true; readonly credentials: DiscoveryCredentials }
  | { readonly ok: false };

/** The string `username` and `password` of a decrypted record, or a refusal when either holds a control character. */
export function readDiscoveryCredentials(record: unknown): CredentialRead {
  if (typeof record !== "object" || record === null) {
    return { ok: true, credentials: {} };
  }
  const { username, password } = record as { username?: unknown; password?: unknown };
  const out: { username?: string; password?: string } = {};
  if (typeof username === "string" && username.length > 0) {
    out.username = username;
  }
  if (typeof password === "string" && password.length > 0) {
    out.password = password;
  }
  if ((out.username !== undefined && hasControlChars(out.username)) ||
      (out.password !== undefined && hasControlChars(out.password))) {
    return { ok: false };
  }
  return { ok: true, credentials: out };
}

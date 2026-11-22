/**
 * `F1.2` / ADR 0141 Amendment 1 (e), decision 22 — the Modbus hosts the cloud
 * ingest host may dial (`MODBUS_TCP_HOSTS`).
 *
 * The parsing and fail-closed half of ADR 0114's `MQTT_PLAINTEXT_HOSTS`: one
 * parser in `@bms/shared`, read by `apps/ingest`'s `host/config.ts`. Unset or
 * blank is the empty list, and the empty list allows nothing.
 *
 * Reachable from `./ingest`, so from the web bundle (plan M16): this file
 * imports nothing from Node and never uses `Buffer`.
 */

/** The environment variable that names the Modbus hosts the cloud host may dial. */
export const MODBUS_TCP_HOSTS_ENV = "MODBUS_TCP_HOSTS";

/**
 * A bad `MODBUS_TCP_HOSTS` entry; the ingest host refuses to start. The
 * message names the entry's 1-based **position**, never its text, so a secret
 * pasted into the variable by mistake never reaches a log line.
 */
export class ModbusTcpHostsConfigError extends Error {
  constructor(position: number) {
    super(
      `${MODBUS_TCP_HOSTS_ENV} entry ${position} is not a host name, an IP address or an IPv4 CIDR block`,
    );
    this.name = "ModbusTcpHostsConfigError";
  }
}

/**
 * The parsed list. `names` holds host names, IPv4 literals and IPv6 literals
 * in the normalized form `normalizeIpv6` returns; `ipv4Cidrs` holds each block
 * as its network address (an unsigned 32-bit number) and prefix length.
 */
export type ModbusTcpHostAllowList = {
  readonly names: ReadonlySet<string>;
  readonly ipv4Cidrs: readonly { readonly base: number; readonly prefix: number }[];
};

/** One DNS label, the same rule as MQTT's `HOST_LABEL`: no `*`, `:`, `/`, `@`, `[`, whitespace. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** An IPv4 octet: 0–255 with no leading zero, so `010` is not read as octal or decimal. */
const IPV4 = /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/;
const PREFIX = /^(0|[1-9][0-9]?)$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

/** A dotted IPv4 literal as an unsigned 32-bit number, or `null`. */
function parseIpv4(text: string): number | null {
  const match = IPV4.exec(text);
  if (match === null) {
    return null;
  }
  let value = 0;
  for (let i = 1; i <= 4; i += 1) {
    const octet = Number(match[i]);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value;
}

/**
 * A host name: DNS labels, at most 253 characters, a last label that is not
 * all digits, and no label in `0x…` hex — so `999.1.1.1`, `1.2.3`,
 * `0x7f000001` and `127.0.0.0x1` are refused rather than read as names that
 * the resolver could turn into an address (F1.2 security review I1).
 */
function isHostName(text: string): boolean {
  if (text.length > 253) {
    return false;
  }
  const labels = text.split(".");
  return (
    labels.every((label) => HOST_LABEL.test(label) && !/^0x[0-9a-f]*$/.test(label)) &&
    !/^[0-9]+$/.test(labels[labels.length - 1]!)
  );
}

/**
 * An IPv6 literal (no brackets, no zone id, no port) as its eight groups in
 * lower-case hex with leading zeros dropped, joined by `:` — one spelling for
 * every equivalent input. A trailing dotted IPv4 part is accepted. `null` if
 * the text is not one.
 */
function normalizeIpv6(text: string): string | null {
  if (!text.includes(":")) {
    return null;
  }
  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }
  const toGroups = (part: string, allowIpv4Tail: boolean): number[] | null => {
    if (part === "") {
      return [];
    }
    const pieces = part.split(":");
    const groups: number[] = [];
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i]!;
      if (allowIpv4Tail && i === pieces.length - 1 && piece.includes(".")) {
        const v4 = parseIpv4(piece);
        if (v4 === null) {
          return null;
        }
        groups.push(Math.floor(v4 / 0x10000), v4 % 0x10000);
      } else if (HEX_GROUP.test(piece)) {
        groups.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };
  let groups: number[];
  if (halves.length === 1) {
    const all = toGroups(halves[0]!, true);
    if (all === null || all.length !== 8) {
      return null;
    }
    groups = all;
  } else {
    const head = toGroups(halves[0]!, false);
    const tail = toGroups(halves[1]!, true);
    if (head === null || tail === null || head.length + tail.length > 7) {
      return null;
    }
    groups = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  }
  return groups.map((group) => group.toString(16)).join(":");
}

/** The network mask of a prefix length, as an unsigned 32-bit number. */
function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/**
 * Parses `MODBUS_TCP_HOSTS` (ADR 0141 decision 22).
 *
 * Comma-separated; each entry trimmed and lower-cased; empty entries ignored.
 * Each entry is a host name, an IPv4 literal, an IPv6 literal or an IPv4 CIDR
 * block `a.b.c.d/n` (`n` 0–32, the base normalized to the network address).
 * No port, no wildcard. Anything else throws `ModbusTcpHostsConfigError` with
 * the entry's 1-based position.
 */
export function parseModbusTcpHosts(raw: string | undefined): ModbusTcpHostAllowList {
  const names = new Set<string>();
  const ipv4Cidrs: { base: number; prefix: number }[] = [];
  if (raw === undefined) {
    return { names, ipv4Cidrs };
  }
  raw.split(",").forEach((rawEntry, index) => {
    const entry = rawEntry.trim().toLowerCase();
    if (entry === "") {
      return;
    }
    const slash = entry.indexOf("/");
    if (slash !== -1) {
      const address = parseIpv4(entry.slice(0, slash));
      const prefixText = entry.slice(slash + 1);
      const prefix = PREFIX.test(prefixText) ? Number(prefixText) : NaN;
      if (address === null || !(prefix >= 0 && prefix <= 32)) {
        throw new ModbusTcpHostsConfigError(index + 1);
      }
      const base = (address & maskOf(prefix)) >>> 0;
      if (!ipv4Cidrs.some((cidr) => cidr.base === base && cidr.prefix === prefix)) {
        ipv4Cidrs.push({ base, prefix });
      }
      return;
    }
    if (parseIpv4(entry) !== null || isHostName(entry)) {
      names.add(entry);
      return;
    }
    const ipv6 = normalizeIpv6(entry);
    if (ipv6 === null) {
      throw new ModbusTcpHostsConfigError(index + 1);
    }
    names.add(ipv6);
  });
  return { names, ipv4Cidrs };
}

/**
 * Whether the cloud host may dial `host`, the RTU's configured Modbus host.
 *
 * An exact match against `names` (an IPv6 literal after normalization); an
 * IPv4 literal also matches any CIDR block that contains it. A host name never
 * matches a CIDR block — names are not resolved. The empty list allows nothing.
 */
export function modbusTcpHostAllowed(host: string, allow: ModbusTcpHostAllowList): boolean {
  const key = host.trim().toLowerCase();
  if (key === "") {
    return false;
  }
  const ipv4 = parseIpv4(key);
  if (ipv4 !== null) {
    return (
      allow.names.has(key) ||
      allow.ipv4Cidrs.some((cidr) => ((ipv4 & maskOf(cidr.prefix)) >>> 0) === cidr.base)
    );
  }
  if (key.includes(":")) {
    const ipv6 = normalizeIpv6(key);
    return ipv6 !== null && allow.names.has(ipv6);
  }
  return allow.names.has(key);
}

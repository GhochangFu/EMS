import { promises as dnsPromises } from "node:dns";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/**
 * `F3.24b` (ADR 0103 decision 3, Amendment 1; security review C1, H1) — the
 * SSRF guard of the discovery job.
 *
 * Three layers, in order:
 *
 * 1. **The name**, before DNS: every service name (and alias, container name
 *    or hostname) in **both** compose files — `docker-compose.yml` and
 *    `deploy/aws/docker-compose.yml` — plus Docker Desktop's host names and
 *    `localhost`. `discovery-host-guard.spec.ts` reads both files and fails
 *    when one of their names is missing here. Compose's own container names
 *    (`bms-<service>-<n>`, project `bms` in both files) are refused by
 *    pattern.
 * 2. **Every resolved address**: loopback, `0.0.0.0/8`, link-local (which
 *    holds the IPv4 metadata address), multicast, `240.0.0.0/4` and the
 *    broadcast address, `::`, `::1`, `fe80::/10`, `ff00::/8`, and AWS's
 *    IPv6 metadata and DNS prefix `fd00:ec2::/32`. The IPv4 address inside
 *    `::ffff:0:0/96`, `::/96`, `64:ff9b::/96` and `2002::/16` is taken out
 *    and checked again.
 * 3. **The worker's own subnets** (Amendment 1, C1): any address inside a
 *    subnet of one of the worker's non-loopback interfaces. The worker shares
 *    a compose network with a Redis that has no password; an address on that
 *    network typed as an IP literal would otherwise pass layers 1 and 2.
 *    Private ranges elsewhere stay permitted (ruling 3) — an on-site LAN
 *    broker is not in the worker's container subnet. The default gateway sits
 *    inside the interface subnet, so it is refused by the same check.
 *
 * `resolveBrokerHost` returns the **first checked address**, and the job
 * connects to that address — never to a second lookup of the typed name
 * (decision 3's last sentence; review M1).
 */

/**
 * Every name Docker DNS answers inside the stack. The 17 services of
 * `docker-compose.yml` (the AWS file declares a subset of them and no
 * aliases today), Docker Desktop's three `*.docker.internal` names, and
 * `localhost`. Lower-case.
 */
export const DISCOVERY_BLOCKED_HOSTNAMES: readonly string[] = [
  "postgres",
  "redis",
  "minio",
  "keycloak",
  "keycloak-provision",
  "migrate",
  "api",
  "api-replica",
  "worker",
  "web",
  "sim",
  "ingest",
  "prometheus",
  "loki",
  "promtail",
  "grafana",
  "mailpit",
  "host.docker.internal",
  "gateway.docker.internal",
  "kubernetes.docker.internal",
  "localhost",
];

/** The compose project name both compose files declare (`name: bms`). */
const COMPOSE_PROJECT = "bms";

const BLOCKED_SET: ReadonlySet<string> = new Set(DISCOVERY_BLOCKED_HOSTNAMES);

/** Lower-case, no surrounding brackets, no trailing dots. */
export function normaliseHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) {
    h = h.slice(1, -1);
  }
  while (h.endsWith(".")) {
    h = h.slice(0, -1);
  }
  return h;
}

/** Layer 1: a name the stack's own DNS answers. The route runs this too, so a refusal reaches the user at once. */
export function isBlockedHostname(host: string): boolean {
  const h = normaliseHost(host);
  if (BLOCKED_SET.has(h) || h.endsWith(".localhost")) {
    return true;
  }
  // Compose's container names: `bms-<service>-<n>` (v2) and `bms_<service>_<n>` (v1).
  const container = /^([a-z0-9]+)[-_](.+)[-_]\d+$/.exec(h);
  return container !== null && container[1] === COMPOSE_PROJECT && BLOCKED_SET.has(container[2] ?? "");
}

/** The port must be an integer 1–65535. */
export function checkPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export type BlockReason =
  | "compose name"
  | "loopback"
  | "unspecified"
  | "link-local"
  | "multicast"
  | "reserved"
  | "cloud metadata"
  | "own subnet"
  | "not an address";

/** One subnet of the worker's own interfaces. */
export type OwnSubnet = { readonly family: 4 | 6; readonly address: string; readonly prefix: number };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const v = Number(part);
    if (v > 255) {
      return null;
    }
    n = n * 256 + v;
  }
  return n;
}

function intToIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** The eight 16-bit groups of an IPv6 address (a dotted IPv4 tail is accepted), or `null`. */
function ipv6Groups(ip: string): number[] | null {
  const bare = ip.split("%")[0] ?? "";
  if (isIP(bare) !== 6) {
    return null;
  }
  let text = bare;
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    // A dotted IPv4 tail becomes the two 16-bit groups it stands for.
    const v4 = ipv4ToInt(maybeV4);
    if (v4 === null) {
      return null;
    }
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.includes("::") ? text.split("::") : [text, undefined];
  const parse = (s: string | undefined): number[] =>
    s === undefined || s === "" ? [] : s.split(":").map((g) => parseInt(g, 16));
  const left = parse(head);
  const right = parse(rest);
  if (rest === undefined) {
    return left.length === 8 ? left : null;
  }
  const fill = 8 - left.length - right.length;
  if (fill < 0) {
    return null;
  }
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

function ipv4Reason(n: number): BlockReason | null {
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  if (a === 0) {
    return "unspecified";
  }
  if (a === 127) {
    return "loopback";
  }
  if (a === 169 && b === 254) {
    return "link-local";
  }
  if (a >= 224 && a <= 239) {
    return "multicast";
  }
  if (a >= 240) {
    // `240.0.0.0/4`, which holds the `255.255.255.255` broadcast address.
    return "reserved";
  }
  return null;
}

function inIpv4Subnet(n: number, subnet: OwnSubnet): boolean {
  const base = ipv4ToInt(subnet.address);
  if (base === null || subnet.prefix <= 0) {
    return false;
  }
  const mask = subnet.prefix >= 32 ? 0xffffffff : (0xffffffff << (32 - subnet.prefix)) >>> 0;
  return ((n & mask) >>> 0) === ((base & mask) >>> 0);
}

function inIpv6Subnet(groups: readonly number[], subnet: OwnSubnet): boolean {
  const base = ipv6Groups(subnet.address);
  if (base === null || subnet.prefix <= 0) {
    return false;
  }
  let bits = subnet.prefix;
  for (let i = 0; i < 8 && bits > 0; i += 1) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if (((groups[i] ?? 0) & mask) !== ((base[i] ?? 0) & mask)) {
      return false;
    }
    bits -= take;
  }
  return true;
}

/** The IPv4 address an IPv6 form carries, or `null` when the form carries none. */
function embeddedIpv4(g: readonly number[]): number | null {
  const v4 = (hi: number, lo: number): number => ((hi << 16) >>> 0) + lo;
  const zeros = (from: number, to: number): boolean => g.slice(from, to).every((x) => x === 0);
  // `::ffff:0:0/96` (IPv4-mapped).
  if (zeros(0, 5) && g[5] === 0xffff) {
    return v4(g[6] ?? 0, g[7] ?? 0);
  }
  // `::/96` (IPv4-compatible), but not `::` and `::1`, which have their own reasons.
  if (zeros(0, 6) && !(g[6] === 0 && (g[7] === 0 || g[7] === 1))) {
    return v4(g[6] ?? 0, g[7] ?? 0);
  }
  // `64:ff9b::/96` (NAT64).
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) {
    return v4(g[6] ?? 0, g[7] ?? 0);
  }
  // `2002::/16` (6to4): the IPv4 address is bits 16–48.
  if (g[0] === 0x2002) {
    return v4(g[1] ?? 0, g[2] ?? 0);
  }
  return null;
}

/**
 * Layers 2 and 3 for one address. `null` means permitted. An input that is
 * not an IP address is refused — the caller passes resolved addresses only.
 */
export function blockedAddressReason(ip: string, ownSubnets: readonly OwnSubnet[]): BlockReason | null {
  const v4 = ipv4ToInt(ip);
  if (isIP(ip) === 4 && v4 !== null) {
    const reason = ipv4Reason(v4);
    if (reason !== null) {
      return reason;
    }
    return ownSubnets.some((s) => s.family === 4 && inIpv4Subnet(v4, s)) ? "own subnet" : null;
  }
  const g = ipv6Groups(ip);
  if (g === null) {
    return "not an address";
  }
  if (g.every((x) => x === 0)) {
    return "unspecified";
  }
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) {
    return "loopback";
  }
  const first = g[0] ?? 0;
  if ((first & 0xffc0) === 0xfe80) {
    return "link-local";
  }
  if ((first & 0xff00) === 0xff00) {
    return "multicast";
  }
  if (first === 0xfd00 && g[1] === 0x0ec2) {
    return "cloud metadata";
  }
  const inner = embeddedIpv4(g);
  if (inner !== null) {
    return blockedAddressReason(intToIpv4(inner), ownSubnets);
  }
  return ownSubnets.some((s) => s.family === 6 && inIpv6Subnet(g, s)) ? "own subnet" : null;
}

/**
 * The subnets of the worker's own non-loopback interfaces, from
 * `os.networkInterfaces()` and each entry's `cidr`. Loopback is excluded:
 * layer 2 already refuses it.
 */
export function ownSubnets(
  read: typeof networkInterfaces = networkInterfaces,
): OwnSubnet[] {
  const out: OwnSubnet[] = [];
  for (const entries of Object.values(read())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.cidr === null) {
        continue;
      }
      const [address, prefixText] = entry.cidr.split("/");
      const prefix = Number(prefixText);
      const family = isIP(address ?? "");
      if ((family === 4 || family === 6) && address !== undefined && Number.isInteger(prefix)) {
        out.push({ family, address, prefix });
      }
    }
  }
  return out;
}

export type HostResolution =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly error: "blocked host"; readonly reason: BlockReason }
  | { readonly ok: false; readonly error: "host unreachable" };

export type LookupAll = (
  host: string,
  options: { all: true },
) => Promise<readonly { address: string; family: number }[]>;

export type ResolveDeps = {
  readonly lookup?: LookupAll;
  readonly subnets?: () => readonly OwnSubnet[];
  readonly lookupTimeoutMs?: number;
};

const DEFAULT_LOOKUP_TIMEOUT_MS = 10_000;

async function lookupWithin(lookup: LookupAll, host: string, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("lookup timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The full check: the name, then **every** resolved address. An IP literal is
 * checked directly, with no lookup. A lookup that fails or times out is
 * `host unreachable` — it is not a guard hit, so it is never audited as a
 * refusal (accuracy review #5).
 */
export async function resolveBrokerHost(host: string, deps: ResolveDeps = {}): Promise<HostResolution> {
  const name = normaliseHost(host);
  if (name.length === 0) {
    return { ok: false, error: "host unreachable" };
  }
  if (isBlockedHostname(name)) {
    return { ok: false, error: "blocked host", reason: "compose name" };
  }
  const subnets = (deps.subnets ?? ownSubnets)();
  const literal = name.split("%")[0] ?? "";
  if (isIP(literal) !== 0) {
    const reason = blockedAddressReason(literal, subnets);
    return reason === null ? { ok: true, address: literal } : { ok: false, error: "blocked host", reason };
  }
  let addresses: readonly { address: string }[];
  try {
    addresses = await lookupWithin(
      deps.lookup ?? (dnsPromises.lookup as unknown as LookupAll),
      name,
      deps.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS,
    );
  } catch {
    return { ok: false, error: "host unreachable" };
  }
  const first = addresses[0];
  if (first === undefined) {
    return { ok: false, error: "host unreachable" };
  }
  for (const { address } of addresses) {
    const reason = blockedAddressReason(address, subnets);
    if (reason !== null) {
      return { ok: false, error: "blocked host", reason };
    }
  }
  return { ok: true, address: first.address };
}

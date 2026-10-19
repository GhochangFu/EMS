import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "../testing/repo-root";
import {
  blockedAddressReason,
  checkPort,
  DISCOVERY_BLOCKED_HOSTNAMES,
  isBlockedHostname,
  ownSubnets,
  resolveBrokerHost,
  type LookupAll,
  type OwnSubnet,
} from "./discovery-host-guard";

/**
 * `F3.24b` (ADR 0103 decision 3, Amendment 1; security review C1, H1, M1) —
 * the discovery host guard. One exported assertion per blocked form, so a
 * mutation that drops one form reddens exactly one `it()`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A worker on a compose bridge network: `172.18.0.5/16` and its IPv6 twin. */
export const WORKER_SUBNETS: readonly OwnSubnet[] = [
  { family: 4, address: "172.18.0.5", prefix: 16 },
  { family: 6, address: "fd12:3456:789a::5", prefix: 64 },
];

/** Asserts the address is refused with the named reason. */
export function assertRefused(ip: string, reason: string): void {
  const got = blockedAddressReason(ip, WORKER_SUBNETS);
  assert(got === reason, `expected ${ip} to be refused as "${reason}"; got ${String(got)}`);
}

/** Asserts the address is permitted. */
export function assertPermitted(ip: string): void {
  const got = blockedAddressReason(ip, WORKER_SUBNETS);
  assert(got === null, `expected ${ip} to be permitted (ruling 3); got ${String(got)}`);
}

export function assertNameIsBlocked(host: string): void {
  assert(isBlockedHostname(host), `expected the name ${host} to be refused before DNS`);
}

export function assertNameIsNotBlocked(host: string): void {
  assert(!isBlockedHostname(host), `expected the name ${host} to pass the name check`);
}

export function assertPortRule(): void {
  assert(checkPort(1) && checkPort(8883) && checkPort(65_535), "1, 8883 and 65535 must pass");
}

export function assertPortRefusals(): void {
  for (const bad of [0, 65_536, 70_000, 1.5, Number.NaN, "8883"]) {
    assert(!checkPort(bad), `port ${String(bad)} must be refused`);
  }
}

function fakeLookup(addresses: readonly string[]): LookupAll {
  return async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
}

export async function assertEveryResolvedAddressIsChecked(): Promise<void> {
  const r = await resolveBrokerHost("broker.example.com", {
    lookup: fakeLookup(["93.184.216.34", "127.0.0.1"]),
    subnets: () => WORKER_SUBNETS,
  });
  assert(!r.ok && r.error === "blocked host", `a name resolving to a loopback second address must be refused; got ${JSON.stringify(r)}`);
}

export async function assertResolvedAddressIsReturned(): Promise<void> {
  const r = await resolveBrokerHost("broker.example.com", {
    lookup: fakeLookup(["93.184.216.34", "93.184.216.35"]),
    subnets: () => WORKER_SUBNETS,
  });
  assert(r.ok && r.address === "93.184.216.34", `the first checked address must be returned; got ${JSON.stringify(r)}`);
}

export async function assertLookupFailureIsUnreachable(): Promise<void> {
  const r = await resolveBrokerHost("nowhere.example.invalid", {
    lookup: async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND nowhere.example.invalid"), { code: "ENOTFOUND" });
    },
    subnets: () => WORKER_SUBNETS,
  });
  assert(!r.ok && r.error === "host unreachable", `ENOTFOUND must read as host unreachable, not a guard hit; got ${JSON.stringify(r)}`);
}

export async function assertLookupTimeoutIsUnreachable(): Promise<void> {
  const r = await resolveBrokerHost("slow.example.com", {
    lookup: () => new Promise(() => undefined),
    subnets: () => WORKER_SUBNETS,
    lookupTimeoutMs: 20,
  });
  assert(!r.ok && r.error === "host unreachable", `a lookup that never answers must read as host unreachable; got ${JSON.stringify(r)}`);
}

export async function assertComposeNameIsRefusedBeforeLookup(): Promise<void> {
  let looked = false;
  const r = await resolveBrokerHost("Redis.", {
    lookup: async () => {
      looked = true;
      return [{ address: "93.184.216.34", family: 4 }];
    },
    subnets: () => WORKER_SUBNETS,
  });
  assert(!r.ok && r.error === "blocked host" && !looked, `a compose name must be refused before any lookup; got ${JSON.stringify(r)} looked=${looked}`);
}

export async function assertOwnSubnetLiteralIsRefused(): Promise<void> {
  const r = await resolveBrokerHost("172.18.0.2", { subnets: () => WORKER_SUBNETS });
  assert(!r.ok && r.error === "blocked host", `an IP literal in the worker's own subnet must be refused (C1); got ${JSON.stringify(r)}`);
}

export async function assertPublicLiteralPassesWithoutLookup(): Promise<void> {
  let looked = false;
  const r = await resolveBrokerHost("93.184.216.34", {
    lookup: async () => {
      looked = true;
      return [];
    },
    subnets: () => WORKER_SUBNETS,
  });
  assert(r.ok && r.address === "93.184.216.34" && !looked, `an IP literal is checked directly, with no lookup; got ${JSON.stringify(r)}`);
}

export function assertOwnSubnetsSkipsLoopback(): void {
  const subnets = ownSubnets(
    () =>
      ({
        lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: "127.0.0.1/8" }],
        eth0: [{ address: "172.18.0.5", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: "172.18.0.5/16" }],
      }) as unknown as ReturnType<typeof import("node:os").networkInterfaces>,
  );
  assert(
    subnets.length === 1 && subnets[0]?.address === "172.18.0.5" && subnets[0].prefix === 16,
    `ownSubnets must read the non-internal cidr only; got ${JSON.stringify(subnets)}`,
  );
}

// ---------------------------------------------------------------------------
// The compose-name gate: both compose files, every name Docker DNS answers.
// ---------------------------------------------------------------------------

/** Strip `#` comments so a commented-out line cannot satisfy an assertion (the `tests/f4.61` shape). */
function withoutComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").replace(/^\s*#.*$/, ""))
    .join("\n");
}

/**
 * Every name Docker DNS answers for a compose file: each top-level
 * `services:` key, each `aliases:` list entry, and each `container_name:` /
 * `hostname:` value.
 */
export function composeNamesOf(yaml: string): string[] {
  const text = withoutComments(yaml);
  const names = new Set<string>();
  const services = /^services:\s*$/m.exec(text);
  if (services !== null) {
    const after = text.slice(services.index + services[0].length);
    const end = /^\S/m.exec(after);
    const block = end === null ? after : after.slice(0, end.index);
    for (const match of block.matchAll(/^ {2}([A-Za-z0-9_.-]+):\s*$/gm)) {
      names.add((match[1] ?? "").toLowerCase());
    }
    for (const match of block.matchAll(/^\s+(?:container_name|hostname):\s*["']?([A-Za-z0-9_.-]+)/gm)) {
      names.add((match[1] ?? "").toLowerCase());
    }
    // An `aliases:` list: the `- name` lines indented deeper than the key.
    const lines = block.split("\n");
    lines.forEach((line, i) => {
      const key = /^( +)aliases:\s*$/.exec(line);
      if (key === null) {
        return;
      }
      const depth = key[1]?.length ?? 0;
      for (const next of lines.slice(i + 1)) {
        const item = /^( +)-\s*["']?([A-Za-z0-9_.-]+)/.exec(next);
        if (item === null || (item[1]?.length ?? 0) <= depth) {
          break;
        }
        names.add((item[2] ?? "").toLowerCase());
      }
    });
  }
  return [...names].sort();
}

/** The names a compose text declares that the guard does not refuse. */
export function namesMissingFromGuard(yaml: string): string[] {
  return composeNamesOf(yaml).filter((name) => !isBlockedHostname(name));
}

function composeFile(relative: string): string {
  return readFileSync(join(repoRoot(), relative), "utf8");
}

export function assertRootComposeNamesAreBlocked(): void {
  const text = composeFile("docker-compose.yml");
  const names = composeNamesOf(text);
  assert(names.length >= 17, `the reader found ${names.length} names in docker-compose.yml — it reads nothing`);
  const missing = namesMissingFromGuard(text);
  assert(missing.length === 0, `docker-compose.yml names missing from DISCOVERY_BLOCKED_HOSTNAMES: ${missing.join(", ")}`);
}

export function assertAwsComposeNamesAreBlocked(): void {
  const text = composeFile("deploy/aws/docker-compose.yml");
  const names = composeNamesOf(text);
  assert(names.length >= 5, `the reader found ${names.length} names in deploy/aws/docker-compose.yml — it reads nothing`);
  const missing = namesMissingFromGuard(text);
  assert(missing.length === 0, `deploy/aws/docker-compose.yml names missing from DISCOVERY_BLOCKED_HOSTNAMES: ${missing.join(", ")}`);
}

export function assertExtraServiceIsCaught(): void {
  const fixture = "services:\n  postgres:\n    image: x\n  newsvc:\n    image: y\nvolumes:\n  data: {}\n";
  const missing = namesMissingFromGuard(fixture);
  assert(missing.length === 1 && missing[0] === "newsvc", `a fixture with an extra service must report it; got ${missing.join(", ")}`);
}

export function assertAliasIsCaught(): void {
  const fixture =
    "services:\n  api:\n    networks:\n      default:\n        aliases:\n          - backend\n          - api.internal\n    hostname: apihost\n";
  const missing = namesMissingFromGuard(fixture);
  assert(
    missing.join(",") === "api.internal,apihost,backend",
    `a fixture's aliases and hostname must be read; got ${missing.join(", ")}`,
  );
}

export function assertDockerDesktopNamesAreBlocked(): void {
  for (const name of ["host.docker.internal", "gateway.docker.internal", "localhost"]) {
    assert(DISCOVERY_BLOCKED_HOSTNAMES.includes(name), `${name} must be in the constant`);
  }
}

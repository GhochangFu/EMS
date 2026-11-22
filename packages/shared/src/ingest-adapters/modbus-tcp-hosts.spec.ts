import { expect } from "vitest";

import {
  MODBUS_TCP_HOSTS_ENV,
  ModbusTcpHostsConfigError,
  modbusTcpHostAllowed,
  parseModbusTcpHosts,
} from "./modbus-tcp-hosts";

/**
 * `F1.2` / ADR 0141 Amendment 1 (e), decision 22 — the `MODBUS_TCP_HOSTS`
 * allow-list the cloud ingest host checks before it dials a Modbus endpoint.
 *
 * Assertions live here; `modbus-tcp-hosts.test.ts` is the vitest entry point
 * (ADR 0014). Unset is the empty list and the empty list allows nothing (fail
 * closed); a bad entry is refused by its position, never by its text.
 */

function refusalOf(raw: string): Error {
  try {
    parseModbusTcpHosts(raw);
  } catch (err) {
    return err as Error;
  }
  throw new Error(`parseModbusTcpHosts accepted ${JSON.stringify(raw)}`);
}

export function assertUnsetAndBlankAreTheEmptyList(): void {
  expect(MODBUS_TCP_HOSTS_ENV).toBe("MODBUS_TCP_HOSTS");
  for (const raw of [undefined, "", "   ", " , ,, "]) {
    const allow = parseModbusTcpHosts(raw);
    expect(allow.names.size, `names for ${JSON.stringify(raw)}`).toBe(0);
    expect(allow.ipv4Cidrs, `cidrs for ${JSON.stringify(raw)}`).toEqual([]);
    for (const host of ["meter.site", "10.0.0.1", "::1", "0.0.0.0"]) {
      expect(modbusTcpHostAllowed(host, allow), `${host} on an empty list`).toBe(false);
    }
  }
}

export function assertEntriesAreTrimmedAndLowerCased(): void {
  const allow = parseModbusTcpHosts("  Meter-1.Site.Example ,10.0.0.5 ,, PLC2 ");
  expect([...allow.names].sort()).toEqual(["10.0.0.5", "meter-1.site.example", "plc2"]);
  expect(modbusTcpHostAllowed("meter-1.site.example", allow)).toBe(true);
  expect(modbusTcpHostAllowed("plc2", allow)).toBe(true);
}

export function assertNamesAndIpv4LiteralsMatchExactly(): void {
  const allow = parseModbusTcpHosts("meter.site,10.0.0.5");
  expect(modbusTcpHostAllowed("meter.site", allow)).toBe(true);
  expect(modbusTcpHostAllowed("10.0.0.5", allow)).toBe(true);
  // Exact match only: no suffix, no prefix, no neighbouring address.
  expect(modbusTcpHostAllowed("a.meter.site", allow)).toBe(false);
  expect(modbusTcpHostAllowed("meter.site.evil", allow)).toBe(false);
  expect(modbusTcpHostAllowed("10.0.0.6", allow)).toBe(false);
  expect(modbusTcpHostAllowed("10.0.0.50", allow)).toBe(false);
}

export function assertEquivalentIpv6SpellingsCompareEqual(): void {
  const allow = parseModbusTcpHosts("FE80:0:0:0:0:0:0:1, 2001:DB8::0:A");
  expect(modbusTcpHostAllowed("fe80::1", allow)).toBe(true);
  expect(modbusTcpHostAllowed("fe80:0000:0000:0000:0000:0000:0000:0001", allow)).toBe(true);
  expect(modbusTcpHostAllowed("2001:db8:0:0:0:0:0:a", allow)).toBe(true);
  expect(modbusTcpHostAllowed("2001:db8::a", allow)).toBe(true);
  expect(modbusTcpHostAllowed("fe80::2", allow)).toBe(false);
  expect(modbusTcpHostAllowed("::1", allow)).toBe(false);
  // The two spellings land on one entry.
  expect(parseModbusTcpHosts("fe80::1,FE80:0:0:0:0:0:0:1").names.size).toBe(1);
}

export function assertACidrIsNormalizedToItsNetwork(): void {
  const allow = parseModbusTcpHosts("10.0.0.7/24");
  expect(allow.ipv4Cidrs).toEqual([{ base: 0x0a000000, prefix: 24 }]);
  expect(allow.names.size).toBe(0);
  expect(modbusTcpHostAllowed("10.0.0.200", allow)).toBe(true);
  expect(modbusTcpHostAllowed("10.0.0.0", allow)).toBe(true);
  expect(modbusTcpHostAllowed("10.0.0.255", allow)).toBe(true);
  expect(modbusTcpHostAllowed("10.0.1.1", allow)).toBe(false);
  expect(modbusTcpHostAllowed("9.255.255.255", allow)).toBe(false);
}

export function assertTheSlashZeroAndSlashThirtyTwoEdges(): void {
  const all = parseModbusTcpHosts("192.168.1.1/0");
  expect(all.ipv4Cidrs).toEqual([{ base: 0, prefix: 0 }]);
  for (const host of ["0.0.0.0", "10.0.0.1", "255.255.255.255", "128.0.0.1"]) {
    expect(modbusTcpHostAllowed(host, all), `${host} in /0`).toBe(true);
  }
  const one = parseModbusTcpHosts("192.168.1.1/32");
  expect(one.ipv4Cidrs).toEqual([{ base: 0xc0a80101, prefix: 32 }]);
  expect(modbusTcpHostAllowed("192.168.1.1", one)).toBe(true);
  expect(modbusTcpHostAllowed("192.168.1.0", one)).toBe(false);
  expect(modbusTcpHostAllowed("192.168.1.2", one)).toBe(false);
  // A high base stays an unsigned 32-bit number.
  const high = parseModbusTcpHosts("255.255.255.0/31");
  expect(high.ipv4Cidrs).toEqual([{ base: 0xffffff00, prefix: 31 }]);
  expect(modbusTcpHostAllowed("255.255.255.1", high)).toBe(true);
  expect(modbusTcpHostAllowed("255.255.255.2", high)).toBe(false);
}

export function assertANameNeverMatchesACidr(): void {
  const allow = parseModbusTcpHosts("0.0.0.0/0");
  for (const host of ["meter.site", "localhost", "10.0.0.1.nip.io", "::ffff:a00:1"]) {
    expect(modbusTcpHostAllowed(host, allow), `${host} against /0`).toBe(false);
  }
}

export function assertEachBadEntryIsRefusedByPositionWithoutItsText(): void {
  const bad = [
    "host:502",
    "10.0.0.1:502",
    "[::1]",
    "fe80::1%eth0",
    "*.site",
    "10.0.0.0/33",
    "10.0.0.0/",
    "meter.site/24",
    "fe80::/64",
    "999.1.1.1",
    "0x7f000001",
    "127.0.0.0x1",
    "1.2.3",
    "010.0.0.1",
    "http://x",
    "a b",
    "user@host",
    "-bad.site",
    "1:2:3:4:5:6:7:8:9",
    "1::2::3",
  ];
  for (const entry of bad) {
    const err = refusalOf(`ok.site, 10.0.0.1 ,${entry}`);
    expect(err, entry).toBeInstanceOf(ModbusTcpHostsConfigError);
    expect(err.name).toBe("ModbusTcpHostsConfigError");
    expect(err.message).toBe("MODBUS_TCP_HOSTS entry 3 is not a host name, an IP address or an IPv4 CIDR block");
    expect(err.message.includes(entry), `the refusal echoed ${entry}`).toBe(false);
  }
  // The position counts empty entries, so it points at the comma-separated slot.
  expect(refusalOf("a.site,,host:502").message).toContain("entry 3 ");
  expect(refusalOf("host:502").message).toContain("entry 1 ");
}

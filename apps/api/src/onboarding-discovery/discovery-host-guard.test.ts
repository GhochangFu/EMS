import { describe, it } from "vitest";

import {
  assertAliasIsCaught,
  assertAwsComposeNamesAreBlocked,
  assertComposeNameIsRefusedBeforeLookup,
  assertDockerDesktopNamesAreBlocked,
  assertEveryResolvedAddressIsChecked,
  assertExtraServiceIsCaught,
  assertLookupFailureIsUnreachable,
  assertLookupTimeoutIsUnreachable,
  assertNameIsBlocked,
  assertNameIsNotBlocked,
  assertOwnSubnetLiteralIsRefused,
  assertOwnSubnetsSkipsLoopback,
  assertPermitted,
  assertPortRefusals,
  assertPortRule,
  assertPublicLiteralPassesWithoutLookup,
  assertRefused,
  assertResolvedAddressIsReturned,
  assertRootComposeNamesAreBlocked,
} from "./discovery-host-guard.spec";

/** `F3.24b` (ADR 0103 decision 3, Amendment 1) — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F3.24b — the discovery host guard", () => {
  describe("IPv4 ranges", () => {
    it("refuses 127.0.0.0/8 as loopback", () => assertRefused("127.0.0.2", "loopback"));
    it("refuses 0.0.0.0/8 as unspecified", () => assertRefused("0.1.2.3", "unspecified"));
    it("refuses 169.254.169.254 as link-local", () => assertRefused("169.254.169.254", "link-local"));
    it("refuses 224.0.0.0/4 as multicast", () => assertRefused("239.1.1.1", "multicast"));
    it("refuses the broadcast address", () => assertRefused("255.255.255.255", "reserved"));
    it("refuses an address in the worker's own subnet", () => assertRefused("172.18.200.1", "own subnet"));
    it("permits 10.0.0.5 (ruling 3)", () => assertPermitted("10.0.0.5"));
    it("permits 192.168.1.10 (ruling 3)", () => assertPermitted("192.168.1.10"));
    it("permits 172.19.0.1, outside the worker's /16", () => assertPermitted("172.19.0.1"));
    it("permits a public address", () => assertPermitted("93.184.216.34"));
  });

  describe("IPv6 ranges", () => {
    it("refuses :: as unspecified", () => assertRefused("::", "unspecified"));
    it("refuses ::1 as loopback", () => assertRefused("::1", "loopback"));
    it("refuses fe80::/10 as link-local", () => assertRefused("fe80::1%eth0", "link-local"));
    it("refuses ff00::/8 as multicast", () => assertRefused("ff02::1", "multicast"));
    it("refuses fd00:ec2::254 as cloud metadata", () => assertRefused("fd00:ec2::254", "cloud metadata"));
    it("refuses fd00:ec2::23 as cloud metadata", () => assertRefused("fd00:ec2::23", "cloud metadata"));
    it("refuses an address in the worker's own IPv6 subnet", () => assertRefused("fd12:3456:789a::9", "own subnet"));
    it("permits a global IPv6 address", () => assertPermitted("2606:2800:220:1::1"));
  });

  describe("IPv6 forms that carry an IPv4 address are checked again", () => {
    it("::ffff:127.0.0.1 reads as loopback", () => assertRefused("::ffff:127.0.0.1", "loopback"));
    it("::ffff:169.254.169.254 reads as link-local", () => assertRefused("::ffff:169.254.169.254", "link-local"));
    it("::ffff:7f00:1 (hex form) reads as loopback", () => assertRefused("::ffff:7f00:1", "loopback"));
    it("::ffff:172.18.0.2 reads as own subnet", () => assertRefused("::ffff:172.18.0.2", "own subnet"));
    it("::127.0.0.1 (IPv4-compatible) reads as loopback", () => assertRefused("::127.0.0.1", "loopback"));
    it("64:ff9b::a9fe:a9fe (NAT64) reads as link-local", () => assertRefused("64:ff9b::a9fe:a9fe", "link-local"));
    it("2002:7f00:1:: (6to4) reads as loopback", () => assertRefused("2002:7f00:1::", "loopback"));
    it("::ffff:93.184.216.34 is permitted", () => assertPermitted("::ffff:93.184.216.34"));
  });

  describe("names", () => {
    it("refuses a compose service name, case- and trailing-dot-insensitively", () => assertNameIsBlocked("Postgres."));
    it("refuses host.docker.internal", () => assertNameIsBlocked("host.docker.internal"));
    it("refuses a *.localhost name", () => assertNameIsBlocked("evil.localhost"));
    it("refuses a compose container name (bms-redis-1)", () => assertNameIsBlocked("bms-redis-1"));
    it("refuses a v1 compose container name (bms_worker_2)", () => assertNameIsBlocked("bms_worker_2"));
    it("passes a public broker name", () => assertNameIsNotBlocked("phe.thinkiot.co.in"));
    it("passes a name that only contains a service name", () => assertNameIsNotBlocked("redis.example.com"));
    it("keeps Docker Desktop's names and localhost in the constant", () => assertDockerDesktopNamesAreBlocked());
  });

  describe("the compose files", () => {
    it("every name in docker-compose.yml is refused", () => assertRootComposeNamesAreBlocked());
    it("every name in deploy/aws/docker-compose.yml is refused", () => assertAwsComposeNamesAreBlocked());
    it("negative control: a fixture with an extra service reports it", () => assertExtraServiceIsCaught());
    it("negative control: a fixture's aliases and hostname are read", () => assertAliasIsCaught());
  });

  describe("ports", () => {
    it("accepts 1, 8883 and 65535", () => assertPortRule());
    it("refuses 0, 65536, 70000, 1.5, NaN and a string", () => assertPortRefusals());
  });

  describe("resolveBrokerHost", () => {
    it("checks every resolved address", () => assertEveryResolvedAddressIsChecked());
    it("returns the first checked address", () => assertResolvedAddressIsReturned());
    it("reads a failed lookup as host unreachable", () => assertLookupFailureIsUnreachable());
    it("reads a lookup that never answers as host unreachable", () => assertLookupTimeoutIsUnreachable());
    it("refuses a compose name before any lookup", () => assertComposeNameIsRefusedBeforeLookup());
    it("refuses an IP literal in the worker's own subnet", () => assertOwnSubnetLiteralIsRefused());
    it("checks a public IP literal directly, with no lookup", () => assertPublicLiteralPassesWithoutLookup());
    it("ownSubnets reads non-internal interfaces only", () => assertOwnSubnetsSkipsLoopback());
  });
});

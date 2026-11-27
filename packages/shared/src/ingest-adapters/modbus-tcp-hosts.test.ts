import { describe, it } from "vitest";

import {
  assertACidrIsNormalizedToItsNetwork,
  assertANameNeverMatchesACidr,
  assertEachBadEntryIsRefusedByPositionWithoutItsText,
  assertEntriesAreTrimmedAndLowerCased,
  assertEquivalentIpv6SpellingsCompareEqual,
  assertNamesAndIpv4LiteralsMatchExactly,
  assertTheSlashZeroAndSlashThirtyTwoEdges,
  assertUnsetAndBlankAreTheEmptyList,
} from "./modbus-tcp-hosts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the MODBUS_TCP_HOSTS allow-list (ADR 0141 decision 22)", () => {
  it("H1 reads unset and blank as the empty list, which allows nothing", () => {
    assertUnsetAndBlankAreTheEmptyList();
  });

  it("H2 trims and lower-cases each entry", () => {
    assertEntriesAreTrimmedAndLowerCased();
  });

  it("H3 matches a name and an IPv4 literal exactly", () => {
    assertNamesAndIpv4LiteralsMatchExactly();
  });

  it("H4 compares equivalent IPv6 spellings equal", () => {
    assertEquivalentIpv6SpellingsCompareEqual();
  });

  it("H5 normalizes a CIDR to its network address", () => {
    assertACidrIsNormalizedToItsNetwork();
  });

  it("H6 holds the /0 and /32 edges", () => {
    assertTheSlashZeroAndSlashThirtyTwoEdges();
  });

  it("H7 never matches a name against a CIDR", () => {
    assertANameNeverMatchesACidr();
  });

  it("H8 refuses a bad entry by position, never echoing it", () => {
    assertEachBadEntryIsRefusedByPositionWithoutItsText();
  });
});

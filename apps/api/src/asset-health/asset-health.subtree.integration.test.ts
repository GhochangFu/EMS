import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertACampusFilterCountsTheWholeSubtree,
  assertAnUnknownNodeCountsNothing,
  assertAnUnreadableAncestorOrForeignNodeIsEmpty,
  assertASiblingSubtreeIsExcluded,
  assertASiteFilterCountsItsOwnSubtreeOnly,
  assertTheFilterNarrowsAndNeverWidens,
} from "./asset-health.subtree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F2.10` — Vitest entry point for the health summary's subtree filter.
 * Assertions live in the sibling `.spec` (§4.6); this file owns the fleet
 * pool. Every case rolls its own transaction back, so there is nothing to
 * delete in `afterAll`.
 */
const connectionString = requireIntegrationDb({
  item: "F2.10",
  label: "health summary subtree filter integration tests",
  because:
    "whether a location filter on the health donut covers the node's whole subtree is SQL inside " +
    "assetsInScope, and a green run without a database asserts nothing about it.",
});

describe.skipIf(!connectionString)("F2.10 — the health summary's locationId means the node's subtree", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F2.10");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("a campus filter counts the campus, site and room assets", async () => {
    await assertACampusFilterCountsTheWholeSubtree(pool);
  }, 60_000);

  it("a site filter counts its own subtree and not the campus above it", async () => {
    await assertASiteFilterCountsItsOwnSubtreeOnly(pool);
  }, 60_000);

  it("a sibling root's asset is excluded from the campus filter", async () => {
    await assertASiblingSubtreeIsExcluded(pool);
  }, 60_000);

  it("the subtree narrows the readable set and never widens it", async () => {
    await assertTheFilterNarrowsAndNeverWidens(pool);
  }, 60_000);

  it("an unreadable ancestor or another organization's node answers the empty summary (owner ruling P2)", async () => {
    await assertAnUnreadableAncestorOrForeignNodeIsEmpty(pool);
  }, 60_000);

  it("an unknown location id answers an empty donut", async () => {
    await assertAnUnknownNodeCountsNothing(pool);
  }, 60_000);
});

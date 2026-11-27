import { describe, it } from "vitest";

import {
  runG1,
  runG2,
  runG3,
  runG4,
  runG5,
  runG6,
  runG7,
  runK1,
  runK2,
  runK3,
  runK4,
  runK5,
  runK6,
  runK7,
  runS1,
  runS2,
  runS3,
  runS4,
  runS5,
  runS6,
  runS7,
} from "./location-kpi-groups.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("location-kpi-groups", () => {
  it("K1 — freshLocationCount counts only sites with fresh telemetry", () => {
    runK1();
  });

  it("K2 — organizations sort by code, sites sort by name", () => {
    runK2();
  });

  it("K3 — a site is live from one fresh asset (F4.259)", () => {
    runK3();
  });

  it("K4 — the live split keeps the input order in both lists (F4.259)", () => {
    runK4();
  });

  it("K5 — the section kW sums only the energy locations' numbers (F4.364)", () => {
    runK5();
  });

  it("K6 — no energy location gives a null section kW (F4.364)", () => {
    runK6();
  });

  it("K7 — anyEnergyShown is true when one location shows energy (F4.375)", () => {
    runK7();
  });

  it("G1 — no item has a parent: no group, every item loose (F4.240)", () => {
    runG1();
  });

  it("G2 — six asset-less parents over twelve children: 12 sites, 6 groups (F4.240)", () => {
    runG2();
  });

  it("G3 — a parent that holds an asset is a site, first in its group (F4.240)", () => {
    runG3();
  });

  it("G4 — the group roll-up sums live sites, sites, assets and alarms (F4.240)", () => {
    runG4();
  });

  it("G5 — a group with one live site sits in Live, whole (F4.240)", () => {
    runG5();
  });

  it("G6 — a child with a null parentId is loose (F4.240)", () => {
    runG6();
  });

  it("G7 — three levels: the nearest parent is the header (F4.240)", () => {
    runG7();
  });

  it("S1 — an asset-less parent over two sites is a station, sites in input order (F4.240 part b)", () => {
    runS1();
  });

  it("S2 — a leaf is no station (F4.240 part b)", () => {
    runS2();
  });

  it("S3 — a parent that holds assets is no station (F4.240 part b)", () => {
    runS3();
  });

  it("S4 — an id not in the items is no station (F4.240 part b)", () => {
    runS4();
  });

  it("S5 — an asset-less grandparent over asset-less parents is no station (F4.240 part b)", () => {
    runS5();
  });

  it("S6 — the roll-up sentence reads live of sites, assets and alarms (F4.240 part b)", () => {
    runS6();
  });

  it("S7 — sectionKw sums only shown sites and is null with no number (F4.240 part b)", () => {
    runS7();
  });
});

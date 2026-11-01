/**
 * `@bms/shared/contracts` — the runtime half of this package (ADR 0030
 * decision 2).
 *
 * These schemas ARE the response contracts. Every corresponding type on the
 * root entry is `z.infer` of one of them, so there is no second description to
 * drift — ADR 0029 decision 1's thesis applied to the response side.
 *
 * **The subpath does not reach `apps/api`, and that is measured, not assumed.**
 * `apps/api` compiles with `moduleResolution: "node"` (node10), which ignores
 * the package `exports` map entirely; `tsc` reports *"There are types at
 * …/dist/contracts/index.d.ts, but this result could not be resolved under your
 * current 'moduleResolution' setting."* Node's own runtime resolution honours
 * `exports` and works, which is the dangerous half — it would have compiled
 * nowhere and run fine. `index.ts` therefore re-exports everything here, the
 * same workaround `./ingest` already uses and for the same documented reason.
 * See ADR 0030 Amendment 2.
 *
 * So: `apps/web` may import `@bms/shared/contracts` and get the contract/
 * constant separation decision 2 wanted. `apps/api` imports from `@bms/shared`
 * until its module resolution changes, which is its own decision.
 */
export * from "./admin";
// F4.298 (ADR 0108 decisions 2.8 and 2.11): the one AggregateLevel enum, the
// energy view contract, and the one site time-zone chain.
export * from "./aggregate-level";
export * from "./energy-organization-views";
export * from "./energy-view";
export * from "./time-zone-chain";
// F4.297 (ADR 0108 decision 1.2): the telemetry read query schemas.
export * from "./telemetry-queries";
export * from "./ai-assistant";
export * from "./asset-dashboards";
export * from "./asset-images";
export * from "./alarm-stats";
export * from "./point-stats";
export * from "./asset-kpis";
export * from "./asset-templates";
export * from "./auth";
export * from "./copilot";
export * from "./dashboard";
export * from "./dashboard-builder";
export * from "./dashboard-dto";
export * from "./dashboard-tabs";
export * from "./dashboard-templates";
export * from "./envelopes";
export * from "./escalation";
export * from "./generated-site-view";
export * from "./health";
export * from "./if-match";
export * from "./location-types";
export * from "./location-type-writes";
export * from "./mapping-sheet";
export * from "./metric-catalog-values";
export * from "./mimic";
export * from "./mimic-config";
export * from "./mimic-layouts";
export * from "./mimic-shapes";
export * from "./mimic-symbol-libraries";
export * from "./mimic-symbol-library-catalog";
export type * from "./schema-types";
export * from "./notifications";
export * from "./onboarding";
export * from "./onboarding-discovery";
export * from "./operations";
export * from "./point-keys";
export * from "./point-key-states";
export * from "./point-metadata";
export * from "./point-metadata-writes";
export * from "./reports";
export * from "./seeded-rules";
export * from "./site-control-room-views";
export * from "./asset-group-writes";
export * from "./asset-role-writes";
export * from "./asset-point-writes";
export * from "./asset-writes";
export * from "./location-writes";
export * from "./mimic-layout-writes";
export * from "./mimic-symbol-library-writes";
export * from "./point-key-writes";
export * from "./trend-points";
export * from "./rtu-writes";
export * from "./rule-writes";
export * from "./notification-writes";
export * from "./escalation-writes";
export * from "./query-values";
export * from "./report-writes";
export * from "./maintenance-writes";
// F4.284 (ADR 0106, ADR 0030): the alarm and work-order write bodies.
export * from "./operations-writes";
export * from "./site-control-room-view-writes";
export * from "./site-layout-writes";
export * from "./asset-template-content-writes";
export * from "./asset-template-writes";
export * from "./asset-template-instantiate-writes";
export * from "./calc-override-writes";
export * from "./calc-parameter-writes";
export * from "./dashboard-template-writes";
export * from "./dashboard-writes";
export * from "./site-layout";
export * from "./site-widgets";
export * from "./system-status";
export * from "./telemetry-entry";
export * from "./telemetry-import";
export * from "./template-lifecycle";
export * from "./template-migration";
export * from "./user-grants";
export * from "./users";
export type { Assignable, Measured, Strict } from "./equality";

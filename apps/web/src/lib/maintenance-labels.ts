import type {
  MaintenanceGenerationMode,
  MaintenanceScheduleCategory,
  WorkOrderPriority,
} from "@bms/shared";

/**
 * The display labels for the three maintenance vocabularies (`F2.19`,
 * ADR 0038 Amendment 5 Part B).
 *
 * **Why these left `maintenance-schedules-panel.tsx`.** The panel wrote all
 * twenty-three of these strings when it was the only surface that showed a
 * maintenance category. The Maintenance tab is now the second, and two copies
 * of one vocabulary's labels is exactly the drift this repository warns about:
 * a category renamed on one screen and not the other says the same code means
 * two different things in one product. The panel imports these and holds none
 * of its own.
 *
 * **The `Record<Enum, string>` type is the whole gate, and it is deliberate.**
 * There is no spec beside this file, because three constant records hold no
 * rule to assert — an assertion would only restate the literals. What a test
 * cannot do, the type does: a fifteenth category added to
 * `maintenanceScheduleCategorySchema` makes this file fail `pnpm typecheck`
 * with a missing-key error naming the new code, rather than rendering a raw
 * `condition_based` to an operator on a screen nobody re-read. Keep the keyed
 * `Record`; a plain `Record<string, string>` compiles and protects nothing.
 *
 * The three source enums live in `packages/shared/src/contracts/operations.ts`
 * — `maintenanceScheduleCategorySchema`, `maintenanceGenerationModeSchema` and
 * `workOrderPrioritySchema`. They are **not** in `GET /api/v1/vocabularies`:
 * that payload carries rule categories, domains, severities, skills, roles and
 * sections, and none of these three. They are closed unions in the contract,
 * which is why a label map keyed by the union is the right shape here and
 * a fetched `{ code, label }` list is the right shape there.
 */

export const WORK_ORDER_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const MAINTENANCE_CATEGORY_LABELS: Record<MaintenanceScheduleCategory, string> = {
  preventive: "Preventive maintenance",
  predictive: "Predictive maintenance",
  condition_based: "Condition-based maintenance",
  compliance: "Compliance / statutory",
  amc: "AMC / vendor contract",
  calibration: "Calibration",
  runtime_based: "Runtime-based",
  seasonal: "Seasonal",
  inspection_round: "Inspection rounds",
  corrective_follow_up: "Corrective follow-up",
  deferred_backlog: "Deferred backlog",
  shutdown_outage: "Shutdown / outage",
  energy_optimization: "Energy optimization",
  safety_critical: "Safety-critical",
};

export const MAINTENANCE_GENERATION_MODE_LABELS: Record<MaintenanceGenerationMode, string> = {
  manual: "Manual",
  calendar: "Calendar",
  runtime: "Runtime",
  condition: "Condition",
  predictive: "Predictive",
};

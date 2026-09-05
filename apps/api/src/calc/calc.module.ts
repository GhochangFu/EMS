import { Module } from "@nestjs/common";

import { TelemetryModule } from "../telemetry/telemetry.module";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { CalcInputsService } from "./calc-inputs.service";
import { CalcSchedulerService } from "./calc-scheduler.service";
import { CalcScopeService } from "./calc-scope.service";
import { CalcStreamingService } from "./calc-streaming.service";
import { CalcWriteService } from "./calc-write.service";

/**
 * The `F2.4` calc execution engine (ADR 0037). `DatabaseModule`'s tokens
 * (`AUTH_DRIZZLE`/`TENANT_DRIZZLE`/`FLEET_DRIZZLE` since ADR 0043) and
 * `MetricsService` (`ObservabilityModule`) are both `@Global()`, so only
 * `TelemetryModule` needs importing here, for `TelemetryBroadcastHub`.
 *
 * No controller — this module exposes no HTTP route; both hosts start with
 * the API process via their own `onModuleInit`. Nothing outside this module
 * consumes a calc service yet, so nothing is exported.
 *
 * ---
 *
 * **Manual fixture recipe** — F2.4 ships no authoring UI (`F2.5`) and no
 * seed data of its own (`F2.4`'s ADR-gate decision: a manual recipe, not a
 * seed addition, keeps `packages/db`'s seed surface — and `migration-reviewer`'s
 * review scope — out of a diff that is otherwise pure `apps/api`). To see the
 * engine compute something end to end against the dev stack, run this SQL
 * once against `bms_app` (swap in a real org id / active location id / an
 * active catalog point key from `bms.point_keys` for that org):
 *
 * ```sql
 * INSERT INTO bms.asset_templates (organization_id, code, version, name, asset_type, domain, status, published_at)
 * VALUES ('<org-id>', 'F24-DEMO', 1, 'F2.4 Demo Template', 'test_rig', 'electrical', 'published', now())
 * RETURNING id;  -- <template-id>
 *
 * INSERT INTO bms.template_points (template_id, point_key, kind, sort_order)
 * VALUES ('<template-id>', '<measured-catalog-key>', 'measured', 0);
 *
 * INSERT INTO bms.template_points (template_id, point_key, kind, formula, formula_dialect, calc_trigger, sort_order)
 * VALUES ('<template-id>', 'DEMO_DOUBLED', 'derived', '{<measured-catalog-key>} * 2', 'bms-calc-v1', 'streaming', 1);
 *
 * INSERT INTO bms.template_points
 *   (template_id, point_key, kind, formula, formula_dialect, calc_trigger, calc_interval_seconds, sort_order)
 * VALUES ('<template-id>', 'DEMO_SCHEDULED', 'derived', '{<measured-catalog-key>} + 1', 'bms-calc-v1', 'scheduled', 15, 2);
 *
 * INSERT INTO bms.assets (code, name, site_name, location_id, domain, template_id)
 * VALUES ('F24-DEMO-ASSET-01', 'F2.4 Demo Asset', 'Demo Site', '<location-id>', 'electrical', '<template-id>')
 * RETURNING id;  -- <asset-id>
 * ```
 *
 * Then, once `CalcDefinitionsService`'s 60s cache has had a chance to pick
 * the new template up (a fresh `docker compose up -d api` starts with an
 * empty cache and loads on first use, so the very first check can be
 * immediate; a long-running process may need up to 60s):
 *
 * ```sql
 * INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
 * VALUES (now(), '<asset-id>', '<measured-catalog-key>', 12.6, 'V');
 * SELECT pg_notify('bms_telemetry', json_build_object(
 *   'readings', json_build_array(json_build_object(
 *     'time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 *     'assetId', '<asset-id>', 'pointKey', '<measured-catalog-key>', 'value', 12.6, 'unit', 'V'
 *   ))
 * )::text);
 * ```
 *
 * `DEMO_DOUBLED` should appear within a second or two (`SELECT * FROM
 * telemetry.point_values WHERE point_key = 'DEMO_DOUBLED'`); `DEMO_SCHEDULED`
 * within its next 15s-bucketed tick. Both should also produce a
 * `bms.asset_points` row with `source_kind = 'computed'`, `rtu_id IS NULL`.
 * See ADR 0037's own worked verification for the full checklist (§6 of the
 * step-3 plan this item was built from).
 */
@Module({
  imports: [TelemetryModule],
  providers: [
    CalcDefinitionsService,
    CalcInputsService,
    // `F2.9` Task 11 — membership resolution for `bms-calc-v2` (ADR 0055
    // decision 12). Provided here; Task 12 exports the detector built on it.
    CalcScopeService,
    CalcWriteService,
    CalcStreamingService,
    CalcSchedulerService,
  ],
})
export class CalcModule {}

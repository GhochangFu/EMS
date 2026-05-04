CREATE TEMP TABLE IF NOT EXISTS tmp_smoc_pretoria_north_locations ON COMMIT DROP AS
SELECT id
FROM bms.locations
WHERE name = 'SMOC Pretoria North'
   OR slug = 'smoc-pretoria-north';
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS tmp_smoc_pretoria_north_assets ON COMMIT DROP AS
SELECT a.id
FROM bms.assets AS a
WHERE a.location_id IN (SELECT id FROM tmp_smoc_pretoria_north_locations)
   OR a.site_name = 'SMOC Pretoria North';
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS tmp_smoc_pretoria_north_rules ON COMMIT DROP AS
SELECT r.id
FROM bms.automation_rules AS r
WHERE r.asset_id IN (SELECT id FROM tmp_smoc_pretoria_north_assets);
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS tmp_smoc_pretoria_north_work_orders ON COMMIT DROP AS
SELECT wo.id
FROM bms.work_orders AS wo
WHERE wo.asset_id IN (SELECT id FROM tmp_smoc_pretoria_north_assets);
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS tmp_smoc_pretoria_north_templates ON COMMIT DROP AS
SELECT mt.id
FROM bms.maintenance_task_templates AS mt
WHERE mt.asset_id IN (SELECT id FROM tmp_smoc_pretoria_north_assets);
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS tmp_smoc_pretoria_north_schedules ON COMMIT DROP AS
SELECT ms.id
FROM bms.maintenance_schedules AS ms
WHERE ms.template_id IN (SELECT id FROM tmp_smoc_pretoria_north_templates);
--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS tmp_smoc_pretoria_north_groups ON COMMIT DROP AS
SELECT ag.id
FROM bms.asset_groups AS ag
WHERE ag.location_id IN (SELECT id FROM tmp_smoc_pretoria_north_locations);
--> statement-breakpoint
DELETE FROM telemetry.point_values AS pv
USING tmp_smoc_pretoria_north_assets AS target
WHERE pv.asset_id = target.id;
--> statement-breakpoint
DELETE FROM bms.rule_executions AS re
USING tmp_smoc_pretoria_north_rules AS target
WHERE re.rule_id = target.id;
--> statement-breakpoint
DELETE FROM bms.maintenance_history AS mh
WHERE mh.asset_id IN (SELECT id FROM tmp_smoc_pretoria_north_assets)
   OR mh.schedule_id IN (SELECT id FROM tmp_smoc_pretoria_north_schedules)
   OR mh.template_id IN (SELECT id FROM tmp_smoc_pretoria_north_templates)
   OR mh.work_order_id IN (SELECT id FROM tmp_smoc_pretoria_north_work_orders);
--> statement-breakpoint
DELETE FROM bms.work_order_tasks AS wot
USING tmp_smoc_pretoria_north_work_orders AS target
WHERE wot.work_order_id = target.id;
--> statement-breakpoint
DELETE FROM bms.maintenance_schedules AS ms
USING tmp_smoc_pretoria_north_schedules AS target
WHERE ms.id = target.id;
--> statement-breakpoint
DELETE FROM bms.work_orders AS wo
USING tmp_smoc_pretoria_north_work_orders AS target
WHERE wo.id = target.id;
--> statement-breakpoint
DELETE FROM bms.alarms AS al
USING tmp_smoc_pretoria_north_assets AS target
WHERE al.asset_id = target.id;
--> statement-breakpoint
DELETE FROM bms.maintenance_task_templates AS mt
USING tmp_smoc_pretoria_north_templates AS target
WHERE mt.id = target.id;
--> statement-breakpoint
DELETE FROM bms.automation_rules AS r
USING tmp_smoc_pretoria_north_rules AS target
WHERE r.id = target.id;
--> statement-breakpoint
DELETE FROM bms.asset_group_members AS agm
WHERE agm.asset_id IN (SELECT id FROM tmp_smoc_pretoria_north_assets)
   OR agm.asset_group_id IN (SELECT id FROM tmp_smoc_pretoria_north_groups);
--> statement-breakpoint
DELETE FROM bms.user_asset_group_access AS uaga
USING tmp_smoc_pretoria_north_groups AS target
WHERE uaga.asset_group_id = target.id;
--> statement-breakpoint
DELETE FROM bms.asset_groups AS ag
USING tmp_smoc_pretoria_north_groups AS target
WHERE ag.id = target.id;
--> statement-breakpoint
DELETE FROM bms.user_location_access AS ula
USING tmp_smoc_pretoria_north_locations AS target
WHERE ula.location_id = target.id;
--> statement-breakpoint
DELETE FROM bms.assets AS a
USING tmp_smoc_pretoria_north_assets AS target
WHERE a.id = target.id;
--> statement-breakpoint
DELETE FROM bms.map_locations
WHERE slug = 'smoc-pretoria-north'
   OR name = 'SMOC Pretoria North'
   OR site_name = 'SMOC Pretoria North';
--> statement-breakpoint
DELETE FROM bms.locations AS l
USING tmp_smoc_pretoria_north_locations AS target
WHERE l.id = target.id;

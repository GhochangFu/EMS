UPDATE "bms"."maintenance_task_templates"
SET
  "category" = 'condition_based',
  "generation_mode" = 'condition',
  "owner_team" = 'Cooling operations',
  "trigger_summary" = 'Filter pressure and condensate condition review'
WHERE "title" = 'CRAC filter and condensate check';
--> statement-breakpoint
UPDATE "bms"."maintenance_task_templates"
SET
  "category" = 'energy_optimization',
  "generation_mode" = 'predictive',
  "owner_team" = 'Energy operations',
  "trigger_summary" = 'Thermal trend and inverter derating review'
WHERE "title" = 'PV inverter thermal inspection';
--> statement-breakpoint
UPDATE "bms"."maintenance_task_templates"
SET
  "owner_team" = 'Electrical maintenance'
WHERE "title" = 'UPS battery string inspection';

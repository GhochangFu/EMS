INSERT INTO bms.automation_rules (
  code,
  name,
  description,
  category,
  rule_type,
  source,
  enabled,
  lifecycle_status,
  published_at,
  asset_id,
  point_key,
  operator,
  threshold_value,
  severity,
  condition,
  action
)
SELECT
  'PHE_' || replace(a.code, '-', '_') || '_VOLTAGE_CRITICAL',
  a.name || ' L1 voltage critical',
  'IF L1 voltage is at or above 239.5 V THEN raise a critical alarm.',
  'electrical',
  'threshold',
  'phe_alarm_seed',
  true,
  'published',
  now(),
  a.id,
  'voltage_l1_v',
  'gte',
  239.5,
  'critical',
  '{"window":"latest","unit":"V","alarmMessage":"voltage_l1_critical"}'::jsonb,
  '{"type":"notify","target":"PHE operations"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
WHERE o.code = 'PHEWB'
  AND a.code LIKE 'PHE-MFM-%'
  AND NOT EXISTS (
    SELECT 1
    FROM bms.automation_rules AS r
    WHERE r.asset_id = a.id
      AND r.point_key = 'voltage_l1_v'
      AND r.severity = 'critical'
      AND r.source = 'phe_alarm_seed'
  );
--> statement-breakpoint
INSERT INTO bms.automation_rules (
  code,
  name,
  description,
  category,
  rule_type,
  source,
  enabled,
  lifecycle_status,
  published_at,
  asset_id,
  point_key,
  operator,
  threshold_value,
  severity,
  condition,
  action
)
SELECT
  'PHE_' || replace(a.code, '-', '_') || '_VOLTAGE_WARN',
  a.name || ' L1 voltage warning',
  'IF L1 voltage is at or above 237 V THEN raise a warning alarm.',
  'electrical',
  'threshold',
  'phe_alarm_seed',
  true,
  'published',
  now(),
  a.id,
  'voltage_l1_v',
  'gte',
  237,
  'warning',
  '{"window":"latest","unit":"V","alarmMessage":"voltage_l1_high"}'::jsonb,
  '{"type":"notify","target":"PHE operations"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
WHERE o.code = 'PHEWB'
  AND a.code LIKE 'PHE-MFM-%'
  AND NOT EXISTS (
    SELECT 1
    FROM bms.automation_rules AS r
    WHERE r.asset_id = a.id
      AND r.point_key = 'voltage_l1_v'
      AND r.severity = 'warning'
      AND r.source = 'phe_alarm_seed'
  );
--> statement-breakpoint
INSERT INTO bms.automation_rules (
  code,
  name,
  description,
  category,
  rule_type,
  source,
  enabled,
  lifecycle_status,
  published_at,
  asset_id,
  point_key,
  operator,
  threshold_value,
  severity,
  condition,
  action
)
SELECT
  'PHE_' || replace(a.code, '-', '_') || '_BREAKER_OPEN',
  a.name || ' main breaker open',
  'IF main breaker / pump status drops below 0.5 THEN raise a critical alarm.',
  'electrical',
  'threshold',
  'phe_alarm_seed',
  true,
  'published',
  now(),
  a.id,
  'breaker_main',
  'lt',
  0.5,
  'critical',
  '{"window":"latest","alarmMessage":"breaker_main_open"}'::jsonb,
  '{"type":"notify","target":"PHE operations"}'::jsonb
FROM bms.assets AS a
INNER JOIN bms.locations AS l ON l.id = a.location_id
INNER JOIN bms.organizations AS o ON o.id = l.organization_id
INNER JOIN bms.rtus AS r ON r.id = a.rtu_id
WHERE o.code = 'PHEWB'
  AND (a.code LIKE 'PHE-PUMP-%' OR a.code LIKE 'PHE-PUMP-M-%')
  AND NOT EXISTS (
    SELECT 1
    FROM bms.automation_rules AS ar
    WHERE ar.asset_id = a.id
      AND ar.point_key = 'breaker_main'
      AND ar.source = 'phe_alarm_seed'
  );

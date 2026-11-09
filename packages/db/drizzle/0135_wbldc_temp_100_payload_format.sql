-- ADR 0119 decision 6 (F4.343) — seed the `wbldc-temp-100` payload format.
--
-- WBLDC's cold-chain gateways publish one fixed 100-byte little-endian record
-- a minute: six uint16 local-time fields (IST, +05:30) at bytes 4-15, then
-- int16 readings in tenths of a degree Celsius from byte 16; 0x8001 and 0x8002
-- mark a faulted or absent probe. This row is the first `binary` format
-- (ADR 0119 decision 1): sixteen raw channels, temp_ch0..temp_ch15, read with
-- scale 0.1 and those two codes as sentinels. Every WBLDC topic uses it; the
-- topic is the device key (ruling R4).
--
-- **Calibration is not here.** The vendor portal adds a constant per-sensor
-- offset; that belongs on each asset point's own `scale_offset` at onboarding
-- (ruling R5), never in this shared format.
--
-- **Why a seed and not an admin create.** AWS gets the row at deploy, with no
-- manual step (the `0130` precedent for `thinkiot-register-array`).
-- `ON CONFLICT DO NOTHING` without a target, the `0038` reasoning: a re-run
-- never reverts an admin's later edit of this row.
--
-- **No DDL and no SET ROLE.** The table exists since `0130`; a row has no
-- owner, and the migrator already writes this table. Nothing is granted or
-- revoked.
--
-- Forward-only and idempotent. No statement-breakpoint markers, following
-- `0130` — do not write that marker's literal text anywhere in this file, not
-- even inside a comment.

INSERT INTO bms.mqtt_payload_formats (code, name, description, definition, builtin) VALUES
  ('wbldc-temp-100', 'WBLDC temperature record (100 bytes)',
   'Binary, 100 bytes, little-endian: six uint16 local-time fields (IST, +05:30) at bytes 4-15, sixteen int16 channels in tenths of a degree Celsius from byte 16 (temp_ch0..temp_ch15); 0x8001 and 0x8002 mark a faulted or absent probe. WBLDC cold-chain gateways; one topic per gateway.',
   '{"kind":"binary","length":100,"byteOrder":"little","time":{"fields":{"year":4,"month":6,"day":8,"hour":10,"minute":12,"second":14},"utcOffsetMinutes":330},"readings":[{"key":"temp_ch0","byte":16,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch1","byte":18,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch2","byte":20,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch3","byte":22,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch4","byte":24,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch5","byte":26,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch6","byte":28,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch7","byte":30,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch8","byte":32,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch9","byte":34,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch10","byte":36,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch11","byte":38,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch12","byte":40,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch13","byte":42,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch14","byte":44,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]},{"key":"temp_ch15","byte":46,"type":"int16","scale":0.1,"sentinels":[-32767,-32766]}]}'::jsonb,
   false)
ON CONFLICT DO NOTHING;

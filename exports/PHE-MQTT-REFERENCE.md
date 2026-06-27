# PHE MQTT payload reference (pilot RTU)

**Pilot:** Bhutnirghat I (`EdgeRTUId = 13`)  
**MQTT topic:** `Airsprint-1051/Data/861736076104923` (`EdgeRTU.EdgeRTUName`)  
**Broker:** `phe.thinkiot.co.in:8883` (TLS)

## Sample `EdgeRTUTrx.RawData`

```json
{
  "dev_id": "861736076104923",
  "ts": "1782472726000",
  "rssi": "29",
  "values": {
    "di1": "1",
    "di2": "1",
    "pwr_stat": "1",
    "batt_volt": "100.00",
    "s09_r01": "10.81",
    "s01_r01": "237.66",
    "s08_r02": "50.06"
  }
}
```

## Mapping rule

| `DeviceSensor.DataKey` | Device | BMS `point_key` |
|------------------------|--------|-----------------|
| `s09_r01` | MFM-* | `kw` |
| `s01_r01` | MFM-* | `voltage_l1_v` |
| `di1` | PUMP-M-* | `breaker_main` |
| `di2` | PUMP-C-* | `chlorine_pump_on` |
| `batt_volt` | AIRSP-* | `battery_charge_pct` |
| `rssi` | AIRSP-* | `network_strength` |

Full catalog: `exports/phewb-bms-point-mapping-suggestions.csv`  
Postgres hierarchy: `bms.organizations` → `bms.locations` (station) → `bms.rtus` → `bms.assets` → `bms.asset_points`

## Start ingest (Docker)

```bash
# Set credentials in shell or .env (never commit)
export MQTT_USERNAME=your_user
export MQTT_PASSWORD=your_password

docker compose --profile phe up -d ingest api
```

Only RTUs with `ingest_enabled = true` and `source_type = 'mqtt'` receive live MQTT writes. Simulator skips assets with `meta.telemetrySource = 'mqtt'`.

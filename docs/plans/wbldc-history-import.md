# WBLDC cold-room history import (for ADR 0135 ML readiness)

**Run this on the owner's own computer** (Claude Desktop app session). The
WBLDC MySQL server is not reachable from cloud sessions. Goal: load the cold
rooms' past readings into `bms.demosites.co.in` so WBLDC passes 28 days of real
history (anomaly READY), and 56 days if possible (forecasting READY).

## Rules

- **MySQL is read-only.** Only `SHOW`, `DESCRIBE` and `SELECT`. Never write,
  alter or drop anything there.
- **The MySQL password never goes into the chat, a commit or a log.** It lives
  in `.env.wbldc.local` at the repo root. That file matches `.env.*.local` in
  `.gitignore`, so it is never committed. Read the variables from it; never
  print them.
- **The export files are client data.** Write them to `~/wbldc-import/`,
  outside the repo. Never commit them.
- **Nothing is written to the live server by the session.** The owner uploads
  the files in the browser at `https://bms.demosites.co.in/admin/telemetry-import`.
  That page runs a preview first; the owner presses Commit.

## Step 1: look (stop and show the owner)

Connect with the values in `.env.wbldc.local`. Use the `mysql` client if it is
installed; otherwise use Python with `pymysql` in a throwaway virtualenv under
`~/wbldc-import/.venv`. Then:

1. List the databases and tables. Find the table(s) that hold the temperature
   readings.
2. For the readings table, show the columns, 5 sample rows, the row count, the
   earliest and latest timestamp, the timestamp's time zone (IST or UTC?), and
   how often a room is sampled.
3. Show how a row names its room or channel: a device ID, a channel such as
   `temp_ch0`, or a room name.

**Stop here and wait for the owner's OK.**

## Step 2: map (stop and show the owner)

Our 19 cold rooms each have **one point, `cold_room_temp_c`, in `degC`**. The
"live from" column is the first day live MQTT data exists on the server.
Import **only readings strictly before that date** (00:00 IST), so old and
live data never overlap.

| asset_code | Room | Plant | Live MQTT key | Live from |
|---|---|---|---|---|
| CHK_Blast_Freezer_1 | Chicken Blast Freezer 1 | Phansidewa | temp_ch0 | 2026-11-10 |
| CHK_By_Product_Chiller | Chicken By Product Chiller | Phansidewa | temp_ch1 | 2026-11-10 |
| CHK_VAP_Raw_Chiller | Chicken VAP Raw Chiller | Phansidewa | temp_ch2 | 2026-11-10 |
| CHK_Main_Chiller | Chicken Main Chiller | Phansidewa | temp_ch3 | 2026-11-10 |
| CHK_VAP_Pack_Chiller | Chicken VAP Pack Chiller | Phansidewa | temp_ch4 | 2026-11-10 |
| CHK_Cold_Room | Chicken Cold Room | Phansidewa | temp_ch5 | 2026-11-10 |
| CHK_Blast_Freezer_2 | Chicken Blast Freezer 2 | Phansidewa | temp_ch6 | 2026-11-10 |
| PORK_Blast_Freezer | Pork Blast Freezer | Phansidewa | temp_ch0 | 2026-11-10 |
| PORK_Cold_Room | Pork Cold Room | Phansidewa | temp_ch1 | 2026-11-10 |
| PORK_Main_Chiller | Pork Main Chiller | Phansidewa | temp_ch2 | 2026-11-10 |
| PORK_VAP_Raw_Chiller | Pork VAP Raw Chiller | Phansidewa | temp_ch4 | 2026-11-10 |
| PORK_VAP_Pack_Chiller | Pork VAP Pack Chiller | Phansidewa | temp_ch3 | 2026-11-10 |
| GOAT_Chiller_1 | GOAT Chiller-1 | Haringhata | temp_ch0 | 2026-11-09 |
| GOAT_Chiller_2 | GOAT Chiller-2 | Haringhata | temp_ch1 | 2026-11-09 |
| GOAT_Deep_Freezer | GOAT Deep Freezer | Haringhata | temp_ch2 | 2026-11-09 |
| GOAT_Blast_Freezer | GOAT Blast Freezer | Haringhata | temp_ch3 | 2026-11-09 |
| VAP_Deep_Freezer_2 | VAP Deep Freezer-2 | Haringhata | temp_ch0 | 2026-11-09 |
| VAP_Chiller_Room_3 | VAP Chiller Room-3 | Haringhata | temp_ch1 | 2026-11-09 |
| VAP_Blast_Freezer_2 | VAP Blast Freezer-2 | Haringhata | temp_ch2 | 2026-11-13 |

**Channel keys repeat across devices.** For example, `temp_ch0` is a different
room on the CHK, PORK, GOAT and VAP devices. Map by device **and** channel, or
by room name, never by channel alone. If a MySQL room cannot be matched with
certainty, leave it out and list it.

Show the owner the full mapping (MySQL device/channel/room → asset_code), plus
the date range and row count per room. **Wait for the owner's OK.**

## Step 3: build the files

- CSV with the header `asset_code,point_key,time,value,unit`. Every row has
  `point_key = cold_room_temp_c` and `unit = degC`.
- `time` is ISO 8601 **with an offset**, for example
  `2026-10-01T14:05:00+05:30`. Convert from whatever zone MySQL stores.
- Keep only rows strictly before the room's "live from" date (00:00 IST), and
  no older than 730 days (the server refuses older readings).
- **Downsample to one reading per room per minute** (the average of that
  minute) if the source is denser. This keeps the files small and is enough
  for hourly models.
- Drop rows that are empty, non-numeric or obvious sensor faults (for example
  exactly -127 or 85, if the probes are DS18B20). List what was dropped and why.
- Split into files of **at most 4.5 MB** each (the upload limit is 5 MB):
  `~/wbldc-import/wbldc-history-001.csv`, `-002.csv`, …
- Print a summary: files, rows per room, first and last time per room.

## Step 4: owner uploads

The owner opens `https://bms.demosites.co.in/admin/telemetry-import`, uploads
each file, checks the preview counts (accepted / rejected), and presses
Commit. Run the files in order. If a preview shows rejections, paste the
reasons to the session and fix the files before committing.

## Step 5: tell the cloud session

When every file is committed, tell the cloud session (the one that wrote ADR
0135) that the import is done. It re-runs the readiness check against the live
server and updates ADR 0135 decision 8.

# Writing a Modbus device profile

A Modbus device publishes nothing about itself. The reader must already know
that "holding register 3059, two words, float32" is total active power, and that
knowledge is in the vendor's manual. A **device profile** is that knowledge as
data: a list of registers an operator can write, copy, import and bind to an RTU
(ADR 0141 decisions 7 and 12–15). This guide is how to write one from a manual.
The adapter itself is in [`ingest-host.md`](./ingest-host.md) (*Modbus TCP*); the
edge box that reads it on site is in [`edge-gateway.md`](./edge-gateway.md).

## Where profiles live

- **Admin → Reference Data → Device Profiles** (`/admin/device-profiles`). The
  tab is shown to a global `admin` and to an `organization_admin` with a direct
  grant, the roles that can write profiles. A location admin can read profiles
  through the API, but does not see the tab (an owner ruling on this is open;
  ADR 0141 *Build record*).
- A profile belongs to **one organization** (`bms.device_profiles`, row-level
  security). No profile is shared. API: `apps/api/src/admin/device-profiles/`.
- **Bind** an RTU to a profile from its row on the RTUs page (host, port, unit
  id, profile), or name the profile in an onboarding draft (the guided chat
  line `profile: <code>`, or the `profile_code` column of the workbook). Either
  way the API **copies the registers** into the RTU's connection config
  (`rtu_connection_configs.config.device`) and records `profile: { code, version }`.
  The ingest host and the edge never read the profile.

## A register entry

One entry per value. `value = raw × scale + offset`.

| Field | Meaning |
|---|---|
| `sourceKey` | The key the value is stored under: the point's `source_data_key` (1–128 characters). Unique within one profile. |
| `table` | `coil` (function code 01), `discrete` (02), `holding` (03) or `input` (04). Read the manual's table name, not its number. |
| `address` | The **zero-based protocol address**, 0–65535. See the traps below. |
| `type` | `bool`, `int16`, `uint16`, `int32`, `uint32`, `int64`, `uint64`, `float32` or `float64`. `bool` is the only type for a coil or discrete table, and the only one allowed there. |
| `wordOrder` | `big` (default): the most significant 16-bit word at the lower address. `little`: the words reversed. Ignored for one-word types. |
| `byteSwap` | `false` (default). `true` swaps the two bytes inside each word before the value is read. |
| `scale`, `offset` | Defaults 1 and 0. Use them for a unit change (a register in W for a point in kW is `scale: 0.001`). |
| `unit` | Display hint only. |

A profile holds 1 to 256 registers. A register whose words run past address
65535 is refused. Contiguous registers of one table are read in one request, but
**a gap is never bridged**, so a gap costs one more request.

## The traps

1. **The address is zero-based; manuals are not.** The wire carries a 16-bit
   address that starts at 0. Many manuals print a "40001" style number: the
   leading `4` names the holding table and `40001` is address **0**. So holding
   `40101` is `address: 100`, with `table: "holding"`. Some manuals print the
   protocol address directly (often in hex, `0x0064` is 100). Decide which kind
   of column you are reading before you copy a number. The stock Elmeasure
   profile uses `address = 4xxxx − 40001`; the stock Selec profile uses the
   manual's Hex column as it stands.
2. **Word order differs between vendors, and sometimes between firmware
   versions.** A `float32` of 230.0 is `0x43660000`. A `big` device sends
   `4366 0000`. A `little` device sends `0000 4366`. If a voltage reads as
   `0` or a huge number, the word order is the first thing to try. A device
   described as "CDAB" is `wordOrder: "little"`; "ABCD" is `big`.
3. **Byte order inside a word.** `byteSwap: true` is for the rarer device that
   also swaps the two bytes of each word ("BADC", or "DCBA" with `little`).
   Change one setting at a time and compare with the device's own display.
4. **A one-word type has no word order.** Set only `byteSwap` for `int16` and
   `uint16` if needed.
5. **Scale and units.** Read the unit the register holds, not the unit the
   display shows. A register in W or Wh with a point in kW or kWh needs
   `scale: 0.001`. Energy counters named "Prog" or configurable in the manual
   must be confirmed on the device.
6. **64-bit integers.** A value past 9,007,199,254,740,991 cannot be held without
   rounding. The adapter emits it as not good instead of rounding it.
7. **Serial meters sit behind a gateway.** Most Indian energy meters are RS-485
   Modbus RTU. This product reads Modbus **TCP** only: put an RS-485-to-Ethernet
   gateway in front, and give each meter its serial address as the `unitId`
   (0–247). A meter that speaks TCP directly may need `255` (the Modbus
   Messaging on TCP/IP Implementation Guide §4.4.1.2); the adapter accepts 0–247
   and 255.

## `sourceKey` and the asset template

Use the **point keys of the stock asset template** the device will feed, so
that mapping needs no hand work (ADR 0141 decision 16). For an electrical feeder
the keys include `voltage_vry`, `current_ir`, `kw`, `kvar`, `kva`, `pf`,
`frequency_hz` and `kwh_total`. A point is **read only if its
`source_data_key` equals a register's `sourceKey`**: a stock template ships its
points with no source key pattern, so set `source_data_key` on each point you
want (or map it in the asset mapping step). A register that no point maps is not
read by the cloud host. The edge export writes only mapped registers
([`edge-gateway.md`](./edge-gateway.md)).

**Do not set `accept_bad` on a Modbus point.** A block the adapter could not
read is emitted as `{ value: 0, good: false }`. The `0` is a placeholder. Under
the default `discard_bad` the host drops and counts it. A point set to
`accept_bad` would **store the `0` as a reading**.

## Versions and `verified`

- **A saved version is never edited.** Every save is a new row at the next
  `version`; the database refuses UPDATE and DELETE on the table for the
  application roles (ADR 0141 Amendment 2 (b)). A bound RTU's
  `{ code, version }` therefore always names what was copied. A save must start
  from the newest version, or it is refused (409, "someone saved a newer
  version").
- **An edit or a copy sets `verified: false`.** Only a stock file can carry
  `true`, and only after a real device has been read against it (the bench read,
  ADR 0141 decision 21). A copy takes a new `code`, version 1.
- **A bound RTU keeps what it copied.** Editing a profile does not change an RTU
  already bound to an older version; re-binding does. The host picks the change
  up at its next reload (`device-config-changed`).
- A profile has `source: { document, revision, pages }`: the manual's name, its
  revision and the page numbers you read. Fill it in; it is how the next reader
  checks your work.

## Importing the stock profiles

On the Device Profiles tab, **Import** lists the stock profiles (they ship in
`packages/shared/src/device-profiles/modbus/`). An import copies the file into
the organization's own rows (`verified` as the file says, today `false`). If the
organization already holds the code, the import is saved as the next version,
and the screen asks first. The import copies from the repository, never from
another organization.

Two are shipped, both `verified: false`, and both use the stock feeder
template's keys:

| Code | Meter | Manual | Registers |
|---|---|---|---|
| `elmeasure-lg-plus-5310` | Elmeasure LG+ 5310 | "Modbus Register Map, Multifunction Meters - Little Genius Plus", revision ELM/MOD-R/MFM/V1.0 - 1117, page 1. Holding registers, `4xxxx − 40001`, float32, kW/kVA/kWh/kVAh scaled by 0.001. The manual states no word order; `big` is assumed. The Wh and VAh rows are marked "Prog": confirm their scale on the device. | 16 |
| `selec-mfm384-c-ce` | Selec MFM384-C-CE | "OP INST MFM384-C-CE", revision OP805-V03, pages 2–4. Input registers, the Hex column is the protocol address, float32, big endian (ABCD). A meter set to MSBF would send CDAB. | 19 |

Ruling P3 (2026-11-22) named five models: the Schneider PowerLogic PM5000
series, the Secure Elite 400 series, the Elmeasure LG series, the Selec MFM
series and L&T. **Schneider PM5000, Secure Elite 400 and L&T were ruled but not
shipped.** Ruling P3a drops a model with no public manual. PR 9's record
(#1493): for PM5000 the register list is a separate document that
`download.se.com` no longer serves; for Elite 440 the public manuals hold no
register map; for the L&T WL4400/4430 the only reachable map is for a different
model and its kilo/mega unit registers cannot be written as a fixed scale. A
vendor PDF the owner supplies makes adding a meter one JSON file, one line in
the index and one pin case in `stock-profiles.spec.ts`.

## Writing your own, step by step

1. Get the vendor's register map and note its document name, revision and pages.
2. For each value you need, find its table, address, type, scale and unit. Work
   out whether the address is a protocol address or a "4xxxx" number (trap 1).
3. Choose the `sourceKey` from the asset template's point keys.
4. Create the profile on the Device Profiles tab (rows of a table, one register
   per row; the same checks as the API run on each row).
5. Bind a test RTU, let it poll, and compare **several** registers against the
   device's own display. Wrong word order shows as zero, huge or tiny values;
   a wrong address shows as the neighbouring quantity or as `exception-2` in
   the log. Save a corrected version (a new row) until they match.
6. `verified` stays `false` in the product. It becomes `true` only in a stock
   file, by a code change, after the bench read.

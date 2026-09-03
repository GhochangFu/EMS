import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The mechanical pack's packaged steam-boiler class — `E5.2`, ADR 0053 decisions
 * 1-11, ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2. **The sixth and last
 * entry of the pack.**
 *
 * **SOURCE.** `docs/e5.2-derived-taglist-v1.md` §7 — *"Boiler — steam, packaged
 * fire-tube (IBR); hot-water generator uses the same table minus drum/steam
 * rows"*. PROVISIONAL: derived from published practice, not client-confirmed.
 *
 * **THE HOT-WATER GENERATOR IS A REDLINE, NOT A SECOND ENTRY.** §7's own title
 * says so: a site with hot-water generators strikes the drum and steam rows from
 * its imported draft. Minting a `mechanical-hot-water-generator` would be two
 * entries drifting apart on every later correction, the same call the chiller's
 * air-cooled variant makes.
 *
 * **25 POINTS — 7 core + 14 extended + 2 manual + 2 DERIVED.** §7's 23 table rows
 * in the document's own order (`sortOrder` 0-22), then the two authored derived
 * codes (23-24).
 *
 * **THE PACK'S ONE DUAL-TIER ROW IS HERE.** §7 spells `feedwater_tds_ppm`'s tier
 * `X/M`, and ADR 0053 decision 4 resolves a dual-tier row **first-listed wins**,
 * as the water pack's two did — so it is `extended`, an online analyser on a
 * plant that has one and a laboratory sample on a plant that does not.
 * `meta.tier` says what that plant type typically fits, not what the code is.
 * Reading it as `manual` would also make `feedwater_tds_high` an alarm on a row
 * that could never receive a value.
 *
 * **ROW THIRTEEN IS `fuel_level_pct`, THE DG SET'S CODE, REUSED** (plan §12
 * ruling 1, ruled by the owner on 2026-09-03). §7 spells it
 * `fuel_tank_level_pct`; the DG set already seeds `fuel_level_pct` for *fuel
 * level (day tank)*, and *day-tank / bunker level* is the same meaning. One
 * meaning is one code (ADR 0051 Amendment 6 decision 5), and the tag list's own
 * cross-cutting note says existing keys are reused rather than renamed — so the
 * document's spelling is a closure correction to the handout rather than a new
 * key, and this pack seeds one code fewer than ADR 0053 counted. **This is why
 * the alarm code `fuel_tank_level_low` binds a point of a different name**: the
 * disagreement is deliberate, the entry spec says so, and a later "tidy" of
 * either name mints the duplicate the ruling refused. `run_hours_h` is the
 * entry's one other reused code.
 *
 * **TWO `M` ROWS, AND ONE OF THEM STRANDS A FORMULA.** `boiler_water_ph` and
 * `blowdown_tds_ppm` are both marked *(lab)* in §7: a bench reading written on a
 * log sheet. Both carry a null `sourceDataKeyPattern` **forever**, always land in
 * `skippedPoints` and never get an `asset_points` row until `F1.8` manual entry
 * gives them somewhere to write — and the weekly chemistry plan below is the only
 * thing that produces their values at all. `blowdown_tds_ppm` is also the reason
 * `blowdown_pct` is deferred rather than authored: by TDS balance the formula
 * `{feedwater_tds_ppm} / ({blowdown_tds_ppm} - {feedwater_tds_ppm}) * 100` PARSES
 * over two declared measured points, and one of them can never carry a reading.
 * **That is the second instance of `water-softener`'s `salt_efficiency_kg_kl`
 * class** — the only deferral class in the catalog whose reason is the DATA MODEL
 * rather than the grammar — so the pattern is now a class rather than an
 * anecdote.
 *
 * **THE TWO FORMULAS** (plan §5.0), promoted into the vocabulary because a
 * derived point's `pointKey` passes `assertPointKeysActive` like any other:
 *
 *  - `steam_to_fuel_ratio` = `{steam_flow_kgh} / {fuel_flow_kgh}` — §7's own
 *    *steam ÷ fuel*, kilograms of steam per kilogram of fuel, the figure a boiler
 *    house is judged on day to day. Dimensionless, so the catalogue spells its
 *    unit as the empty string and the template `null`. Both inputs are tier X: a
 *    boiler with no steam meter or no fuel meter gets no value, which is legal
 *    (the reference check requires a key to be DECLARED, not required — ADR 0036
 *    decision 7) and honest.
 *  - `excess_air_pct` = `{flue_o2_pct} / (20.9 - {flue_o2_pct}) * 100` — the
 *    textbook simplified excess-air relation from flue-gas oxygen on a dry basis.
 *    **`20.9` is the volume fraction of oxygen in air**: an atmospheric constant,
 *    not a site value and not a limit, so B7 — which governs alarm thresholds —
 *    has nothing to say about it. §7 names the code *"from O₂"* without writing a
 *    formula; plan §12 question 3 asked whether to promote it on that basis and
 *    **the owner ruled to promote it and to defer `specific_fuel_kg_ton_steam`**,
 *    which would have been a second code for the reciprocal of the ratio above.
 *    **This constant is the only number in the entry outside a `sortOrder`**, and
 *    it lives in the formula and nowhere else.
 *
 * **DIVISION BY ZERO IS HANDLED AND MUST NOT BE GUARDED.** `evaluate.ts` returns
 * `non_finite`, so the steam-to-fuel ratio on a boiler that is not firing and the
 * excess air at exactly the oxygen fraction of air produce **no value for that
 * reading**. No `clamp`, no `max(…, 0.001)`: a fabricated denominator turns "no
 * data" into a plausible number, and on a combustion figure a plausible wrong
 * number is what a tuning decision is then made against. **Neither overrides
 * `maxInputAgeSeconds`** — the flow meters and the oxygen analyser all report
 * from the boiler's own panel inside the 300 s default, and there is no override
 * anywhere in this pack.
 *
 * **THREE DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0053
 * decision 6; ADR 0051 Amendment 6 decision 8). `stock-catalog-deferrals.spec.ts`
 * holds the list and asserts this entry declares none of them:
 *
 *  - **A method the document only names** — `efficiency_indirect_pct`. The IS
 *    13979 / BS 845 indirect method needs the fuel's analysis (carbon, hydrogen,
 *    moisture) — attributes, not points — and a loss model the grammar has no
 *    functions for. A formula authored for it would compute a different quantity
 *    under the right name, which is worse than a named deferral.
 *  - **A point that could never receive a value** — `blowdown_pct`, above.
 *  - **A second code for a meaning already declared** —
 *    `specific_fuel_kg_ton_steam`, the reciprocal of the authored
 *    `steam_to_fuel_ratio` times a thousand. The `throughput_since_regen_kl`
 *    class, and plan §12 ruling 3's other half.
 *
 * **NO `content.kpis`** (ADR 0053 decision 6, the same structural reason the pack
 * index records): every ratio §7 names that the grammar can express is a named
 * derived code and therefore a point, and every one it cannot is deferred.
 *
 * **ALARMS — 11, FROM §7's NINE BULLETS.** Drum level, steam pressure and
 * flue-gas oxygen each split into two rows at opposite bands, because a band that
 * is too low and a band that is too high are two different failures with two
 * different remedies, two different severities and, here, two different trades —
 * the same shape as the pump's two current rows. Every row is **pair-absent** —
 * no `thresholdValue`, no `operator` (ADR 0019 Amendment 2, B7) — and every row
 * carries a populated ADR 0019 §3 `philosophy`.
 *
 * **FOUR ROWS CARRY NO NUMBER AT ALL, NOT EVEN INSIDE `philosophy`** —
 * `boiler_trip`, `drum_level_low`, `steam_pressure_high` and `flue_o2_low`. These
 * are the statutory four: the low-water level, the safety-valve set pressure and
 * the oxygen floor beneath which combustion goes incomplete are fixed per boiler,
 * on its own certificate, by its inspecting authority under the Indian Boiler
 * Regulations — not by an engineer reading a template. `drum_level_high`
 * (carryover) and `steam_pressure_low` (demand beyond firing) are operating rows
 * an engineer sets from the plant's own behaviour, so they are not in the list.
 * The entry spec asserts **no digit** in the message or in any `philosophy`
 * string of the four, through the same generalised helper the water pack's CPCB
 * consent rows use. A number shipped unread to every organization that imports
 * this entry is a number somebody will believe, and believing a wrong one here is
 * how a boiler is destroyed or a boiler house is filled with carbon monoxide.
 *
 * **FOUR ROWS CARRY NO `philosophy.skill`, AND THEY ARE THE ONLY FOUR IN THE
 * PACK** (ADR 0053 decision 5). `flue_o2_high`, `flue_o2_low`, `co_high` and
 * `feedwater_tds_high` are combustion and water-chemistry excursions, and
 * `bms.alarm_skills` holds exactly `electrical`, `mechanical`, `hvac`, `controls`
 * and `civil` from migration `0034` — **no process trade**. The field is omitted
 * rather than routed to a trade that does not answer the event: filing a
 * chemistry excursion under `controls` because a field wants a value is the
 * guessing the rule prevents, and `assertTemplateAlarmVocabularies` closes the
 * set at import time, so an invented code would be a 400 on a client's site.
 * **`F4.78` files the `process` trade; when it lands, these four gain a skill in
 * a `stockVersion` 2.** The other seven are `mechanical` for the trip, the
 * low-water barrier, the safety-valve approach and a fouled stack; `controls` for
 * a level riding high and for demand beyond firing, which are the feedwater and
 * firing-rate loops; and `civil` for the day tank, as the water pack's tank rows
 * are.
 *
 * **MAINTENANCE — 5 plans, PROVISIONAL** (plan §12 ruling 5), derived from IBR
 * log-sheet practice, because the tag list has no maintenance section.
 *
 * **One is `safetyCritical`: the low-water cut-off and safety-valve test**, the
 * third and last of exactly three ADR 0053 decision 8 names for this pack. Those
 * two devices are the physical barriers behind `drum_level_low` and
 * `steam_pressure_high`, and a boiler is destroyed or bursts when they are the
 * things nobody tested. **The annual inspection is `compliance` and NOT
 * `safetyCritical`** — a statutory inspection with its own reference and its own
 * consequence (a boiler without a current certificate may not be fired) is a
 * compliance item rather than a life-safety barrier, and authoring it critical
 * would make four such plans in a pack that has three and blur the two meanings:
 * one is a device that stops an accident, the other is a document that permits
 * operation. **No plan is `condition_based`**: a boiler's schedule is the
 * statute's and the water treatment's rather than a measured value crossing a
 * band, and the two rows the weekly chemistry round records are `M` rows nothing
 * could evaluate a condition against.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring, which the tag list does not know and the catalog must not
 * guess, so an imported draft cannot be instantiated until an operator fills the
 * patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `mechanical-boiler` **v1** (2026-09-03, `E5.2`): authored from
 *    `e5.2-derived-taglist-v1.md` §7, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const MECHANICAL_BOILER: StockAssetTemplateEntry = {
  code: "mechanical-boiler",
  name: "Steam boiler (packaged fire-tube, IBR)",
  assetType: "boiler",
  domain: "mechanical",
  description:
    "Packaged fire-tube steam boiler under the Indian Boiler Regulations — the steam pressure, " +
    "temperature and flow with their totalizer, the drum level and the feedwater side, the fuel " +
    "side with its day tank, the flue-gas readings a combustion tuning is done against, and the " +
    "two laboratory rows a boiler-water chemistry round produces. A hot-water generator is the " +
    "same table with the drum and steam rows struck. Authored from " +
    "docs/e5.2-derived-taglist-v1.md §7 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit, and on the statutory rows — the trip, the low drum level, the " +
    "approach to safety-valve lift and the low flue oxygen — they carry no number at all, " +
    "because those limits are fixed per boiler on its own certificate by its inspecting " +
    "authority. Two derived points, the steam-to-fuel ratio and the excess air from flue oxygen, " +
    "are computed from the measured rows. Four combustion and water-chemistry rows carry no " +
    "trade, because the platform seeds none that answers a process excursion.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "boiler_trip",
        pointKey: "boiler_trip",
        severity: "critical",
        category: "safety",
        message:
          "Boiler safety trip — the burner has been shut down by one of the boiler's own " +
          "protections. The cause (low water, flame failure, high pressure) is carried in this " +
          "text and read from the panel; it is not enumerated, because the lock-out list belongs " +
          "to one burner controller.",
        philosophy: {
          cause:
            "The low-water cut-off, the flame-failure device, the high-pressure switch, a fan or " +
            "draft interlock, a fuel valve proving fault, or a flame scanner that has become " +
            "dirty enough to lose the flame it is looking at.",
          impact:
            "Steam stops. Every process on the header stops with it, and a plant that runs one " +
            "boiler stops entirely; a plant with a standby has to bring it on and warm it, which " +
            "is not immediate. The trip itself is the boiler protecting itself and is the correct " +
            "outcome — what follows a trip that is reset without a cause is not.",
          action:
            "Read the lock-out on the burner controller before resetting anything, and treat a " +
            "low-water lock-out as an inspection rather than a reset: the tubes may have been " +
            "uncovered, and a boiler refired on uncovered tubes is how a fire-tube boiler is " +
            "destroyed. Prove the water level by the gauge glass, not by the transmitter, and " +
            "check the feedwater path before the burner.",
          skill: "mechanical",
        },
      },
      {
        code: "drum_level_low",
        pointKey: "drum_level_pct",
        severity: "critical",
        category: "safety",
        message:
          "Drum water level low — the level is falling towards the cut-off. This is the " +
          "IBR-critical alarm on the boiler: the low-water cut-off beneath it is the last barrier " +
          "before the tubes are uncovered. The level it is judged against is fixed per boiler on " +
          "its certificate and carries no value in this template.",
        philosophy: {
          cause:
            "A feed pump stopped, cavitating or air-bound; a feed control valve stuck shut or a " +
            "level controller reading a fouled or steam-bound chamber; a feedwater tank run dry " +
            "or its make-up failed; a blowdown valve left open or passing; or a steam demand " +
            "beyond what the feed system can replace.",
          impact:
            "**The tubes are uncovered and the crown is exposed to steam instead of water.** " +
            "Metal that is no longer cooled by water overheats within minutes; it bulges, cracks " +
            "or fails, and cold water reaching an overheated surface afterwards is what turns a " +
            "damaged boiler into a rupture. This is the failure the whole statutory regime around " +
            "a boiler exists to prevent, and it is quick.",
          action:
            "Confirm the level in the gauge glass first — the glass is the reference and the " +
            "transmitter is not — and if the level cannot be seen in the glass, shut the fuel off " +
            "and let the boiler cool naturally. **Do not feed water into a boiler whose level has " +
            "been lost.** Prove the feed pump, the feed valve and the level chamber before " +
            "refiring, and blow down the level chambers as the log sheet requires.",
          skill: "mechanical",
        },
      },
      {
        code: "drum_level_high",
        pointKey: "drum_level_pct",
        severity: "warning",
        category: "operations",
        message:
          "Drum water level high — the level is riding above its control band. The band is a site " +
          "value set at commissioning.",
        philosophy: {
          cause:
            "A feed control valve passing or held open, a level controller mis-tuned or reading " +
            "low, a swelling level after a sudden load increase that the control has chased, or " +
            "a level chamber whose connection is partly blocked and lags the drum.",
          impact:
            "Water is carried over into the steam line. Wet steam takes heat away from every " +
            "process on the header, and slugs of water in a steam main cause water hammer, which " +
            "breaks pipework, valves and traps. Carryover also takes boiler-water chemicals with " +
            "it, which then coat whatever the steam touches.",
          action:
            "Check the feed control valve and the level controller's tuning, and compare the " +
            "level chamber against the gauge glass — a lagging chamber makes the control chase a " +
            "reading that is not the drum's. Blow down to the control band rather than draining " +
            "hard, and look at the steam load pattern that preceded it.",
          skill: "controls",
        },
      },
      {
        code: "steam_pressure_high",
        pointKey: "steam_pressure_bar",
        severity: "critical",
        category: "safety",
        message:
          "Steam pressure high — the boiler is approaching the pressure at which its safety valve " +
          "lifts. The set pressure and the operating band are fixed per boiler on its " +
          "certificate by its inspecting authority, and this template carries neither.",
        philosophy: {
          cause:
            "A firing-rate control that is not modulating down — a stuck fuel valve, a failed " +
            "modulating motor or a pressure transmitter reading low — a steam demand that has " +
            "fallen away faster than the burner turned down, or an operating pressure switch that " +
            "has failed to make.",
          impact:
            "The safety valve lifts, which is the boiler protecting itself and is loud, wasteful " +
            "and hard on the valve: a valve that has lifted often enough stops reseating cleanly " +
            "and then passes for good. If the valve does not lift, the pressure part is being " +
            "taken beyond what it is certified for, and that is the failure the certificate " +
            "exists to prevent.",
          action:
            "Reduce the firing rate and the load rather than waiting for the valve, and check the " +
            "pressure transmitter against the boiler's own gauge — a transmitter reading low is " +
            "the common cause and looks like nothing at all on the trend. Report any valve lift " +
            "on the log sheet: it is an event the inspecting authority reads, and it also decides " +
            "when the valve is next tested.",
          skill: "mechanical",
        },
      },
      {
        code: "steam_pressure_low",
        pointKey: "steam_pressure_bar",
        severity: "warning",
        category: "operations",
        message:
          "Steam pressure low — demand is exceeding the firing rate. The band is a site value and " +
          "depends on what the header serves.",
        philosophy: {
          cause:
            "A load beyond the boiler's rating or beyond the fuel available, a burner held down " +
            "by its own limit, a fouled or sooted heat-transfer surface, a fuel supply problem " +
            "(a cold or waxed oil, a low gas pressure, wet or fine coal), or several users " +
            "opening together with no sequence between them.",
          impact:
            "Every process on the header runs cooler or slower than its specification, which on a " +
            "batch plant means longer cycles and on a continuous one means an off-specification " +
            "product. Pressure falling far enough also stops the loads that need it most, and " +
            "restarting them together makes the next demand step worse.",
          action:
            "Look at the firing rate and the fuel side first, then at the load pattern: a boiler " +
            "at maximum firing is a capacity or a fuel question, and a boiler well below maximum " +
            "with a low header pressure is a control one. Check the stack temperature beside it — " +
            "a fouled boiler cannot make its rating however hard it fires.",
          skill: "controls",
        },
      },
      {
        code: "flue_gas_temp_high",
        pointKey: "flue_gas_temp_c",
        severity: "warning",
        category: "energy",
        message:
          "Flue gas temperature high for the firing rate — heat is leaving up the stack instead " +
          "of entering the water. The temperature this is judged against is the commissioning " +
          "value for this boiler at a comparable load, a site value.",
        philosophy: {
          cause:
            "Soot on the fire side or scale on the water side, both of which insulate the tubes; " +
            "a burner running with too much excess air, which carries heat out faster than it " +
            "transfers; baffles or turbulators missing after a clean; or simply a boiler that has " +
            "not been cleaned for a season.",
          impact:
            "Roughly a percent of fuel for every twenty degrees the stack rises, every hour the " +
            "boiler fires — a continuous cost on a machine that is still making its steam, which " +
            "is why this is an energy row rather than an operations one. Scale on the water side " +
            "also overheats the metal beneath it, so a hot stack from scale is a reliability " +
            "problem as well as a fuel one.",
          action:
            "Read the stack temperature with the flue oxygen and the load together: hot with high " +
            "oxygen is a burner tuning question, and hot with normal oxygen is fouling. Raise the " +
            "tube clean, and if the water side is the suspect, read the boiler-water chemistry " +
            "log — scale is a treatment failure, not a cleaning one.",
          skill: "mechanical",
        },
      },
      {
        code: "flue_o2_high",
        pointKey: "flue_o2_pct",
        severity: "warning",
        category: "energy",
        message:
          "Flue gas oxygen high — the burner is running with more excess air than it needs. The " +
          "target band is per fuel and per burner and is set during combustion tuning; " +
          "excess_air_pct on this template is the same information as a percentage.",
        philosophy: {
          cause:
            "A burner air damper linkage out of adjustment or drifted since the last tuning, a " +
            "forced-draft fan running against a changed resistance, air in-leakage through the " +
            "boiler casing or a failed door seal, or a tuning done at one firing rate that does " +
            "not hold across the range.",
          impact:
            "Every unit of air the burner heats and sends up the stack is fuel bought and thrown " +
            "away, and the stack temperature rises with it. It is invisible on the steam side — " +
            "the boiler makes its pressure throughout — which is why it runs for months and why " +
            "it is filed as an energy concern.",
          action:
            "Retune the combustion across the firing range rather than at one point, and check " +
            "the casing and door seals for in-leakage before adjusting the damper — air that " +
            "enters after the flame reads the same on the analyser and is fixed differently. " +
            "Confirm the analyser itself against a portable instrument first.",
        },
      },
      {
        code: "flue_o2_low",
        pointKey: "flue_o2_pct",
        severity: "critical",
        category: "safety",
        message:
          "Flue gas oxygen low — the burner is running short of combustion air and combustion is " +
          "going incomplete. The floor beneath which this becomes dangerous is per fuel and per " +
          "burner and is set during tuning; it is not carried in this template.",
        philosophy: {
          cause:
            "A burner air damper closed too far or a linkage that has slipped, a forced-draft fan " +
            "failing or its inlet blocked, a fuel valve passing more than the air can burn, a " +
            "blocked or partly closed flue path, or a fuel change the burner was never retuned " +
            "for.",
          impact:
            "Incomplete combustion makes carbon monoxide, and carbon monoxide in a boiler house " +
            "kills people who cannot smell it. It also lays soot on the fire side, which " +
            "insulates the tubes and sends the stack temperature up, and unburnt fuel in a hot " +
            "flue is how a boiler explosion starts. This row is a safety concern for that reason " +
            "and not an efficiency one, even though it sits on the same point as the row above.",
          action:
            "Treat it as a live hazard rather than a tuning item: prove the combustion-air path " +
            "and the flue before anything else, and if carbon monoxide is being made, stop firing " +
            "and ventilate the boiler house. Retune the burner across its range afterwards, and " +
            "do not restore the air setting by moving the analyser's own band.",
        },
      },
      {
        code: "co_high",
        pointKey: "flue_co_ppm",
        severity: "critical",
        category: "safety",
        message:
          "Flue gas carbon monoxide high — combustion is incomplete and the boiler is making CO. " +
          "The limit is per fuel and per local regulation and is set at commissioning.",
        philosophy: {
          cause:
            "The same causes as low flue oxygen, measured from the other side: too little " +
            "combustion air, a burner out of tune, flame impingement on a cold surface, a fuel " +
            "that is wet or the wrong grade, or a flue that cannot draw. A rising CO with normal " +
            "oxygen is usually flame quality rather than air quantity.",
          impact:
            "Carbon monoxide is odourless and it kills in a confined boiler house before anybody " +
            "identifies why. It is also fuel that has been paid for and not burnt, and it lays " +
            "soot that insulates the tubes; a rich flue is the condition in which unburnt fuel " +
            "can ignite in the flue path, which is a boiler explosion rather than a combustion " +
            "problem.",
          action:
            "Stop firing and ventilate if the boiler house is occupied and the reading is rising. " +
            "Investigate the air path, the flame and the fuel together, retune across the firing " +
            "range, and check the boiler-house ventilation openings — an air-starved burner is " +
            "often an air-starved room. A portable detector on the operator, not only an analyser " +
            "on the stack.",
        },
      },
      {
        code: "feedwater_tds_high",
        pointKey: "feedwater_tds_ppm",
        severity: "warning",
        category: "operations",
        message:
          "Feedwater or boiler-water dissolved solids high — the water is carrying more than the " +
          "treatment regime allows. The limit is per boiler pressure and per the treatment " +
          "specification the site works to, and is not carried in this template.",
        philosophy: {
          cause:
            "Blowdown too little or too infrequent for the make-up rate, a softener or a " +
            "demineralisation plant that has passed hard water, condensate returned with " +
            "contamination in it, or a dosing regime that has not kept up with a rise in " +
            "production and therefore in make-up.",
          impact:
            "Dissolved solids become scale on the water side, and scale insulates: the stack " +
            "temperature rises, the fuel bill rises with it, and the tube metal beneath the scale " +
            "runs hotter than it was designed to and eventually fails. High solids also foam the " +
            "drum surface, which carries water and chemicals into the steam line and takes the " +
            "whole header with it.",
          action:
            "Increase the blowdown to bring the boiler water back into its band and find why it " +
            "drifted — the make-up water treatment and the condensate return are the two usual " +
            "answers. Record the laboratory pH and blowdown TDS on the log sheet as the weekly " +
            "chemistry round requires; those two rows on this template are what the trend is " +
            "read from.",
        },
      },
      {
        code: "fuel_tank_level_low",
        pointKey: "fuel_level_pct",
        severity: "warning",
        category: "operations",
        message:
          "Day tank or bunker level low — firing stops when it runs dry. This alarm binds " +
          "fuel_level_pct, the code the DG set already uses for a day-tank level: one meaning, " +
          "one code, so the tag list's fuel_tank_level_pct spelling is corrected rather than " +
          "seeded a second time. The reorder level is a site value.",
        philosophy: {
          cause:
            "A delivery not ordered or not arrived, a transfer pump that has failed or been left " +
            "in manual, a level sensor reading the wrong tank after a change-over, or a " +
            "consumption above forecast because the boiler is firing harder than the plan " +
            "assumed.",
          impact:
            "A boiler that runs its day tank dry trips on flame failure and stops the steam " +
            "header, and an oil system that has drawn air needs priming and bleeding before it " +
            "will fire again — so the outage is longer than the refill. Drawing a tank down also " +
            "lifts whatever has settled in the bottom of it into the burner's filters.",
          action:
            "Fill or transfer, and check the transfer pump's mode and the delivery schedule " +
            "rather than only the level. Read the fuel totalizer against the tank movement — a " +
            "level falling faster than the consumption explains is a leak, and a leak on a fuel " +
            "system is an environmental matter as well as an operating one.",
          skill: "civil",
        },
      },
    ],
    maintenance: [
      {
        title: "Low-water cut-off and safety-valve test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 60,
        priority: "critical",
        safetyCritical: true,
        complianceRef: "IBR log-sheet practice",
        triggerSummary:
          "Blow down and function-test the low-water cut-off and the level chambers, prove the " +
          "burner locks out on low water, and ease and prove the safety valve as the boiler's " +
          "own log sheet requires. These two devices are the physical barriers behind the " +
          "drum_level_low and steam_pressure_high alarms on this template, and they are the " +
          "reason this is the entry's one safetyCritical plan: a boiler is destroyed by uncovered " +
          "tubes or bursts against a valve that did not lift, and both failures happen to boilers " +
          "whose barriers nobody tested. Record every test on the log sheet the inspecting " +
          "authority reads, not only against this asset.",
      },
      {
        title: "Burner service and combustion tuning",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 240,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Service the burner — nozzles or tips, the ignition electrodes, the flame scanner, the " +
          "air damper linkage and the fuel filters — and retune combustion ACROSS THE FIRING " +
          "RANGE against flue_o2_pct and flue_co_ppm, not at one rate. Those two readings are " +
          "what the flue_o2_high, flue_o2_low and co_high alarms bind, and excess_air_pct on this " +
          "template is the first of them expressed as a percentage. A tuning done at one point " +
          "drifts at every other, and the cost of a burner running rich is measured in carbon " +
          "monoxide as well as in fuel. Verify the analyser against a portable instrument in the " +
          "same visit, because a tuning against a drifted analyser is worse than no tuning.",
      },
      {
        title: "Blowdown and boiler-water chemistry round",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 7,
        estimatedMinutes: 30,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Blow down the boiler and the level chambers, take the water samples, and record " +
          "boiler_water_ph and blowdown_tds_ppm on the log sheet. Those two are the entry's M " +
          "rows — laboratory values with a null sourceDataKeyPattern forever — so THIS PLAN IS " +
          "THE ONLY THING THAT PRODUCES THEM at all, and the trend behind feedwater_tds_high is " +
          "read from them. Dissolved solids left to climb become scale, and scale insulates the " +
          "tubes: the stack temperature rises, the fuel bill rises with it, and the metal beneath " +
          "the scale runs hotter than it was designed to.",
      },
      {
        title: "Feed pump and feedwater system service",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 180,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Service the feed pumps and their mechanical seals, prove the feed control valve's " +
          "travel and the non-return valves, clean the feedwater tank and check its deaeration " +
          "and make-up, and prove the standby pump starts and delivers. The feedwater system is " +
          "what stands between the boiler and the drum_level_low alarm, and a feed pump that has " +
          "never been proved on standby is a pump that will not start on the night it is needed.",
      },
      {
        title: "Annual inspection preparation — tubes, refractory and mountings",
        category: "compliance",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 1440,
        priority: "critical",
        safetyCritical: false,
        complianceRef: "IBR annual inspection",
        triggerSummary:
          "Prepare the boiler for its statutory inspection: cool and drain it, open the fire and " +
          "water sides, clean the tubes, examine the refractory, the door seals and every " +
          "mounting, and have the log sheets, the safety-valve test records and the water " +
          "chemistry trend ready for the inspecting authority. This plan is category compliance " +
          "and NOT safetyCritical: it is a statutory inspection with its own reference and its " +
          "own consequence — a boiler without a current certificate may not be fired — rather " +
          "than a barrier that stops an accident, which is what the safety-valve and cut-off test " +
          "on this template is. Its priority is critical because the certificate is what permits " +
          "the plant to make steam at all.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "boiler_status", label: "Burner firing / run status", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "boiler_trip", label: "Safety trip (low water, flame fail, high pressure)", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "steam_pressure_bar", label: "Steam header / drum pressure", unit: "bar", required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "steam_temp_c", label: "Steam temperature", unit: "°C", required: false, sortOrder: 3, meta: EXTENDED },
    // The numerator of steam_to_fuel_ratio — tier X, so a boiler with no steam
    // meter gets no ratio. Legal: the reference check requires DECLARED.
    { ...MEASURED, pointKey: "steam_flow_kgh", label: "Steam flow", unit: "kg/hr", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "steam_totalizer_kg", label: "Steam produced (cumulative)", unit: "kg", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "drum_level_pct", label: "Drum / shell water level", unit: "%", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "feedwater_flow_kgh", label: "Feedwater flow", unit: "kg/hr", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "feedwater_temp_c", label: "Feedwater temperature", unit: "°C", required: false, sortOrder: 8, meta: EXTENDED },
    // THE PACK'S ONE DUAL-TIER ROW. §7 spells it X/M and ADR 0053 decision 4
    // resolves first-listed-wins: an online analyser where one is fitted, a lab
    // sample where one is not. Manual here would put an alarm on a row that can
    // never receive a value.
    { ...MEASURED, pointKey: "feedwater_tds_ppm", label: "Feedwater / boiler water TDS", unit: "ppm", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "feed_pump_status", label: "Feed pump run status", unit: null, required: true, sortOrder: 10, meta: CORE },
    { ...MEASURED, pointKey: "fuel_flow_kgh", label: "Fuel flow", unit: "kg/hr", required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "fuel_totalizer_kg", label: "Fuel consumed (cumulative)", unit: "kg", required: false, sortOrder: 12, meta: EXTENDED },
    // Reused ● — the DG SET's code for a day-tank level, one meaning and one
    // code (plan §12 ruling 1). §7 spells it fuel_tank_level_pct; the handout is
    // corrected at closure rather than a second key being minted, which is why
    // the fuel_tank_level_low alarm binds a point of a different name.
    { ...MEASURED, pointKey: "fuel_level_pct", label: "Day-tank / bunker level", unit: "%", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "flue_gas_temp_c", label: "Stack / flue gas temperature", unit: "°C", required: true, sortOrder: 14, meta: CORE },
    // The input of excess_air_pct, and the point both flue-oxygen alarms bind at
    // opposite bands — one an energy row, one a safety row.
    { ...MEASURED, pointKey: "flue_o2_pct", label: "Flue gas O₂", unit: "%", required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "flue_co_ppm", label: "Flue gas CO", unit: "ppm", required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "combustion_air_temp_c", label: "Combustion air / FD inlet temperature", unit: "°C", required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "furnace_draft_mmwc", label: "Furnace draft", unit: "mmWC", required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "blowdown_state", label: "Blowdown valve open", unit: null, required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "run_hours_h", label: "Firing hours", unit: "h", required: true, sortOrder: 20, meta: CORE },
    // The two M rows — bench readings written on a log sheet, null pattern
    // forever, always in skippedPoints. The weekly chemistry plan is the only
    // thing that produces them, and the second is why blowdown_pct is deferred:
    // its formula parses and its input can never arrive.
    { ...MEASURED, pointKey: "boiler_water_ph", label: "Boiler water pH", unit: "pH", required: false, sortOrder: 21, meta: MANUAL },
    { ...MEASURED, pointKey: "blowdown_tds_ppm", label: "Blowdown TDS", unit: "ppm", required: false, sortOrder: 22, meta: MANUAL },
    // Derived, appended after the table rows in the order §7's own Derived: line
    // names the two this entry authors. No meta.tier: the C/X/M column says what
    // the plant has FITTED, and a computed point is fitted by nobody.
    //
    // Dimensionless — the catalogue spells the unit "" and the template null.
    {
      ...derived("{steam_flow_kgh} / {fuel_flow_kgh}"),
      pointKey: "steam_to_fuel_ratio",
      label: "Steam-to-fuel ratio",
      unit: null,
      required: false,
      sortOrder: 23,
    },
    // 20.9 is the volume fraction of oxygen in air — an atmospheric constant,
    // not a site value and not a limit, and THE ONLY NUMBER IN THIS ENTRY
    // outside a sortOrder. The four statutory alarm rows carry no digit at all.
    {
      ...derived("{flue_o2_pct} / (20.9 - {flue_o2_pct}) * 100"),
      pointKey: "excess_air_pct",
      label: "Excess air from flue O₂",
      unit: "%",
      required: false,
      sortOrder: 24,
    },
  ],
};

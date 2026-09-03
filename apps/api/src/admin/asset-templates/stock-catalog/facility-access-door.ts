import { CORE, EXTENDED, MEASURED, derived } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's access-door class — `E5.3`, ADR 0054 decisions 1-9, ADR
 * 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §3 — *"Access control — door /
 * controller"*. PROVISIONAL: derived from published practice, not
 * client-confirmed. The section's basis is a **Matrix COSEC or equivalent door
 * controller published to the BMS over a BACnet or an integration gateway** —
 * which is what fixes the shape of this entry: the BMS sees what the controller
 * publishes, and the controller publishes states and counts.
 *
 * **ONE TEMPLATE INSTANCE PER CONTROLLER, doors as its points** — the section's
 * own instruction, and ADR 0054 decision 9's rule for the whole pack. A bank of
 * turnstiles or a floor's doors is an ASSET GROUP at its location, not a
 * child-asset model this row invents.
 *
 * **17 POINTS — 5 core + 11 extended + 0 manual + 1 DERIVED.** §3's 16 table
 * rows in the document's own order (`sortOrder` 0-15) and `denied_ratio_pct`
 * appended at 16.
 *
 * ---
 *
 * **NO CREDENTIAL AND NO PERSON CROSSES INTO TELEMETRY.** The tag list's §9.6
 * privacy boundary is the one line of §3 that is not about points, and it is the
 * line a well-meaning integrator breaks first: the access system knows WHO
 * opened the door, and putting the last cardholder on a BMS screen is one small
 * mapping away. This entry carries `access_granted_count`, `access_denied_count`
 * and `rex_count` — **counts and states, never identities** — and
 * `facility-classes-2.spec.ts` refuses a point key or a label naming a card, a
 * credential, a badge, a user or a person. The reason it is asserted rather than
 * written down is that a template ships to every organization that imports it
 * and a data-protection finding on a client's site is not recoverable by editing
 * this file afterwards.
 *
 * **`controller_comms_ok` IS DECLARED HERE, AND PR 2 DEPENDS ON IT** (ADR 0054
 * decision 3, first-occurrence-wins): §3 is its first appearance in the
 * document, so it is filed under `facility`, and §8a's lift and §8b's escalator
 * REFERENCE it rather than redeclaring it. That makes this commit the one that
 * lets `assertPointKeysActive` pass on `feat/E5.3-vertical-transport-pack`,
 * which is cut from `main` after PR 1 merges. It is tier `C` because a
 * controller the head-end cannot reach reports nothing at all: every other row
 * here goes quiet in exactly the way a quiet door looks.
 *
 * **`door_state` IS NOT §7's `door_open_state`.** This one is the CONTROLLED
 * door; the gateway's is its own enclosure door. Two devices, two codes, and
 * they are deliberately not normalised into one — the prefix says which device
 * reported the number (ADR 0053 decision 9's reasoning).
 *
 * ---
 *
 * **ONE DERIVED CODE PROMOTED, AND IT IS THE PACK'S FIRST FORMULA.**
 * `denied_ratio_pct` = `{access_denied_count} / ({access_granted_count} +
 * {access_denied_count}) * 100`. The denominator is the SUM and not the granted
 * count alone, so the result is a fraction of traffic and cannot exceed a
 * hundred. Both inputs are `X` interval counters over the same reporting
 * interval, which is what makes the ratio meaningful at all.
 *
 * `maxInputAgeSeconds` is `null` — the 300 s default is right for two counters
 * that arrive from the same controller at the same scan rate. The pack's only
 * two overrides are on the IAQ node (§6), whose outdoor reference may come from
 * a weather API.
 *
 * **A door with no traffic in the interval divides by zero, and that is handled
 * rather than guarded**: `evaluate.ts` returns `non_finite` at a zero
 * denominator — no value, never a wrong one. A `clamp` or a guard term here
 * would invent a zero-percent denial rate for a door nobody used.
 *
 * **NOTHING BINDS THE RATIO, and that is authoring rather than an omission.**
 * §3's *denied-events burst* bullet is an ATTEMPT PATTERN and the row that
 * carries it is the COUNTER. The ratio is high on a quiet door where one
 * contractor swiped an expired card, and low on a door under a sustained attempt
 * during a busy shift; binding the burst to it would page for the first and stay
 * silent for the second. The ratio ships as a trend point, and the spec asserts
 * the absence so a later author does not helpfully fill it in.
 *
 * **THREE DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0054
 * decision 6; ADR 0051 Amendment 6 decision 8 — a code with no `bms-calc-v1`
 * formula is not vocabulary). `stock-catalog-deferrals.spec.ts` holds the list:
 *
 *  - **A time window the grammar has no state for** —
 *    `door_open_minutes_day`. `bms-calc-v1` has arithmetic, parentheses and five
 *    functions and no clock and no memory.
 *  - **A window whose denominator the catalog does not know** —
 *    `traffic_per_hour`. The counters are interval counters and the interval is
 *    the controller's; a per-hour rate over an unknown reporting period is a
 *    number that looks right and is not.
 *  - **A ROLL-UP, and this is the class ADR 0050 owns** — `access_system_healthy`
 *    is expressible: it is a product of `reader_ok`, `controller_comms_ok`,
 *    `controller_ac_ok`, `controller_battery_ok` and the tamper flag, all
 *    declared here. It is refused anyway, because a health flag over states is
 *    `content.health`'s job (`E1.3`) and every one of those inputs already
 *    carries its own alarm. A second, silent health story on a template point is
 *    the failure that surface exists to prevent.
 *
 * **NO `content.kpis`** (ADR 0054 decision 6): every ratio §3 names is either the
 * point above or one of the three deferrals.
 *
 * ---
 *
 * **SEVEN ALARMS FROM SEVEN BULLETS — nothing dropped, nothing invented.**
 * §1 lost a bullet for want of a row; §3 has a row for every one of its seven.
 *
 * **FIVE OF THE SEVEN CARRY NO `skill`, and they are the SECURITY class** (plan
 * §12 ruling 4). `bms.alarm_skills` holds `electrical`, `mechanical`, `hvac`,
 * `controls` and `civil`, and none of the five answers a forced door, a held
 * door, an opened enclosure, a burst of denied attempts or a fire release: the
 * security desk and the fire function do, and neither is a maintenance trade.
 * The field is omitted rather than routing the alarm to the wrong one. When
 * `F4.78` adds the trades, those rows gain a skill in a `stockVersion 2`.
 *
 * The two that DO carry one are the controller's own infrastructure —
 * `controller_comms_loss` is `controls` (the head-end link) and
 * `controller_on_battery` is `electrical` (the mains supply). That is the
 * distinction ruling 4 fixed for the whole pack: a trade answers the device's
 * infrastructure; none answers the event the device reports.
 *
 * **EVERY ALARM IS PAIR-ABSENT AND CARRIES A POPULATED `philosophy`** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5,
 * B7): the held-open timer, the denial-burst count and the window it accumulates
 * over are all commissioning values, set per door by the site's security policy.
 * A corridor door and a server-room door answer them differently.
 *
 * **`door_forced` AND `fire_release_active` ARE BOTH `critical`.** The first is
 * an intrusion in progress. The second is the correct behaviour of a safe
 * building and is also the moment that floor has no access control at all, which
 * is why it pages rather than logs.
 *
 * **OBSERVE-ONLY, like the fire panel** (ADR 0054 decision 11): no door release,
 * no lockdown command, no reader disable. The tag list fences access as
 * observe-only and this template has no command surface to fence.
 *
 * ---
 *
 * **MAINTENANCE — 3 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * door-hardware and controller service practice, because the tag list has no
 * maintenance section. **One is `safetyCritical`** (plan §12 ruling 6): the
 * fire-release and REX functional test. It is the EGRESS path — a lock that does
 * not release on the fire input, or a request-to-exit that does not fire, traps
 * people behind a controlled door in the one condition the door was allowed to
 * exist for. **No `condition_based` plan**, and that is authored rather than
 * omitted: door hardware wears on a schedule and not on a reading, the two
 * counters that move are traffic rather than condition, and a rising denial rate
 * is a reader or credential problem the security desk answers now, not a work
 * order a plan raises in ninety days.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here the controller's door object or the gateway point the
 * integrator mapped — which the tag list does not know and the catalog must not
 * guess. An imported draft cannot be instantiated until an operator fills the
 * patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `facility-access-door` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §3, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const FACILITY_ACCESS_DOOR: StockAssetTemplateEntry = {
  code: "facility-access-door",
  name: "Access control door / controller",
  assetType: "access_door",
  domain: "facility",
  description:
    "One access-control door on its controller, published to the BMS over a BACnet or " +
    "integration gateway: door and lock state, forced and held-open events, the door's control " +
    "mode, reader health, the controller's own head-end link, tamper, mains and backup battery, " +
    "the granted, denied and request-to-exit event counts, the fire-release and lockdown states, " +
    "and a turnstile's run status. Counts and states only — no credential, card or person data " +
    "crosses into telemetry, because the access system keeps the who. A bank of doors or " +
    "turnstiles is an asset group at its location, not a child of this template. Authored from " +
    "docs/e5.3-derived-taglist-v1.md §3 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required and X optional; alarm rows carry a meaning " +
    "and no limit, because the held-open timer and the denial-burst count are set per door at " +
    "commissioning. One derived point is authored — the denial ratio over the interval's own " +
    "traffic — and three of the section's derived codes are deferred and named: two are time " +
    "windows and one is a health roll-up that belongs on the health surface, not on a point.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "door_forced",
        pointKey: "door_forced_state",
        severity: "critical",
        category: "safety",
        message:
          "Door opened without a grant — the contact went open while the lock was still " +
          "engaged and no badge, no request-to-exit and no scheduled unlock preceded it.",
        philosophy: {
          cause:
            "A door pushed or levered open, a strike or maglock that no longer holds against " +
            "force, a door contact whose gap has drifted as the leaf sagged, or a leaf that " +
            "swelled and now rests against the frame so the contact reads open on its own.",
          impact:
            "An uncontrolled opening into a space the door exists to control. The access system " +
            "has no record of who went through, because nothing was presented — which is " +
            "precisely why this row exists and why the answer to it is a person and not a report.",
          action:
            "The security desk responds first and looks at the door; this is not a maintenance " +
            "call. Once the opening is accounted for, hand the door to the trade only if the " +
            "cause was hardware — a sagging leaf, a drifted contact or a failed strike are all " +
            "repeat offenders and they read exactly like an intrusion until somebody looks.",
        },
      },
      {
        code: "door_held",
        pointKey: "door_held_state",
        severity: "warning",
        category: "safety",
        message:
          "Door open beyond its held-open timer. The timer is set per door at commissioning: a " +
          "goods entrance and a server-room door do not answer this the same way.",
        philosophy: {
          cause:
            "A door wedged or propped for a delivery or a move, a closer that no longer pulls " +
            "the leaf shut, a latch that misses its keep, or somebody holding the door for " +
            "convenience in a space where that is not allowed.",
          impact:
            "The controlled boundary is open and anybody may walk through it unrecorded. On a " +
            "fire-rated door the compartment line is also open, which is a fire-strategy failure " +
            "and not only an access one.",
          action:
            "Close the door and find out why it was held. If it was propped, that is a security " +
            "conversation with the occupants; if the closer or the latch is the cause it is a " +
            "hardware repair and the door-hardware round is where it belongs.",
        },
      },
      {
        code: "controller_comms_loss",
        pointKey: "controller_comms_ok",
        severity: "critical",
        category: "operations",
        message:
          "Controller to head-end link down. Every other row on this door is now stale, and a " +
          "stale door looks exactly like a quiet one.",
        philosophy: {
          cause:
            "A failed network path or switch port, a gateway that stopped polling, an address or " +
            "credential change on the integration link, or the controller itself powered down or " +
            "hung.",
          impact:
            "The BMS reports no forced door, no held door and no tamper from this controller, " +
            "and every count freezes at its last value. The controller usually keeps working " +
            "standalone, so the door is still secure and the monitoring of it has stopped — " +
            "which is the harder failure, because the panel looks calm.",
          action:
            "Check the network path and the gateway's own poll before touching the controller. " +
            "If the link is healthy from the gateway's side, the controller has stopped " +
            "responding and needs a site visit; its stored events are recovered when the link " +
            "returns.",
          skill: "controls",
        },
      },
      {
        code: "controller_tamper",
        pointKey: "controller_tamper",
        severity: "warning",
        category: "safety",
        message:
          "Controller enclosure opened. The tamper switch has released and no maintenance " +
          "window is a thing the template knows about.",
        philosophy: {
          cause:
            "An engineer working in the panel, a lid left unlatched after a previous visit, an " +
            "attempt to reach the lock wiring and bypass the controller, or a tamper switch " +
            "whose plunger has worn and no longer seats.",
          impact:
            "The controller's wiring is reachable, and the lock outputs on it are the shortest " +
            "route past every door it drives. Most instances are a planned visit; the ones that " +
            "are not are the reason the row is never suppressed.",
          action:
            "The security desk confirms whether a visit was booked. An unexplained tamper is a " +
            "site attendance, and a tamper that keeps releasing with the lid shut is a worn " +
            "switch for the hardware round.",
        },
      },
      {
        code: "controller_on_battery",
        pointKey: "controller_ac_ok",
        severity: "warning",
        category: "operations",
        message:
          "Controller mains supply lost — the panel is running on its backup battery, and the " +
          "time it holds for is the battery's, not a value this template can carry.",
        philosophy: {
          cause:
            "A tripped supply breaker or RCD on the access panel's circuit, a failed power " +
            "supply unit, a floor-level supply outage, or a spur switched off during other work " +
            "in the riser.",
          impact:
            "The doors on this controller stay live only while the battery holds. When it " +
            "empties, every door falls to its fail-safe or fail-secure state — free egress or " +
            "locked shut depending on how each was designed — and that transition is exactly " +
            "the one nobody wants to discover at the time it happens.",
          action:
            "Restore the supply. Check the breaker and the power supply unit first, and treat a " +
            "controller that reports mains loss repeatedly as a supply fault rather than a " +
            "series of events; the backup battery test is the plan that keeps the hold time " +
            "honest.",
          skill: "electrical",
        },
      },
      {
        code: "denied_burst",
        pointKey: "access_denied_count",
        severity: "warning",
        category: "safety",
        message:
          "Denied events accumulating on this door within the interval — an attempt pattern. " +
          "The count that means something, and the window it accumulates over, are the site's " +
          "security policy and are set per door.",
        philosophy: {
          cause:
            "A credential that has expired or was never given rights to this door, somebody " +
            "trying badges at a door they should not be at, a reader that has stopped decoding " +
            "cleanly and refuses valid presentations, or an access group edited so a whole shift " +
            "lost its rights at once.",
          impact:
            "Either people who should get through cannot — a rights or reader problem that will " +
            "arrive as a complaint — or somebody is trying doors. The template cannot tell those " +
            "apart and does not pretend to; it reports the pattern.",
          action:
            "Security decides the response, not the BMS: the access system holds the events and " +
            "the identities, and this row is only the signal to go and look at them. If the " +
            "denials are one credential, it is a rights question; if they are many, look at the " +
            "reader and at what changed in the access groups.",
        },
      },
      {
        code: "fire_release_active",
        pointKey: "fire_release_state",
        severity: "critical",
        category: "safety",
        message:
          "Doors released by the fire input. This is the correct behaviour of a safe building " +
          "and it is also the moment the floor has no access control at all.",
        philosophy: {
          cause:
            "A fire alarm on the floor driving the release input, a fire-panel test nobody told " +
            "the security desk about, a failed release relay sitting in its released state, or " +
            "an input wired to fail open that has lost its supply.",
          impact:
            "Every door on the release group is in free egress, which is what the fire strategy " +
            "requires and what the building's evacuation depends on. It also means the secured " +
            "boundary is gone until the input clears, so the space is open to anyone in it.",
          action:
            "Treat it as a fire event until the fire function says otherwise. If the fire panel " +
            "is clear, the release circuit itself is stuck and that is an immediate call: a " +
            "release that will not clear leaves the floor unsecured, and one that is stuck the " +
            "other way is far worse and is what the six-monthly functional test looks for.",
        },
      },
    ],
    maintenance: [
      {
        title: "Door hardware and lock inspection",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 30,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Check the leaf, the closer, the latch and the keep, the strike or maglock and its " +
          "fixings, and the door contact's gap with the leaf shut. A sagging leaf and a drifted " +
          "contact are what turn into door_forced and door_held rows nobody can explain, and " +
          "both are a quarter of an hour's adjustment if they are caught here.",
      },
      {
        title: "Controller backup battery test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 30,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Drop the mains supply to the controller and confirm it holds on its backup battery " +
          "for the period the panel was designed for, with controller_battery_ok healthy " +
          "throughout. A battery that no longer holds is invisible until the supply fails, and " +
          "the doors then fall to their fail state with nobody expecting it.",
      },
      {
        title: "Fire-release and REX functional test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 45,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Operate the fire-release input and confirm every door on the group releases and " +
          "fire_release_state reports it, then press each request-to-exit and confirm the door " +
          "releases and rex_count moves. This is the EGRESS path: a lock that does not release " +
          "on the fire input, or a request-to-exit that does not fire, traps people behind a " +
          "controlled door in the one condition the door was allowed to exist for. Restore the " +
          "input and confirm the doors resecure before leaving.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "door_state", label: "Door open / closed (contact)", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "lock_state", label: "Lock engaged / released", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "door_forced_state", label: "Door forced open", unit: null, required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "door_held_state", label: "Door held open beyond timer", unit: null, required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "door_mode", label: "Secured / unlocked / lockdown / schedule", unit: null, required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "reader_ok", label: "Reader online", unit: null, required: false, sortOrder: 5, meta: EXTENDED },
    // Declared HERE — §3 is this code's first occurrence in the document, so it
    // is filed under `facility` (ADR 0054 decision 3) and PR 2's lift and
    // escalator reference it rather than redeclaring it. Tier C: a controller
    // the head-end cannot reach reports nothing at all.
    { ...MEASURED, pointKey: "controller_comms_ok", label: "Controller ↔ head-end link healthy", unit: null, required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "controller_tamper", label: "Enclosure tamper", unit: null, required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "controller_ac_ok", label: "Controller mains healthy", unit: null, required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "controller_battery_ok", label: "Controller backup battery healthy", unit: null, required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "access_granted_count", label: "Granted events", unit: null, required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "access_denied_count", label: "Denied events", unit: null, required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "rex_count", label: "Request-to-exit presses", unit: null, required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "fire_release_state", label: "Doors released by fire input", unit: null, required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "lockdown_state", label: "Lockdown active", unit: null, required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "turnstile_status", label: "Turnstile / barrier run status", unit: null, required: false, sortOrder: 15, meta: EXTENDED },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the door HAS FITTED, and a computed point is fitted by nobody.
    // The denominator is the SUM of both counters, so the result is a fraction
    // of the interval's traffic; a door with no traffic divides by zero and
    // evaluate.ts returns non_finite, which is why nothing here is clamped.
    {
      ...derived("{access_denied_count} / ({access_granted_count} + {access_denied_count}) * 100"),
      pointKey: "denied_ratio_pct",
      label: "Denied events as a share of the interval's traffic",
      unit: "%",
      required: false,
      sortOrder: 16,
    },
  ],
};

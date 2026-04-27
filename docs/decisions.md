# Decisions Log (Prototype Phase)

Lightweight ADR-lite log. One entry per non-obvious choice made during
the prototype phase. Format is intentionally minimal so it stays
current. Once we enter the first production phase, new decisions become
full ADRs in `docs/adr/` per `docs/AGENTS.production.md` §15.

## Format

```
## D-NNNN — <title>
Date: YYYY-MM-DD
Status: accepted | superseded by D-NNNN
Context: ...
Decision: ...
Consequences: ...
```

---

## D-0001 — Prototype scope: seven screens, quality first, ~7–8 weeks

Date: 2026-04-27
Status: accepted

**Context.** The original prototype proposal was a five-screen, six-week
build with a single animated schematic (Electrical SLD). On reviewing
the mockup (`ESKOM_SMOC.html`) and the demo audience, the SLD alone
under-sells the BMS narrative: electrical monitoring without HVAC or
energy analytics is a thin story for an Eskom-class buyer. Schedule is
open; quality matters more than the calendar.

**Decision.** Expand prototype scope to seven screens:

1. Login
2. Executive Dashboard
3. Alarm Centre
4. World Map
5. Electrical SLD (animated)
6. CRAC / Cooling schematic (animated)
7. Energy Centre dashboard (charts only)

Target timeline: 7–8 weeks instead of 6. Audience is mixed (internal,
Eskom buyer, investor). Breadth of narrative is prioritised alongside
visual polish.

**Consequences.**

- Simulator must produce telemetry across three domains: electrical,
  HVAC, and aggregate energy. Energy Centre reuses electrical data and
  is therefore cheap; CRAC adds a fresh HVAC point set.
- The "telemetry → React → animated SVG" pattern is built once on the
  SLD and reused for CRAC.
- Out-of-scope list in `AGENTS.md` §6 stays unchanged — Three.js
  Control Room, AI Copilot, real protocol adapters, etc. remain
  deferred.
- Roadmap (`docs/roadmap.md`) will allocate the extra 1–2 weeks to
  CRAC simulator + UI; Energy Centre is a stretch screen built late on
  reused data.

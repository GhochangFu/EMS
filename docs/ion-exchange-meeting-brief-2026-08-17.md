# Internal brief — Ion Exchange meeting, 2026-08-17

**Audience: the Euphoria team. Do not send this file to the client.**
The client-safe versions are
[`ion-exchange-client-handover-2026-08-17.md`](./ion-exchange-client-handover-2026-08-17.md)
and its
[response form](./ion-exchange-response-form-2026-08-17.md) /
[CSV](./ion-exchange-response-form-2026-08-17.csv).

---

## The document set, and who gets what

| File | Audience | Contains |
|------|----------|----------|
| `ion-exchange-clarifications-2026-08-17.md` | **Internal master** | All 22 asks + effort figures + ADR collisions + the do-not-raise list |
| `ion-exchange-meeting-brief-2026-08-17.md` *(this file)* | **Internal** | How to run the meeting |
| `ion-exchange-client-handover-2026-08-17.md` | **Client** | The same 22 asks, client voice, no estimates, no internal references — plus **§4, the assumption register** |
| `ion-exchange-response-form-2026-08-17.md` + `.csv` | **Client** | Fillable answer collection, reference numbers matching the handover; **Section 0 is the assumption tick-list** |

**Section 4 of the handover states every assumption we are building on**, in the
client's own document, with what breaks if each is wrong. Two things follow from
that. First, a large part of the reply can be *"confirmed"* — cheap for them,
and it closes items. Second, **an assumption they have seen and not corrected is
a far stronger position for us than one we never wrote down**, which is the
whole reason it is in their copy rather than only in ours. C21 (environments,
acceptance, training, support, warranty) deliberately carries **no** assumption
and says so — do not let it be inferred into one in conversation.

**Five rows are marked ▲ and are commercial, not technical — A5, A6, B12, B13,
B15.** Each phases something the SOW says *shall*: §11's three deployment models
and multi-tenancy, §10's four integration targets, §12's compliance clause, and
§4.3's five health-score inputs. They are defensible phasing, and they are
written as **proposals needing explicit agreement** rather than assumptions that
pass by default — because "you didn't correct our assumption" is not a position
to take on a signed clause. **Do not let these five be nodded through**; if the
meeting is engineers-only, carry them to whoever owns the commercial
relationship. Nothing here reduces the SOW, and the document says so in those
words.

**Reference numbers (A1 … C22) are identical across all four files**, so an
answer comes back as "A4" and lands on one row in one place. Four items have
more than one part and carry **lettered sub-refs — `A3a/b`, `C18a/b/c`,
`C21a–f`, `C22a/b`** — used consistently in the handover, the form and the CSV.
The internal master keeps them at top level (`A3`, `C18`, `C21`, `C22`) with the
parts as bullets, so a lettered answer maps to the parent row there. If you
renumber anything, renumber it everywhere.

---

## Why we are meeting

We converted the SOW into a costed, sequenced backlog. Most of it is buildable
as written and is under way. What we cannot resolve internally is a set of
inputs only Ion Exchange holds — 22 of them, of which four are load-bearing
today.

Five of the 22 were emailed on 2026-08-09 and **have never been answered**
(`e5.1-client-questions.md`). They are restated as A1, A3, B7, B8 and C17. The
meeting is partly about getting those unstuck; a mailed question set has now
demonstrably failed once.

## The four to come away with

| Ref | Ask | What it unblocks |
|-----|-----|------------------|
| **A1** | Tag list from any one plant | `E5.1` water pack — flagship P0, 6–8 pw, blocked since 2026-08-09 |
| **A2** | The overlay boundary (SOW §14) | `E1.1` ML foundation, 8–12 pw — and the ML-stack ADR, which cannot be drafted without it |
| **A4** | Which protocol first + device details | `F1.2`–`F1.6`, 10–14 pw each (DCS 8–12) — largest single guess on the board |
| **A5** | Deployment model + access to real hardware | `E7.2`/`E7.3`/`F4.27`, and the longest lead-time item in the engagement |

**A2 is new and did not come from the backlog** — it came out of reading the SOW
directly. §1, §2 and §14 all say Ion Exchange overlays *their* templates, AI
models and optimisation logic onto our foundation, and nothing anywhere defines
that seam. Whether §4 means "build the models" or "build a plug-in surface for
their models" is two different products. Nobody has asked them this.

## Getting an answer, not a nod

Every P0 ask needs four fields captured **in the room**: **artifact · named
owner · date · acceptable format.** "We'll send it" is what happened on
2026-08-09. The response form has a column for each.

For A1 specifically: the acceptable formats are a P&ID, an I/O schedule, or a
SCADA/PLC tag export — **any one plant, any type, redacted is fine.** Say all of
that out loud; the breadth is the point, and it is what makes the ask easy to
say yes to.

---

## Two traps — read before the meeting

**1. B7 can reopen a merged ADR. Do not concede in the room.**
[ADR 0019](./adr/0019-template-content-model.md) is accepted and declares
`thresholdValue: number` — **required**. The answer we expect from B7 ("limits
are set per site at commissioning") makes such a template unauthorable without
inventing placeholder numbers, which is exactly what 0019 was written to
prevent. That answer requires **ADR 0019 Amendment 1**, and amending an accepted
ADR is the repo owner's call. **Take the answer, thank them, raise the amendment
afterwards.** Do not agree to a schema change across the table.

**2. C18 asks whether the dark canvas is a *requirement* — not whether we will
do it.** Adopting it contradicts `AGENTS.md` §5, both mockups and every shipped
page at once; that is a §10 scope change and an owner decision. Useful fact to
hold: the reference's *density and component vocabulary* (alarm rail, process
diagram, stepper, health donut, gauges) are all achievable in the existing light
palette — **only the canvas colour is gated**, so nothing stalls either way. Say
"noted, we'll come back on it", not "yes".

## Do not raise these

They are open on our board and they are ours to decide. Raising them reads as
asking the client to run our engineering:

- ML stack for `E1.x` — **A2 is the client-facing half** (what plugs in); the
  stack choice stays ours
- `apps/api` `moduleResolution`
- The E8.1 encryption-at-rest boundary retro ADR
- Rule-vocabulary `CHECK` constraints (absorbed into ADR 0031)
- Whether to write the dark-canvas / domain-first IA ADRs at all

## Three asks need a commercial voice, not only an engineer

**A2** (who builds what, under §14), **C20** (instrumentation: supply vs
integrate, under §8) and **C21** (environments, acceptance, training, support and
warranty, under §13). If the meeting is engineers-only, flag these as needing a
follow-up rather than settling them informally.

---

## Likely questions back, and the honest answer

| They ask | Answer |
|----------|--------|
| "When will it be done?" | Sequenced, not dated — several items are gated on answers we are asking for today. We re-issue the plan once A1/A2/A4/A5 land. **Do not give a date built on an assumption we are in the room to test.** |
| "Can you do the dark theme?" | Achievable; it is a decision on our side about the design system, and we will come back with an answer rather than a yes. (See trap 2.) |
| "How much will X cost?" | Not in this document, deliberately. Effort figures are planning-grade and live in the internal master only. |
| "Can you support all the protocols in §10?" | Architecturally yes — that is what the adapter framework is for. Each one is real engineering, which is why A4 asks for an order rather than a list. |
| "Do we need to answer all 22 today?" | No. Four (§3 of the handover). The rest have a form and a date. |
| "Who does the AI?" | That is A2, and it is the question we most want their view on rather than ours. |

## After the meeting

1. Record answers: A1/A3/B7/B8/C17 go into `e5.1-client-questions.md`; the rest
   into `ion-exchange-clarifications-2026-08-17.md`.
2. Anything still open at the next review becomes a **written stated
   assumption** — visible, dated, and in the plan rather than in someone's head.
3. Board follow-through for the answers we get:
   - **A1/A3** → write the `E5.1` ADR *before* any `E5.1` code; update the
     `E5.1` row in `BACKLOG.md` §2 Track B (§1's critical-path note and §1b
     slot 8 both point at it).
   - **A2** → prerequisite for the **ML stack ADR** in §5.
   - **A4** → each protocol still needs its own scope ADR under AGENTS.md §6/§10;
     an answer makes one *startable*, not started.
   - **A6** → feeds the §5 *Multi-tenancy re-open* row.
   - **B7** → ADR 0019 Amendment 1, human-gated.
   - **B9** → `F4.46`.
   - **C18** → the two §5 UI decision rows, human-gated.

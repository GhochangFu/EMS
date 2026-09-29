# ADR 0083 — IONSiTE NEXUS replaces TRINETRA on screen (`F3.33`)

## Status

Accepted — drafted on 2026-09-29 at the `F3.33` start gate, before any
implementation code. Four gate questions were put to the owner one at a time
and are recorded under *Gate questions*. **Q2 was asked twice**: at the first
asking the owner told us to search the project documents for an IONSiTE NEXUS
logo before choosing, and the question was put again on what the search found.

## Context

[ADR 0013](./0013-ion-exchange-ems-fork.md) kept **TRINETRA** as the product
brand for the Ion Exchange fork and limited branding to the display layer.
The client's mail of 2026-08-22 renamed the product: *"I am referring to the
product as IONSiTE NEXUS (water-energy nexus)"*, an *"Integrated Building,
Energy, Water & Utility Management Platform"*. `docs/BACKLOG.md` raised
`F3.33` for the rename and listed it in §5 as an open commercial decision —
replace TRINETRA or co-present with it — because C22b (brand assets, and how
the names co-present) was never answered. It is still unanswered: the
2026-08-22 response form asked it again as C22.

The first stable version ships to Ion Exchange on 2026-10-02, with a merge
cut-off at the end of 2026-09-30. The owner ruled the name at this gate.

**What the document search found (Q2).** No IONSiTE NEXUS logo file exists in
the repository. `docs/IonSiTE Nexus Features.xlsx`,
`docs/InFoReqrd-IONExchange.docx` and `docs/platform-assessment-consolidated.docx`
carry no images. Our own Nexus proposal
(`docs/ion-exchange-nexus-dashboard-2026-08-29.html`) sets the name as plain
text. The SOW (`docs/sow-enterprise-ems-euphoria-infotech.pdf`) holds two
images, both client reference screens; their sidebar shows the name as
lettering — "IONSiTE" in bold white with "Sustainability" in green under it —
not as a logo that could be lifted.

## Decision

1. **IONSiTE NEXUS replaces TRINETRA wherever a user reads the product name.**
   The spelling is exactly `IONSiTE NEXUS` (lower-case *i*). "Powered by
   Euphoria Infotech India Limited" stays, and so does every existing mention
   of Ion Exchange (India) Ltd. as the client. TRINETRA does not co-present.
2. **The wordmark is text, not an image.** "IONSiTE" in bold in the ink of its
   surface (`on-dark` on `chrome`), "NEXUS" in `accent` — modelled on the SOW
   screens' two-line lettering, drawn from the ADR 0078 roles so it follows the
   theme. The header and the login hero stop importing
   `apps/web/src/assets/trinetra-logo.jpeg`; the file is deleted (git history
   keeps it). When C22b delivers a real logo it replaces the wordmark under an
   amendment to this ADR.
3. **The tagline is the client's own descriptor**: *Integrated Building,
   Energy, Water & Utility Management Platform* replaces "Intelligent Building
   Management System" in the header, and the login headline is built from the
   same words.
4. **Scope: all user-visible text.**
   - `apps/web` — the header, the footer, the login page, the auth callback
     page, the dashboard title, and the document `<title>` in
     `apps/web/index.html`.
   - `apps/api` — the report e-mail sentence
     (`NO_HISTORY_URL_SENTENCE`), the test-notification subject and body, the
     OpenAPI document title and the Swagger UI site title, and the onboarding
     assistant's system prompt (the assistant names the product to the user).
   - `infra/keycloak/bms-realm.json` — the realm `displayName`. This applies
     on a fresh realm import only; a realm that already exists keeps
     "TRINETRA" until an admin changes it in the Keycloak console, which is a
     deploy step and not code.
5. **Kept under their existing names** (ADR 0013 decision 3, extended):
   - the webhook header `x-trinetra-signature` — a receiver verifies it, so a
     rename is a breaking contract change;
   - the `SMTP_FROM` default `trinetra@localhost` — a development default that
     every deployment overrides;
   - the realm id `bms`, code symbols and file names;
   - the read-only mockup `TRINETRA.html` and the comments that cite it;
   - repository documents — README, `CLAUDE.md`, `AGENTS.md`, ADRs and plans
     keep TRINETRA as the platform's internal name. The `chore(agents):` sweep
     after the build records the on-screen name in AGENTS.md.
6. **A gate holds the rename.** A repository test scans the user-visible
   sources named in decision 4 for `TRINETRA` (any case) outside comments and
   the identifiers in decision 5, and fails on any hit — so a later change
   cannot bring the old name back to the screen unnoticed.

## Dependencies

None.

## Consequences

- The rename is string edits plus one removed image import; a revert is the
  same size.
- The specs that assert the old strings change with them
  (`report-render-delivery.spec.ts` asserts the report sentence).
- A deployment whose Keycloak realm was imported before this change shows
  "TRINETRA" on the Keycloak sign-in page until an admin edits the realm's
  display name; the release notes for the demo host must say so.
- C22b stays open for the real logo and colours; `F3.29` (shell chrome
  parity) is unaffected and still owns the header's layout.
- `docs/BACKLOG.md` §5 "IONSiTE NEXUS rebrand" is resolved by this ADR.

## Gate questions

| # | Question | Options put | Ruling |
|---|---|---|---|
| Q1 | How does IONSiTE NEXUS show on screen relative to TRINETRA? | NEXUS leads with "on TRINETRA" beside it (recommended) · NEXUS replaces TRINETRA · keep TRINETRA for v1 | **NEXUS replaces TRINETRA** — decision 1 |
| Q2 | What replaces the TRINETRA logo image, which has the word TRINETRA drawn in it? | First asking: text wordmark · the eye glyph plus text · the owner supplies a file. The owner asked for a document search first. Second asking, after the search: text wordmark in the SOW style (recommended) · plain text · the owner supplies a file | **Text wordmark in the SOW style** — decision 2 |
| Q3 | What is the tagline under IONSiTE NEXUS? | The client's descriptor (recommended) · "Water-energy nexus" · keep the current tagline | **The client's descriptor** — decision 3 |
| Q4 | Beyond the web screens, which surfaces does the rebrand cover? | All user-visible text (recommended) · web screens only · everything including contracts | **All user-visible text** — decisions 4 and 5 |

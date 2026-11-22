# ADR 0142 — Verve replaces IONSiTE NEXUS on screen

## Status

Accepted — drafted on 2026-11-22 at the owner's request, before any
implementation code and before a backlog row exists. Five gate questions were
put to the owner one at a time in the drafting session and are recorded under
*Gate questions*. The owner reviewed and approved this written record on
2026-11-22.

Supersedes [ADR 0083](./0083-ionsite-nexus-on-screen-name.md) decisions 1, 2, 3
and 6. ADR 0083 decisions 4 and 5 (which surfaces carry the name, and which
identifiers keep their old names) are carried forward here unchanged except
where stated.

## Context

[ADR 0083](./0083-ionsite-nexus-on-screen-name.md) put **IONSiTE NEXUS** on
screen in place of TRINETRA, as a two-tone text wordmark, because no logo file
existed (its Q2) and client question C22b (brand assets) was never answered.
Its decision 2 said a real logo would arrive "under an amendment to this ADR".

On 2026-11-22 the owner ruled a new product name, **Verve**, and stated that
IONSiTE NEXUS "will not be there". The owner supplied four brand boards. Three
of the four agree on one direction: a wordmark whose first letter is a pulse
(heartbeat) line, navy and emerald, with an app-icon short form. The boards
disagree on the tagline (three different lines) and on the short mark (a pulse
line and a node-network "V" both appear).

This is a rename plus a first real logo, so it is a new ADR and not an
amendment: the name, the mark and the tagline all change, and the F3.33 gate
that today *requires* the string `IONSiTE NEXUS` must be inverted.

Unlike IONSiTE NEXUS, the name Verve did not come from the client's mail. The
owner's ruling is taken as covering every deployment, including Ion Exchange's
(see *Consequences*).

## Decision

1. **Verve replaces IONSiTE NEXUS wherever a user reads the product name.**
   The spelling in running text is exactly `Verve` (capital V, lower-case
   rest). IONSiTE NEXUS does not co-present. "Powered by Euphoria Infotech
   India Limited" stays, and so does every existing mention of Ion Exchange
   (India) Ltd. as the client. The login page's decorative role pill
   "NEXUS Admin" becomes **"Verve Admin"**.
2. **The logo is the Pulse V** (owner ruling Q2, option A of six drawn).
   - *Full logo*: one continuous pulse line that forms the letter V — a short
     lead-in, a small dip, the V's descent, a tall peak, a short tail — followed
     by the letters "erve" in Montserrat Bold.
   - *Short logo*: the same pulse line alone, inside a rounded-square tile. It
     is the favicon and the collapsed-sidebar mark.
   - *Colour*: the pulse line carries **one continuous gradient**, never two
     flat segments (owner ruling, second review). On a light surface: navy
     `#0F172A` → deep teal `#0F5F6B` → emerald `#10B981`, with the letters in
     navy. On a dark surface: sky `#38BDF8` → teal `#14B8A6` → mint `#34D399`,
     with the letters in white.
   - *One-colour forms*: a flat navy and a flat white version exist for print,
     stamps and any surface where a gradient cannot render.
   - The node-network "V" on the boards is **not** used: it does not hold at
     16 px. The lowercase all-teal wordmark on board 3 is not used: the pulse
     hides the second "v".
3. **The logo is an inline SVG, with the letters converted to outlines.**
   `apps/web/src/components/wordmark.tsx` stops rendering two text spans and
   renders the SVG; it keeps its `header` and `hero` variants and its
   accessible name, which becomes `Verve`. No web font is loaded and no
   package is added — the Montserrat glyphs live in the path data. The
   gradient stops are the logo's own fixed brand colours and are **not** drawn
   from the ADR 0078 theme roles: a logo does not re-tint with the theme. The
   component picks the light or dark form from the surface it sits on.
   `apps/web/index.html` gains an SVG favicon of the short logo.
4. **The tagline is "The pulse of every site"** (owner ruling Q3). It replaces
   *Integrated Building, Energy, Water & Utility Management Platform* in the
   header and is the whole login headline — the old tail "· Smart insight,
   always on." is dropped (owner ruling Q5). The three board taglines are
   not used: "Intelligent energy. Seamless control." promises control where the
   product monitors, and the two "building" lines leave out water plants, pump
   stations and cold rooms.
5. **Scope: all user-visible text** — ADR 0083 decision 4, carried forward
   (owner ruling Q4), with the surfaces added since:
   - `apps/web` — the wordmark, the shell footer, the login page, the auth
     callback page, the document `<title>`, and the appearance label
     "Nexus (default)" in `components/appearance/labels.ts`, which becomes
     "Verve (default)" with its description reworded.
   - `apps/api` — the report e-mail sentence (`NO_HISTORY_URL_SENTENCE`), the
     test-notification subject and body, the OpenAPI document title and the
     Swagger UI site title, the onboarding assistant's system prompt, and the
     administrator copilot's system prompt (`copilot-turn.service.ts`).
   - `infra/keycloak/bms-realm.json` — the realm `displayName`. As in ADR 0083
     this applies on a fresh realm import only.
6. **Kept under their existing names** — ADR 0083 decision 5, carried forward:
   the webhook header `x-trinetra-signature`, the `SMTP_FROM` default
   `trinetra@localhost`, the realm id `bms`, code symbols and file names, the
   read-only mockups, and TRINETRA as the platform's internal name in
   repository documents. Added here: the appearance theme **key** `nexus`
   stays (it is stored in user preferences; only its label changes), and the
   `F3.33` test file keeps its file name.
7. **The gate is inverted and extended.** `tests/f3.33-on-screen-name-gate.test.ts`
   today fails on `TRINETRA` and *requires* at least one exact `IONSiTE NEXUS`
   (its N8). After this ADR it fails on `TRINETRA` **and** on
   `/ion\s?site|nexus/i` in the same scanned sources, outside comments and the
   identifiers in decision 6 (the theme key `nexus` joins the allowlist as an
   exact literal), and N8 requires at least one exact `Verve`. A second
   assertion holds decision 2: the wordmark's pulse path has exactly one
   `stroke` and that stroke is a gradient reference.

## Dependencies

None. No npm package and no web font: the logo is path data.

## Consequences

- **The client's own name leaves the screen.** IONSiTE NEXUS was Ion
  Exchange's name for the product (their mail of 2026-08-22). The owner should
  tell Ion Exchange before the demo host changes; if they object, a per-
  organisation display name is a new feature and a new ADR, not part of this
  one.
- **Trademark and licence checks are the owner's and are not done.** "Verve"
  is used by other companies; a search in the software and energy classes
  should precede external use. Montserrat is under the SIL Open Font License,
  which is understood to permit logo use; outlining the glyphs avoids
  redistributing the font file.
- The boards are raster images. The final SVG geometry is drawn in the build
  and shown to the owner before merge; the sketch reviewed on 2026-11-22 is
  the reference for shape, not the final outline.
- The specs that assert the old strings change with them (the wordmark,
  app-shell, shells, login, auth-callback, notifications, onboarding and
  report-delivery specs, and the `sidebar-shell.html` fixture).
- A Keycloak realm imported before this change shows "IONSiTE NEXUS" on its
  sign-in page until an admin edits the display name — a deploy step for the
  demo host, to go in its release notes.
- `AGENTS.md`, `CLAUDE.md` and `apps/web/PRODUCT.md` name IONSiTE NEXUS as the
  on-screen name. `AGENTS.md` changes only through the `chore(agents):` sweep
  after the build (§9.10); the other two change with the build.
- Past ADRs, plans and backlog rows keep the name IONSiTE NEXUS: they record
  what was true when written.
- A backlog row for the build is raised when this ADR is accepted; the next
  free ID is read from `origin/main` at that time.

## Gate questions

| # | Question | Options put | Ruling |
|---|---|---|---|
| Q1 | What is the product called on screen? | — (owner statement, 2026-11-22) | **Verve; IONSiTE NEXUS is removed** — decision 1 |
| Q2 | Which logo? | A pulse V wordmark (recommended) · B node-network V · C lowercase pulse wordmark · D gauge V · E waveform V · F monogram V with status dot | **A, pulse V**, with one continuous gradient on the pulse line — decisions 2 and 3 |
| Q3 | Which tagline? | First: lead with pulse / live data (recommended) · energy first · keep board 1's line · board 3's "smart buildings". Then the exact line: "The pulse of every site" (recommended) · "The pulse of your operations" · "Every site. Every signal. Live." · "The pulse of intelligent energy" | **"The pulse of every site"** — decision 4 |
| Q4 | Beyond the web screens, which surfaces does the rename cover? | All user-visible text, as ADR 0083 Q4 (recommended) · web screens only | **All user-visible text** — decision 5 |
| Q5 | Does the login headline keep its tail "· Smart insight, always on."? | Tagline alone (recommended — two slogans compete) · tagline plus the old tail | **Tagline alone** — decision 4 |

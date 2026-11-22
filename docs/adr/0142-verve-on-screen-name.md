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

## Amendment 1 — the pulse and the letters are traced from brand board 1; the pulse is a filled shape (`F4.398`) (owner, 2026-11-22)

**Status: Accepted — 2026-11-22** (owner, in chat: "Accept"; proposed the
same day). After the ADR merged, the final SVG files were drawn and shown to
the owner, who answered with a crop of brand board 1 and "Follow this". The
files were redrawn to that reference twice the same day; the owner approved
the traced version (A3). This amendment records what changed against
decisions 2, 3, 5, 6 and 7.

1. **The pulse is one filled shape, not a stroked line** (amends decision 2).
   As on board 1: a wedge-shaped lead-in, a first rise that starts the V's
   left arm above the small letters, a foot that drops below the baseline, a
   peak about 2.3 x-heights above the baseline, and a thin wedge-shaped tail
   that runs over the "e". The V is therefore larger than the letters beside
   it. It is still one shape carrying one continuous gradient, foot to peak.
2. **The pulse and the letters "erve" are traced from board 1**, not set in
   Montserrat (amends decisions 2 and 3). A first redraw measured the pulse by
   eye and set the letters in Montserrat ExtraBold; the owner rejected it
   ("still not okay … compare with the pasted image"). A weight fit then
   showed Montserrat is not the board's lettering at any weight (best overlap
   0.74; the board's "e" and "r" are narrower), so the shapes and the spacing
   are taken from the board itself: each shape's outline is traced from the
   image, smoothed and written as path data. The letters remain outlines, with
   no font and no package. Only the tagline is set from a font (Montserrat
   Medium, outlined). The Montserrat licence note in *Consequences* now
   applies to the tagline only.
   The pulse's gradient is on a vertical axis, foot to peak, with five stops
   at offsets 0, 0.38, 0.6, 0.8 and 1. **The stops are those of the asset
   files.** Light form, measured on the board: `#16405C`, `#18576C`,
   `#189E7F`, `#14B088`, `#1DAF86`. Dark form, decision 2's sky → teal → mint
   spread over the same five offsets: `#38BDF8`, `#22B5D4`, `#14B8A6`,
   `#2DD4A0`, `#34D399`. The letter ink stays navy `#0F172A` on light and
   white on dark. These replace decision 2's three-stop lists.
3. **The gate asserts a fill** (amends decision 7's second assertion): the
   wordmark's pulse path has exactly one `fill`, that fill is a gradient
   reference, and the path has no `stroke`.
4. **The tagline is unchanged.** The reference crop carries board 1's line
   "Intelligent energy. Seamless control."; the owner was asked and kept
   decision 4's **"The pulse of every site"**.
5. **The asset home is `docs/brand/verve/`** — twelve SVG files: the full
   logo on light and on dark, each with and without the tagline; the short
   mark on a navy tile, on a white tile and with no tile; and flat navy and
   flat white forms of the logo and of the mark. `build-logo.py` beside them
   regenerates all twelve from the board image; the board image itself is the
   owner's file and is not in the repository.

6. **The gate's old-name pattern is bounded** (amends decision 7). Decision
   7's `/ion\s?site|nexus/i` gives 107 hits on `f57b23cc`, 51 of them false —
   identifiers such as `siteZoneOf` and `OrganizationSiteMap`. The gate uses
   `/trinetra|\bion\s?site|nexus/gi`, and its kept list is token-exact, not
   a substring allowlist: a string literal whose whole text is `nexus` or
   `nexus-soft`, or an identifier that is exactly `nexus` or
   `NEXUS_SOFT_CHART_TYPE`.
7. **"Nexus Soft (default)" becomes "Verve Soft (default)"** (extends
   decisions 5 and 6). It is a second appearance label a user reads. The
   stored design-system key `nexus-soft` and the symbol
   `NEXUS_SOFT_CHART_TYPE` are kept, as the key `nexus` is: no schema change.
8. **The logo's fixed colours get one pinned exception in the colour gate**
   (implements decision 3). `tests/f3.65-colour-roles-gate.test.ts` R21
   permits no hex literal in the web source. R21 skips exactly
   `apps/web/src/components/verve-logo-data.ts`, and a new R21b requires that
   file's hex literals to equal the twelve asset colours of item 2 — a closed
   set, so a thirteenth colour fails. A logo that re-tints with the colour
   profile is **not** in this amendment: the owner asked for it "on request",
   and it is filed as `F4.399` with its own design and ADR owed.

| # | Question | Options put | Ruling |
|---|---|---|---|
| A1 | The owner's reference crop — follow it for what? | — (owner: "Follow this") | **The logo shape follows the crop** — items 1 and 2 |
| A3 | Does the traced logo match the board? | — (shown as `docs/brand/verve/preview.html`) | **Approved** (owner: "Yes, this is perfect") — item 2 |
| A2 | The crop's tagline differs from decision 4. Which is final? | "The pulse of every site" · "Intelligent energy. Seamless control." | **"The pulse of every site"** — item 4 |
| A4 | "Nexus Soft (default)" on the Appearance screen — rename it? | Rename the label, keep the keys (recommended) · keep "Nexus Soft" | **Rename the label** — item 7 |
| A5 | The colour gate permits no fixed colour; the logo needs twelve. | One exact exception (recommended) · the logo follows the theme. Put again with the consequence: keep the approved colours · follow the theme · fixed by default, themed on request | First "the logo follows the theme"; on the second asking **"Fixed by default, themed on request"** — item 8, `F4.399` |

# Build status dashboard

A shareable, management-facing view of `docs/BACKLOG.md`: what has shipped,
what is being built right now, what can start next, and what is eligible but
held. Generated from the board and from this repository's own git history.

**Published at:** <https://claude.ai/code/artifact/6ea26834-e606-44d5-96e6-8d8ea3e509ed>
*(private until shared from the page's own share menu)*

## Refresh it

```bash
node docs/scripts/backlog-status.mjs && node docs/scripts/backlog-dashboard.mjs
```

Then republish `docs/status/backlog-dashboard.html` with the Artifact tool,
**passing the URL above as `url`**. Publishing without it creates a second,
competing artifact — which is the one failure mode that matters here, because
whoever holds the old link is left on a page that nothing rebuilds again.

The page does **not** poll. Its "Data as of" stamp is the honest statement of
how fresh it is, so run the two commands and republish as the last step of each
build cycle, alongside the `docs/BACKLOG.md` status update.

### Auto-republish

`backlog-dashboard.mjs` ends with a `CHANGED` / `UNCHANGED` line. It compares a
fingerprint of everything a reader would notice — items, states, counts, recent
commits — against the one embedded in the previously generated HTML. The
generation timestamp and an uncommitted working tree are deliberately excluded,
so a run that found no news says so instead of churning the artifact.

A Claude session can therefore poll on a timer and republish only on `CHANGED`.
That loop is **session-only**: it dies when the session exits, and Claude Code's
recurring jobs auto-expire after 7 days. Restart it with:

```
/loop 20m Regenerate the TRINETRA build board and republish it only if the data changed. Run: node docs/scripts/backlog-status.mjs && node docs/scripts/backlog-dashboard.mjs — the last line of output says CHANGED or UNCHANGED. If UNCHANGED, do nothing and report a quiet tick. If CHANGED, republish docs/status/backlog-dashboard.html with the Artifact tool (favicon ⚡, url https://claude.ai/code/artifact/6ea26834-e606-44d5-96e6-8d8ea3e509ed) and report in one line what moved.
```

The loop is a convenience, not the contract. The reliable path stays the same:
regenerate and republish as the last step of each build cycle.

### The Stop hook

`.claude/hooks/check-backlog-republish.mjs` runs at the end of every turn in
this repo and removes the need to remember any of the above. It regenerates the
status JSON, compares its fingerprint against `.published-fingerprint`, and on a
match exits silently. On a mismatch it renders the HTML and asks Claude to
publish, quoting the url and the `--mark-published` follow-up.

**A hook cannot publish.** The Artifact tool belongs to the model, not to a
shell, so the guarantee is *regenerated always, republished when a session is
running* — not unattended. `Stop` rather than an `Edit` matcher is deliberate: a
merge, a fetch or a rebase moves a status with no tool touching `BACKLOG.md`,
and that is exactly how the board went stale on 2026-08-21.

Either way, republishing only rebuilds the page. Whether a reader sees the
rebuild is decided by the **Shared version** control described under
[Sharing it](#sharing-it) — not by the republish.

All times on the page are **IST**. `backlog-status.mjs` sets `TZ=Asia/Kolkata`
for its git calls and formats the generation stamp through `Intl`, so nothing
downstream has to convert.

## Sharing it

Two routes, for two different audiences.

**The link, for people who want the current picture.** The artifact is private
until you open it and share it from the page's own share menu. That menu has two
separate controls, and both decide what a reader gets:

| Control | Decides |
|---------|---------|
| **General access** | *who* can open the link at all |
| **Shared version** | *which* version those people see |

**Set `Shared version` to `Latest`.** The control also lists every numbered
version, and it can sit on one of those instead. If it does, republishing does
**not** reach your readers: the URL stays the same and the page still rebuilds,
but every viewer stays on the version that was pinned. This is the quiet
failure — you refresh the board each cycle, and nobody sees it.

On `Latest`, each republish reaches everyone who holds the link, with no further
action.

**The file, for people who just want a report.** Two cuts, both self-contained —
every style, script and chart inlined, no external requests — so they open from
disk, an email attachment or a network share, online or off. Both are
**snapshots**: whoever holds one sees the "Data as of" time it was generated at,
forever — unlike the link on `Latest`, which follows every republish. Print-to-PDF
from the browser works if someone wants it flatter still.

| File | Audience | Contains |
|------|----------|----------|
| `backlog-dashboard.standalone.html` | internal | everything the artifact shows, PR links included |
| `backlog-dashboard.client.html` | **client-facing** | same board, same numbers, no repository |

### What the client cut removes

Same items, same states, same counts, same charts. What goes is everything that
only means something with repository access:

- pull-request links (the delivered cards keep their **ADR** references)
- branch names and commit hashes, in the masthead and on the in-flight card
- the whole *Recent activity* commit log
- the raw board prose behind each row — engineering narrative full of rulebook
  sections and commit numbers. The expandable row keeps the structured facts:
  status, depends, unlocks, and what the item is held for
- file-path citations under each gate, and the working-tree / parser footnotes

Gate wording is swapped for a plain-English `clientReason` declared alongside
each gate in `backlog-status.mjs`. `E5.1` is the one that mattered: internally it
cites `docs/e5.1-client-questions.md`; the client cut says only that it is held
pending confirmation of scope details raised with Ion Exchange.

**This is enforced, not assumed.** `backlog-dashboard.mjs` greps its own output
for GitHub links, internal file paths, branch/commit words and non-SOW `§`
references, and exits non-zero if any survive. `SOW §n` is allowed through —
that is the client's own document.

## What the two scripts do

| File | Role |
|------|------|
| [`../scripts/backlog-status.mjs`](../scripts/backlog-status.mjs) | Parses `BACKLOG.md` §2 into `backlog-status.json`. Owns eligibility, the start-gates, and the git-derived "in flight" set. |
| [`../scripts/backlog-dashboard.mjs`](../scripts/backlog-dashboard.mjs) | Renders that JSON into all three HTML files. Presentation only — it computes no status of its own. |

All four outputs are generated; edit the scripts, never the JSON or the HTML.
`render(forClient)` builds the page once per audience, so the two cuts cannot
drift apart — there is one template, not two. `backlog-dashboard.html` carries no
document skeleton because the Artifact runtime supplies it and rejects your own;
the other two are wrapped by `standalone()`.

## Three things the parser is deliberately careful about

1. **§2 only.** §1 and §1b are narrative — their statuses are wrapped in
   strikethrough and go stale — and §3/§5 are tables with a *different* column
   shape, so parsing them positionally puts `P0` in the Status field. The parser
   bounds itself to §2 and requires the exact seven-column header.
2. **Whole-token `Depends` matching.** §1b records that a prefix match reports
   `E7.2` as unblocked by `F1.1` when it actually needs `F1.10`. A dashboard
   that reproduces that bug ships a wrong "next" list to management.
3. **Eligible is not startable.** A dependency-clear item can still be held by
   AGENTS.md §6 (every further protocol adapter, MinIO, EMQX/BullMQ, MFA, RLS,
   K8s, Three.js, hash-chained audit) or by an unanswered client question
   (`E5.1`). Those constraints live in no column, so they are declared in the
   `GATES` table at the top of `backlog-status.mjs`, each with a citation.
   **Keep that table honest** — if a citation stops being true because the item
   got its ADR, delete the entry rather than leaving it to rot.

"In progress" is likewise derived rather than read: no row uses the `🔵` status,
so the signal is branches not yet merged into `main` whose names map to an id.

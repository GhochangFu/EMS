#!/usr/bin/env node
// Render docs/status/backlog-status.json into the shareable status dashboard.
//
// Output: docs/status/backlog-dashboard.html
//
// Publish it with the Artifact tool using that exact path — the same path
// redeploys to the same URL, which is what "live" means here: the link stays
// current, the page does not poll. Regenerate + republish after each cycle.
//
// Charts are hand-authored inline SVG on purpose: the artifact CSP blocks every
// external host, so a charting library would have to be inlined whole to draw
// six small figures. All times are IST — the parser formats them, this file
// only prints them.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CSS } from "./backlog-dashboard-style.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IN = join(repoRoot, "docs", "status", "backlog-status.json");
const OUT = join(repoRoot, "docs", "status", "backlog-dashboard.html");
// A second, standalone copy for handing to people who are not on claude.ai.
// OUT is a page *fragment* — the Artifact runtime supplies the document
// skeleton — so opening it directly would put a browser in quirks mode.
const OUT_FILE = join(repoRoot, "docs", "status", "backlog-dashboard.standalone.html");
// The client-facing cut. Same board, same numbers, none of the repository.
const OUT_CLIENT = join(repoRoot, "docs", "status", "backlog-dashboard.client.html");

const data = JSON.parse(readFileSync(IN, "utf8"));

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );


/* =====================================================================
   derived views
   ===================================================================== */

const byId = new Map(data.items.map((i) => [i.id, i]));
const item = (id) => byId.get(id);
const P_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };
const inProgressIds = new Set(data.inProgress.map((p) => p.id));
const readyIds = data.ready.filter((id) => !inProgressIds.has(id));

const stateOf = (it) => {
  if (inProgressIds.has(it.id) && it.status !== "done") return { label: "In flight", cls: "lamp-active", key: "flight" };
  if (it.status === "done") return { label: "Done", cls: "lamp-done", key: "done" };
  if (it.status === "dropped") return { label: "Dropped", cls: "lamp-idle", key: "waiting" };
  if (it.gate) return { label: it.gate.kind === "client" ? "Awaiting client" : "Needs ADR", cls: "lamp-gated", key: "held" };
  if (it.status === "planned") return { label: "Planned", cls: "lamp-active", key: "flight" };
  if (it.readyToStart) return { label: "Ready", cls: "lamp-ready", key: "ready" };
  return { label: "Waiting", cls: "lamp-idle", key: "waiting" };
};

const STATE_KEYS = [
  { key: "done", label: "Done", token: "--lamp-done" },
  { key: "flight", label: "In flight", token: "--lamp-active" },
  { key: "ready", label: "Ready", token: "--lamp-ready" },
  { key: "held", label: "Held", token: "--lamp-gated" },
  { key: "waiting", label: "Waiting", token: "--lamp-idle" },
];

for (const it of data.items) it.stateKey = stateOf(it).key;

const pwOf = (it) => it.effortWeeks?.mid ?? 0;
const pwTotal = data.items.reduce((a, it) => a + pwOf(it), 0);
const pwDone = data.items.filter((it) => it.status === "done").reduce((a, it) => a + pwOf(it), 0);
const unsized = data.items.filter((it) => !it.effortWeeks).length;

const prLink = (n) =>
  `<a href="https://github.com/GhochangFu/EMS/pull/${esc(n)}" target="_blank" rel="noopener">#${esc(n)}</a>`;

// `client` is the audience switch. It removes everything that only means
// something to someone with repository access — pull-request links, branch
// names, commit hashes, the commit log, and the file-path citations behind each
// gate — and swaps the gate wording for a plain-English equivalent. It removes
// no item, no state and no number: the client sees the same board, described in
// terms they can act on.
let client = false;

const refs = (it) => {
  const bits = [];
  if (it.adrs.length) bits.push(esc(it.adrs.join(" · ")));
  if (!client && it.prs.length) bits.push(`PR ${it.prs.map(prLink).join(" ")}`);
  return bits.join(" &nbsp;·&nbsp; ");
};
const pill = (text, cls = "", blip = false) =>
  `<span class="pill ${cls}">${blip ? '<i class="blip"></i>' : ""}${esc(text)}</span>`;
const idTag = (it) => `<span class="id">${esc(it.id)}</span>`;
const dmy = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1]}`;
};

/* =====================================================================
   figures
   ===================================================================== */

/** Two concentric arcs: items delivered, and person-weeks delivered. */
function gauge() {
  const R1 = 62;
  const R2 = 46;
  const C1 = 2 * Math.PI * R1;
  const C2 = 2 * Math.PI * R2;
  const pItems = (data.counts.done ?? 0) / data.counts.total;
  const pWeeks = pwDone / pwTotal;
  const arc = (r, c, p, token, delay) =>
    `<circle cx="76" cy="76" r="${r}" fill="none" stroke="var(--grid)" stroke-width="11" />
     <circle cx="76" cy="76" r="${r}" fill="none" stroke="var(${token})" stroke-width="11"
       stroke-linecap="butt" transform="rotate(-90 76 76)"
       stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"
       style="--len:${(c * p).toFixed(1)}; --d:${delay}s" class="arc" />`;
  return `<div class="fig reveal">
    <h3>Delivered so far</h3>
    <div class="gauge-wrap">
      <svg class="gauge" viewBox="0 0 152 152" role="img"
        aria-label="${(pItems * 100).toFixed(0)} percent of items and ${(pWeeks * 100).toFixed(0)} percent of estimated effort delivered">
        ${arc(R1, C1, pItems, "--lamp-done", 0.15)}
        ${arc(R2, C2, pWeeks, "--accent", 0.35)}
      </svg>
      <div class="gauge-read">
        <div>
          <div class="big" data-count="${(pItems * 100).toFixed(0)}" data-suffix="%">0%</div>
          <div class="lbl">of ${data.counts.total} items</div>
        </div>
        <div>
          <div class="sm" data-count="${(pWeeks * 100).toFixed(0)}" data-suffix="%">0%</div>
          <div class="lbl">of ~${Math.round(pwTotal)} person-weeks</div>
        </div>
      </div>
    </div>
    <div class="cap">Outer ring counts items; inner ring weights them by the board's own effort
      estimate, so a run of small fixes cannot flatter the picture. ${unsized} items carry no
      number and sit outside the inner ring.</div>
  </div>`;
}

/** Cumulative items delivered over time, from the commits that closed them. */
function burnup() {
  const dates = data.items
    .filter((it) => it.deliveredOn)
    .map((it) => it.deliveredOn)
    .sort();
  if (!dates.length) return "";
  const first = new Date(`${dates[0]}T00:00:00Z`).getTime();
  const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
  const span = Math.max(last - first, 86400000);
  const W = 520;
  const H = 168;
  const PAD = { l: 26, r: 12, t: 12, b: 22 };
  const maxY = Math.ceil((dates.length + 2) / 5) * 5;
  const x = (t) => PAD.l + ((t - first) / span) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);

  const pts = [];
  dates.forEach((d, i) => {
    const t = new Date(`${d}T00:00:00Z`).getTime();
    pts.push([x(t), y(i + 1)]);
  });
  // Step-after: work lands on a day, then holds until the next one.
  let line = `M ${PAD.l} ${y(0)}`;
  let prevY = y(0);
  for (const [px, py] of pts) {
    line += ` L ${px.toFixed(1)} ${prevY.toFixed(1)} L ${px.toFixed(1)} ${py.toFixed(1)}`;
    prevY = py;
  }
  const area = `${line} L ${W - PAD.r} ${prevY.toFixed(1)} L ${W - PAD.r} ${y(0)} Z`;
  line += ` L ${W - PAD.r} ${prevY.toFixed(1)}`;

  const grid = [];
  for (let v = 0; v <= maxY; v += 5) {
    grid.push(`<line x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1" />
      <text class="svg-label" x="${PAD.l - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`);
  }
  const ticks = [dates[0], dates[dates.length - 1]].map((d, i) => {
    const t = new Date(`${d}T00:00:00Z`).getTime();
    return `<text class="svg-label" x="${x(t)}" y="${H - 6}" text-anchor="${i ? "end" : "start"}">${dmy(d)}</text>`;
  });

  return `<div class="fig reveal">
    <h3>Items delivered over time</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Cumulative delivery: ${dates.length} items closed between ${dmy(dates[0])} and ${dmy(dates[dates.length - 1])}">
      ${grid.join("")}
      <g class="fade" style="--d:.9s"><path d="${area}" fill="var(--lamp-done)" opacity=".14" /></g>
      <path d="${line}" fill="none" stroke="var(--lamp-done)" stroke-width="2.2"
        stroke-linejoin="round" class="draw" style="--len:1600" />
      <g class="fade" style="--d:1.3s">
        <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${prevY.toFixed(1)}" r="9"
          fill="var(--lamp-done)" opacity=".22" class="blip" />
        <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${prevY.toFixed(1)}" r="4.5"
          fill="var(--lamp-done)" />
      </g>
      ${ticks.join("")}
    </svg>
    <div class="cap">${
      client
        ? "Each step is a day something was released. Flat stretches are days spent on items that had not yet landed."
        : "Each step is a day something closed, dated from the commit that closed it — not from the board, which records no dates. Flat stretches are days spent on items still open."
    }</div>
  </div>`;
}

/** Stacked column per wave, coloured by state. */
function waves() {
  const waveIds = [...new Set(data.items.map((i) => i.wave))].sort();
  const W = 520;
  const H = 190;
  const PAD = { l: 24, r: 10, t: 12, b: 30 };
  const cols = waveIds.map((w) => {
    const rows = data.items.filter((i) => i.wave === w);
    return { w, total: rows.length, counts: STATE_KEYS.map((s) => rows.filter((r) => r.stateKey === s.key).length) };
  });
  const maxT = Math.max(...cols.map((c) => c.total));
  const bw = (W - PAD.l - PAD.r) / cols.length;
  const barW = Math.min(bw - 14, 54);

  const bars = cols
    .map((c, ci) => {
      const cx = PAD.l + bw * ci + (bw - barW) / 2;
      let acc = 0;
      const segs = c.counts
        .map((n, si) => {
          if (!n) return "";
          const h = (n / maxT) * (H - PAD.t - PAD.b);
          const yTop = H - PAD.b - ((acc + n) / maxT) * (H - PAD.t - PAD.b);
          acc += n;
          return `<rect x="${cx.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW}" height="${h.toFixed(1)}"
            fill="var(${STATE_KEYS[si].token})" class="grow" style="--d:${(ci * 0.07).toFixed(2)}s;
            transform-origin:${(cx + barW / 2).toFixed(1)}px ${(H - PAD.b).toFixed(1)}px">
            <title>Wave ${c.w} — ${STATE_KEYS[si].label}: ${n}</title></rect>`;
        })
        .join("");
      return `${segs}
        <text class="svg-label" x="${(cx + barW / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle">WAVE ${c.w}</text>
        <text class="svg-num" x="${(cx + barW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${c.total}</text>`;
    })
    .join("");

  return `<div class="fig reveal">
    <h3>Where the work sits in the plan</h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Items per wave, split by state">
      <line x1="${PAD.l}" y1="${H - PAD.b}" x2="${W - PAD.r}" y2="${H - PAD.b}" stroke="var(--edge)" />
      ${bars}
    </svg>
    ${legend()}
    <div class="cap">Waves are execution layers, not dates — wave 0 is the enabler tier everything
      else sits on. Green concentrated at the left is the shape you want.</div>
  </div>`;
}

const legend = () =>
  `<div class="legend">${STATE_KEYS.map(
    (s) => `<span><i style="background:var(${s.token})"></i>${s.label}</span>`,
  ).join("")}</div>`;

/** Priority against state — the "are we doing the important things" view. */
function heatmap() {
  const prios = ["P0", "P1", "P2", "P3"];
  const grid = prios
    .map((p) => {
      const rows = data.items.filter((i) => i.priority === p);
      const cells = STATE_KEYS.map((s) => {
        const n = rows.filter((r) => r.stateKey === s.key).length;
        const max = Math.max(...prios.map((pp) => data.items.filter((i) => i.priority === pp && i.stateKey === s.key).length));
        // Capped at 48% and mixed with the panel, not transparent: the lamp
        // tokens invert between themes, so a stronger mix would put light text
        // on a light cell in dark mode.
        const a = n === 0 ? 0 : 10 + 26 * (n / Math.max(max, 1));
        return n === 0
          ? `<div class="cell z">0</div>`
          : `<div class="cell" style="background:color-mix(in srgb, var(${s.token}) ${a.toFixed(0)}%, var(--panel))"
               title="${p} · ${s.label}: ${n}">${n}</div>`;
      }).join("");
      return `<div class="rl">${p}</div>${cells}`;
    })
    .join("");
  return `<div class="fig reveal">
    <h3>Priority against state</h3>
    <div class="heat fade" style="grid-template-columns:26px repeat(${STATE_KEYS.length},1fr); --d:.2s">
      <div></div>${STATE_KEYS.map((s) => `<div class="hd">${s.label}</div>`).join("")}
      ${grid}
    </div>
    <div class="cap">P0 blocks the client MVP. The number that matters is P0 sitting under
      <em>Held</em> — every one of those is waiting on a decision, not on engineering.</div>
  </div>`;
}

/** The chains BACKLOG.md §1 protects, with live states read from §2. */
function paths() {
  const cls = (n) =>
    n.status === "done" ? "lamp-done" : n.gate ? "lamp-gated" : n.readyToStart ? "lamp-ready" : "lamp-idle";
  const mark = (n) => (n.status === "done" ? "✓" : n.gate ? "hold" : n.readyToStart ? "ready" : "waiting");
  return data.criticalPaths
    .map(
      (p, pi) => `<div class="path reveal">
      <div class="plabel">${esc(p.label)}</div>
      <div class="chain">${p.chain
        .map(
          (n, i) =>
            `${i ? '<span class="link" aria-hidden="true">→</span>' : ""}
             <div class="node ${cls(n)} fade" style="--d:${(pi * 0.1 + i * 0.12).toFixed(2)}s">
               <span class="nid">${esc(n.id)} <span style="opacity:.75">${esc(mark(n))}</span></span>
               <span class="nt" title="${esc(n.title)}">${esc(n.title)}</span>
             </div>`,
        )
        .join("")}</div>
    </div>`,
    )
    .join("");
}

/* =====================================================================
   sections
   ===================================================================== */

/** Build the whole page for one audience. Called twice; see `client` above. */
function render(forClient) {
  client = forClient;
  const tiles = [
    { n: data.counts.done ?? 0, k: "Delivered", h: "merged to main, ADR-backed", lamp: "lamp-done" },
    { n: data.inProgress.length, k: "In flight", h: "derived from live git branches", lamp: "lamp-active" },
    { n: readyIds.length, k: "Ready to start", h: "every dependency met, no gate", lamp: "lamp-ready" },
    { n: data.counts.gated ?? 0, k: "Eligible · held", h: "needs an ADR or a client answer", lamp: "lamp-gated" },
    { n: data.counts.blocked ?? 0, k: "Waiting", h: "upstream item not done yet", lamp: "lamp-idle" },
    { n: data.counts.total, k: "Total scope", h: "tracked items across 8 tracks", lamp: "lamp-accent" },
  ];

  const tilesHtml = tiles
    .map(
      (t, i) => `<div class="tile ${t.lamp} reveal" style="transition-delay:${(i * 0.05).toFixed(2)}s">
        <div class="n" data-count="${t.n}">0</div><div class="k">${esc(t.k)}</div><div class="h">${esc(t.h)}</div>
      </div>`,
    )
    .join("");

  const inProgressHtml = data.inProgress.length
    ? data.inProgress
        .map((p) => {
          const it = item(p.id);
          const c = p.current ? "lamp-active" : "lamp-idle";
          return `<article class="card ${c} reveal">
          <div class="card-top">${idTag(it)}${pill(
            client ? "under way" : p.current ? "current branch" : "open branch",
            c,
            p.current,
          )}
            ${it.priority === "P0" ? pill("P0", "p0") : pill(it.priority, "lamp-idle")}
            ${it.enabler ? '<span class="star" title="enabler — built serially, hands-on">★ enabler</span>' : ""}
          </div>
          <h3>${esc(it.title)}</h3>
          <div class="why">${
            client
              ? "Actively being built now."
              : `Board status is <b>${esc(it.statusLabel)}</b> — work is under way on a branch, which the board has no column for.`
          }</div>
          <div class="meta"><span>Track ${esc(it.track)}</span>${
            client
              ? `<span>${esc(it.effort)} pw</span>`
              : `<span>${esc(p.sources.join(" · "))}</span>${
                  p.lastCommit ? `<span>${esc(p.lastCommit.date)} ${esc(p.lastCommit.sha)}</span>` : ""
                }`
          }</div>
        </article>`;
        })
        .join("")
    : `<article class="card lamp-idle reveal"><h3>Nothing in flight</h3>
        <div class="why">${
          client
            ? "Nothing is part-built right now — the last item finished and the next has not started."
            : "No branch outside <code>main</code> maps to a backlog item right now."
        }</div></article>`;

  const nextHtml = readyIds
    .map((id) => item(id))
    .sort(
      (a, b) =>
        (P_ORDER[a.priority] ?? 9) - (P_ORDER[b.priority] ?? 9) ||
        (Number(a.wave) || 9) - (Number(b.wave) || 9) ||
        b.unlocks.length - a.unlocks.length,
    )
    .slice(0, 9)
    .map((it, i) => {
      const unlocks = it.unlocks.length
        ? `Unlocks ${it.unlocks.length} item${it.unlocks.length > 1 ? "s" : ""}: ${it.unlocks.slice(0, 6).join(", ")}`
        : "Unlocks nothing downstream";
      return `<article class="card lamp-ready reveal" style="transition-delay:${(i * 0.04).toFixed(2)}s">
        <div class="card-top">${idTag(it)}${it.priority === "P0" ? pill("P0", "p0") : pill(it.priority, "lamp-idle")}
          ${it.enabler ? '<span class="star" title="enabler — built serially, hands-on">★ enabler</span>' : ""}</div>
        <h3>${esc(it.title)}</h3>
        <div class="why">${esc(unlocks)}</div>
        <div class="meta"><span>Track ${esc(it.track)}</span><span>Wave ${esc(it.wave)}</span><span>${esc(it.effort)} pw</span></div>
      </article>`;
    })
    .join("");

  const gatedItems = data.items
    .filter((it) => it.gate && it.status !== "done" && it.status !== "dropped")
    .sort(
      (a, b) =>
        Number(b.dependencyClear) - Number(a.dependencyClear) ||
        (P_ORDER[a.priority] ?? 9) - (P_ORDER[b.priority] ?? 9),
    );

  const gatedHtml = gatedItems
    .map(
      (it, i) => `<article class="card lamp-gated reveal" style="transition-delay:${(i * 0.03).toFixed(2)}s">
        <div class="card-top">${idTag(it)}
          ${pill(it.gate.kind === "client" ? "awaiting client" : "needs an ADR", "lamp-gated")}
          ${it.priority === "P0" ? pill("P0", "p0") : pill(it.priority, "lamp-idle")}
          ${it.dependencyClear ? "" : pill("also waiting on deps", "lamp-idle")}</div>
        <h3>${esc(it.title)}</h3>
        <div class="gate-why">${esc(client ? it.gate.clientReason : it.gate.reason)}${
          client ? "" : `<div class="gate-src">${esc(it.gate.source)}</div>`
        }</div>
      </article>`,
    )
    .join("");

  const doneHtml = data.items
    .filter((it) => it.status === "done")
    .sort((a, b) => String(b.deliveredOn).localeCompare(String(a.deliveredOn)) || a.id.localeCompare(b.id))
    .map(
      (it, i) => `<article class="card lamp-done reveal" style="transition-delay:${(i * 0.025).toFixed(2)}s">
        <div class="card-top">${idTag(it)}${it.deliveredOn ? pill(dmy(it.deliveredOn), "lamp-done") : ""}
          ${it.enabler ? '<span class="star">★ enabler</span>' : ""}</div>
        <h3>${esc(it.title)}</h3>
        ${refs(it) ? `<div class="meta">${refs(it)}</div>` : ""}
      </article>`,
    )
    .join("");

  const trackRows = data.tracks
    .map((t, ti) => {
      const rows = data.items.filter((i) => i.track === t.id);
      const pwLeft = rows.filter((r) => r.status !== "done").reduce((a, r) => a + pwOf(r), 0);
      const segs = STATE_KEYS.map(
        (s) => {
          const n = rows.filter((r) => r.stateKey === s.key).length;
          return n
            ? `<i style="width:${((n / t.total) * 100).toFixed(1)}%; background:var(${s.token})"
                 class="wipe" title="${s.label}: ${n}"></i>`
            : "";
        },
      ).join("");
      return `<div class="trow reveal" style="transition-delay:${(ti * 0.04).toFixed(2)}s">
        <div class="tname"><b>${esc(t.id)}</b>${esc(t.name)}</div>
        <div class="sbar" role="img" aria-label="${esc(t.id)}: ${t.done} of ${t.total} done">${segs}</div>
        <div class="tnum">${t.done}/${t.total} done · ~${Math.round(pwLeft)} pw left</div>
      </div>`;
    })
    .join("");

  const DETAIL_CAP = 700;
  const boardRows = data.items
    .slice()
    .sort(
      (a, b) =>
        a.track.localeCompare(b.track) ||
        (P_ORDER[a.priority] ?? 9) - (P_ORDER[b.priority] ?? 9) ||
        a.id.localeCompare(b.id, undefined, { numeric: true }),
    )
    .map((it, idx) => {
      const st = stateOf(it);
      const long = it.detail.length > DETAIL_CAP;
      const short = long ? `${it.detail.slice(0, DETAIL_CAP).replace(/\s\S*$/, "")}…` : it.detail;
      return `<tr class="item" data-track="${esc(it.track)}" data-state="${esc(st.label)}" data-p="${esc(it.priority)}"
          data-search="${esc(`${it.id} ${it.title} ${it.track} ${st.label} ${it.priority}`.toLowerCase())}">
        <td class="c-id">${idTag(it)}</td>
        <td>${pill(st.label, st.cls, st.key === "flight")}</td>
        <td><button type="button" class="row-btn" data-target="d${idx}" aria-expanded="false">${esc(it.title)}</button>
          ${it.enabler ? ' <span class="star">★</span>' : ""}</td>
        <td class="c-num">${esc(it.priority)}</td>
        <td class="c-num">W${esc(it.wave)}</td>
        <td class="c-num">${esc(it.effort)}</td>
        <td class="c-num">${it.depends.length ? esc(it.depends.join(", ")) : "—"}</td>
      </tr>
      <tr class="detail hidden" id="d${idx}" data-detail="1">
        <td colspan="7">${
          // The raw board prose is engineering narrative — rulebook sections,
          // commit numbers, internal argument. The client cut shows the
          // structured facts instead, which is what a reader outside the team
          // can actually use.
          client
            ? ""
            : `<div class="d-body">${esc(short)}${
                long ? ` <em>(full record in docs/BACKLOG.md line ${it.line})</em>` : ""
              }</div>`
        }
          <dl>
            <dt>Board status</dt><dd>${esc(it.glyph)} ${esc(it.statusLabel)}</dd>
            ${it.deliveredOn ? `<dt>Closed</dt><dd>${esc(dmy(it.deliveredOn))} ${esc(it.deliveredOn.slice(0, 4))}</dd>` : ""}
            <dt>Depends</dt><dd>${esc(it.dependsRaw || "—")}${
              it.unmetDepends.length ? ` — not yet done: ${esc(it.unmetDepends.join(", "))}` : ""
            }</dd>
            <dt>Unlocks</dt><dd>${it.unlocks.length ? esc(it.unlocks.join(", ")) : "—"}</dd>
            ${refs(it) ? `<dt>Refs</dt><dd>${refs(it)}</dd>` : ""}
            ${it.gate ? `<dt>Held for</dt><dd>${esc(client ? it.gate.clientReason : it.gate.reason)}</dd>` : ""}
          </dl>
        </td>
      </tr>`;
    })
    .join("");

  const trackChips = data.tracks
    .map((t) => `<button type="button" class="chip" data-filter="track" data-value="${esc(t.id)}" aria-pressed="false">${esc(t.id)}</button>`)
    .join("");
  const stateChips = ["In flight", "Ready", "Needs ADR", "Awaiting client", "Planned", "Waiting", "Done"]
    .map((s) => `<button type="button" class="chip" data-filter="state" data-value="${esc(s)}" aria-pressed="false">${esc(s)}</button>`)
    .join("");

  const activityHtml = data.activity
    .slice(0, 14)
    .map(
      (c, i) =>
        `<div class="reveal" style="transition-delay:${(i * 0.02).toFixed(2)}s"><span class="sha">${esc(c.sha)}</span><span class="d">${esc(c.date)}</span><span class="s">${esc(
          c.subject,
        ).replace(/\b([FE]\d+\.\d+)\b/g, "<b>$1</b>")}</span></div>`,
    )
    .join("");

  const dirtyNote = data.repo.dirty.length
    ? `${data.repo.dirty.length} uncommitted file${data.repo.dirty.length > 1 ? "s" : ""}, so the page may run slightly ahead of what is committed.`
    : "";

  return `<title>TRINETRA Build Board</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${CSS}</style>
  <div class="wrap">

    <header class="mast">
      <div class="mast-top">
        <div class="mast-id">
          <div class="eyebrow">TRINETRA · Enterprise EMS · Ion Exchange (India) Ltd.</div>
          <h1>Build status</h1>
          <div class="sub">Delivery state of the managed backlog — what has shipped, what is being
            built right now, what can start next, and what is eligible but held.${
              client
                ? " Generated directly from the delivery team's working plan."
                : " Generated from <code>docs/BACKLOG.md</code> and the repository's own git history."
            }</div>
        </div>
        <div class="stamp">
          <span class="live"><i class="dot blip"></i>Data as of</span>
          <span><b>${esc(data.generatedAtIST)}</b></span>
          ${
            client
              ? `<span>plan last revised ${esc(data.source.date)} IST</span>`
              : `<span>branch <b>${esc(data.repo.branch)}</b></span>
          <span>head <b>${esc(data.repo.head)}</b> · ${esc(data.repo.headDate)} IST</span>
          <span>backlog edited ${esc(data.source.date)} IST</span>`
          }
        </div>
      </div>

      <div class="explain">
        <h2>Where these numbers come from</h2>
        <ol>
          <li><span class="step">1</span><span>The delivery team works to a single written plan.
            Every task, its status and what it waits on live in that one place.</span></li>
          <li><span class="step">2</span><span>A short script reads the plan plus the project's
            release history and works out what is done, running, ready and held.</span></li>
          ${
            client
              ? `<li><span class="step">3</span><span>This report is generated from that. Nothing on
            it is typed in by hand, so it cannot drift from what the team is actually doing.</span></li>
          <li><span class="step">4</span><span>It is a <em>snapshot</em>, taken at the time in the
            top-right. Ask for a fresh one whenever you want the current position.</span></li>`
              : `<li><span class="step">3</span><span>The page is rebuilt from that and re-published to
            <em>this same web address</em>. The link you have never changes.</span></li>
          <li><span class="step">4</span><span>So it behaves like a report that gets reprinted, not
            a screen that ticks. Leaving it open will not change the numbers — reload it.</span></li>`
          }
        </ol>
        <div class="tail"><b>How to tell if you are looking at something stale:</b> the “Data as of”
          time in the top-right is the moment ${
            client ? "this report was generated" : "the page was last rebuilt"
          }, in IST. If that is from today, so are the numbers. Every other time here is IST too.</div>
      </div>
    </header>

    <div class="rail">${tilesHtml}</div>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>The picture at a glance</h2></div>
        <p>Three readings of the same board: how much is finished, how fast it has been finishing,
          and where the remaining work sits in the plan.</p></div>
      <div class="figs">${gauge()}${burnup()}</div>
      <div class="figs-2">${waves()}${heatmap()}</div>
    </section>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>Critical path</h2></div>
        <p>The chains the plan protects. Everything downstream of a held link waits with it.</p></div>
      <div class="paths">${paths()}</div>
    </section>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>In flight now</h2><span class="count">${data.inProgress.length} item${data.inProgress.length === 1 ? "" : "s"}</span></div>
        <p>${
          client
            ? "Work the team has actively started but not yet completed."
            : "The board has no “in progress” status in use, so this is derived from git: branches not yet merged into <code>main</code> whose names map to a backlog id."
        }</p></div>
      <div class="cards">${inProgressHtml}</div>
    </section>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>Ready to start next</h2><span class="count">${readyIds.length} eligible · top ${Math.min(9, readyIds.length)} shown</span></div>
        <p>${
          client
            ? "Everything each of these depends on is finished, and no decision is outstanding against it — the team can pick any of them up today. Ranked by priority, then by how much each one unlocks."
            : "Every entry in the item's <code>Depends</code> column is done, and nothing in AGENTS.md §6 or the client thread is outstanding against it. Ranked by priority, then wave, then how much each one unlocks. One standing caveat this list cannot compute: any item that introduces a new library still needs a §9.4 dependency ADR before code is written."
        }</p></div>
      <div class="cards">${nextHtml}</div>
    </section>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>Eligible, but held</h2><span class="count">${gatedItems.length} item${gatedItems.length === 1 ? "" : "s"}</span></div>
        <p><b>These cannot start yet.</b> The engineering they depend on is finished — what is
          outstanding is a decision. ${
            client
              ? "Each card says which decision, so it is clear where a nudge would move the schedule."
              : "Each one cites where the constraint is written down."
          }</p></div>
      <div class="cards">${gatedHtml}</div>
    </section>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>Progress by track</h2></div>
        <p>Each track is a swim-lane one person or agent can own end to end. Person-weeks remaining
          are planning-grade estimates from the team's own plan.</p></div>
      <div class="tracks">${trackRows}</div>
      ${legend()}
    </section>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>Delivered</h2><span class="count">${data.counts.done ?? 0} item${(data.counts.done ?? 0) === 1 ? "" : "s"}</span></div>
        <p>${
          client
            ? "Built, reviewed and released, most recent first, each with the architecture decision record behind it."
            : "Merged to <code>main</code>, most recent first, each with its architecture decision record and pull request."
        }</p></div>
      <div class="cards">${doneHtml}</div>
    </section>

    <section>
      <div class="sec-head"><div class="sec-title"><h2>The full board</h2><span class="count">${data.counts.total} items</span></div>
        <p>Filter by track or state, or search. Select a title to read the item's record.</p></div>
      <div class="controls">
        <input type="search" id="q" placeholder="Search id or title…" aria-label="Search the board" />
        ${trackChips}${stateChips}
        <button type="button" class="chip" id="clear">Clear</button>
      </div>
      <div class="board">
        <table>
          <thead><tr><th>ID</th><th>State</th><th>Item</th><th>P</th><th>Wave</th><th>PW</th><th>Depends</th></tr></thead>
          <tbody id="tbody">${boardRows}</tbody>
        </table>
        <div class="empty hidden" id="empty">Nothing matches those filters.</div>
      </div>
    </section>

    ${
      client
        ? ""
        : `<section>
      <div class="sec-head"><div class="sec-title"><h2>Recent activity</h2><span class="count">last ${Math.min(14, data.activity.length)} commits · IST</span></div></div>
      <div class="log">${activityHtml}</div>
    </section>`
    }

    <footer>
      ${
        client
          ? `<div>Every figure on this page is generated from the delivery team's working plan and
        release history — nothing here is hand-entered, and nothing is rounded in its favour.
        Items shown as <em>held</em> are held on a decision, not on engineering capacity.</div>`
          : `<div>Source of truth: <code>docs/BACKLOG.md</code> §2. Statuses in §1's wave plan are narrative
        and are deliberately not read by this page. Eligibility is computed on whole-token
        <code>Depends</code> matches — a prefix match once reported <code>E7.2</code> as unblocked by
        <code>F1.1</code> when it actually needs <code>F1.10</code>.</div>
      ${dirtyNote ? `<div>Working tree at generation time: ${esc(dirtyNote)}</div>` : ""}
      ${data.warnings.length ? `<div class="warn">Parser notes: ${esc(data.warnings.join(" · "))}</div>` : ""}`
      }
      ${
        client
          ? "<div>Prepared by Euphoria Infotech India Limited for Ion Exchange (India) Ltd.</div>"
          : "<div>Regenerate with <code>node docs/scripts/backlog-status.mjs &amp;&amp; node docs/scripts/backlog-dashboard.mjs</code>, then republish.</div>"
      }
    </footer>
  </div>

  <script>
  (function () {
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Reveal on scroll. Without IntersectionObserver everything shows at once. */
    var targets = document.querySelectorAll(".reveal");
    if (reduce || !("IntersectionObserver" in window)) {
      for (var i = 0; i < targets.length; i++) targets[i].classList.add("in");
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          io.unobserve(e.target);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
      for (var j = 0; j < targets.length; j++) io.observe(targets[j]);
    }

    /* Count up the headline numbers once their tile is revealed. */
    function countUp(el) {
      var end = Number(el.dataset.count) || 0;
      var suffix = el.dataset.suffix || "";
      if (reduce || end === 0) { el.textContent = end + suffix; return; }
      var dur = 850, t0 = null;
      function frame(t) {
        if (t0 === null) t0 = t;
        var p = Math.min((t - t0) / dur, 1);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + suffix;
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    var nums = document.querySelectorAll("[data-count]");
    if (reduce || !("IntersectionObserver" in window)) {
      for (var k = 0; k < nums.length; k++) countUp(nums[k]);
    } else {
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          countUp(e.target);
          io2.unobserve(e.target);
        });
      }, { threshold: 0.5 });
      for (var m = 0; m < nums.length; m++) io2.observe(nums[m]);
    }

    /* Board filtering + row detail. */
    var tbody = document.getElementById("tbody");
    var q = document.getElementById("q");
    var empty = document.getElementById("empty");
    var filters = { track: null, state: null };

    tbody.addEventListener("click", function (e) {
      var btn = e.target.closest(".row-btn");
      if (!btn) return;
      var row = document.getElementById(btn.dataset.target);
      var open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      row.classList.toggle("hidden", open);
      row.dataset.open = open ? "" : "1";
    });

    function apply() {
      var term = q.value.trim().toLowerCase();
      var rows = tbody.querySelectorAll("tr.item");
      var shown = 0;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var ok =
          (!filters.track || r.dataset.track === filters.track) &&
          (!filters.state || r.dataset.state === filters.state) &&
          (!term || r.dataset.search.indexOf(term) !== -1);
        if (ok) shown++;
        r.classList.toggle("hidden", !ok);
        var d = r.nextElementSibling;
        if (d && d.dataset.detail) d.classList.toggle("hidden", !ok || !d.dataset.open);
      }
      empty.classList.toggle("hidden", shown > 0);
    }

    document.querySelectorAll(".chip[data-filter]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var kind = chip.dataset.filter;
        var on = filters[kind] === chip.dataset.value;
        filters[kind] = on ? null : chip.dataset.value;
        document.querySelectorAll('.chip[data-filter="' + kind + '"]').forEach(function (c) {
          c.setAttribute("aria-pressed", String(!on && c === chip));
        });
        apply();
      });
    });

    document.getElementById("clear").addEventListener("click", function () {
      filters = { track: null, state: null };
      q.value = "";
      document.querySelectorAll(".chip[data-filter]").forEach(function (c) {
        c.setAttribute("aria-pressed", "false");
      });
      apply();
    });

    q.addEventListener("input", apply);
  })();
  </script>
  `;
}


// The verdict compares against the last fingerprint we know was PUBLISHED, not
// the last one written to disk. Those differ whenever a run regenerates but the
// publish does not happen — a failed publish, a leak check that fails, an
// interrupted session. Keying off the file on disk made the *next* run report
// UNCHANGED and leave the artifact stale, which is the one failure this whole
// mechanism exists to prevent. So the marker is advanced only by an explicit:
//
//     node docs/scripts/backlog-dashboard.mjs --mark-published
//
// run after the Artifact publish actually succeeds.
const MARKER = join(repoRoot, "docs", "status", ".published-fingerprint");
const published = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : null;

if (process.argv.includes("--mark-published")) {
  writeFileSync(MARKER, `${data.fingerprint}\n`);
  console.log(`marked ${data.fingerprint} as published`);
  process.exit(0);
}

const changed = published !== data.fingerprint;

/** Wrap a page fragment in a real document, for files opened outside claude.ai. */
const standalone = (fragment) => {
  const split = fragment.indexOf('<div class="wrap">');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
${fragment.slice(0, split)}
</head>
<body>
${fragment.slice(split)}
</body>
</html>
`;
};

const internal = `<!-- fingerprint: ${data.fingerprint} -->\n${render(false)}`;
const forClient = `<!-- fingerprint: ${data.fingerprint} -->\n${render(true)}`;

writeFileSync(OUT, internal);
writeFileSync(OUT_FILE, standalone(internal));
writeFileSync(OUT_CLIENT, standalone(forClient));

// Fail loudly rather than shipping a client file that names the repository.
// This is the whole point of the variant, so it is checked, not assumed.
const LEAKS = [
  [/github\.com/i, "GitHub link"],
  [/BACKLOG\.md|AGENTS\.md|e5\.1-client-questions/i, "internal file path"],
  [/\bbranch\b|\brefs\/|\bcommit\b|\bpull request\b/i, "branch or commit reference"],
  // "SOW §4" is the client's own statement of work — theirs to read, not a leak.
  [/(?<!SOW )§\d/, "internal rulebook section reference"],
];
const found = LEAKS.filter(([re]) => re.test(forClient)).map(([, what]) => what);
if (found.length) {
  console.error(`client variant still contains: ${found.join(", ")}`);
  process.exitCode = 1;
}

console.log(`wrote ${OUT} (${(internal.length / 1024).toFixed(0)} KB, artifact fragment)`);
console.log(`wrote ${OUT_FILE} (standalone, internal)`);
console.log(`wrote ${OUT_CLIENT} (standalone, client-facing${found.length ? " — LEAK CHECK FAILED" : ", leak check passed"})`);
console.log(
  `  ${data.counts.done ?? 0} done · ${data.inProgress.length} in flight · ${readyIds.length} ready · ` +
    `${data.items.filter((i) => i.gate && i.status !== "done" && i.status !== "dropped").length} held · ` +
    `generated ${data.generatedAtIST}`,
);
console.log(
  changed
    ? `CHANGED ${published ?? "(never published)"} -> ${data.fingerprint} — republish the artifact, ` +
      `then run this script again with --mark-published`
    : `UNCHANGED ${data.fingerprint} — nothing a reader would notice moved; skip the republish`,
);

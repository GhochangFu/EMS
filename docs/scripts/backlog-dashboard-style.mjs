// Stylesheet for the build-status dashboard, split out of
// backlog-dashboard.mjs to keep both files under the AGENTS.md §4.5 1000-line
// cap. The cap does not currently walk docs/scripts/, but the invariant test
// notes that nothing here is close to it — that stays true by construction
// rather than by luck.
//
// One palette, three theme states: bare :root is the complete light set, the
// prefers-color-scheme block is guarded so an explicit light choice wins, and
// the [data-theme="dark"] block lets the toggle win the other way. No colour
// is ever declared only inside a media or [data-theme] block.

export const CSS = `
/* Annunciator panel: cool slate paper, copper signal accent, lamp colours for
   state kept separate from the accent hue. Light is the base palette; the two
   dark blocks below redefine tokens only. */
:root{
  color-scheme: light dark;
  --paper:#EDEEEA; --panel:#FBFBF9; --panel-2:#F4F5F1;
  --edge:#D5D7CE; --edge-soft:#E3E5DD;
  --ink:#191D19; --ink-2:#4B534B; --ink-3:#7A827A;
  --accent:#B45309; --accent-ink:#8A3E06; --accent-wash:#F6E9DA;
  --lamp-done:#3F6B4A; --lamp-done-wash:#E2EBE1;
  --lamp-active:#1D5B84; --lamp-active-wash:#DDE9F1;
  --lamp-ready:#7A6A16; --lamp-ready-wash:#EFEBD6;
  --lamp-gated:#9A3D22; --lamp-gated-wash:#F3E1DA;
  --lamp-idle:#6B736B; --lamp-idle-wash:#E7E9E4;
  --grid:#DCDED5;
  --shadow:0 1px 0 rgba(25,29,25,.05), 0 1px 3px rgba(25,29,25,.06);
  --mono:ui-monospace,"SFMono-Regular","Cascadia Mono","Consolas","Liberation Mono",monospace;
  --sans:"Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#14171A; --panel:#1B1F23; --panel-2:#20252A;
    --edge:#2E353B; --edge-soft:#262C31;
    --ink:#E8EAE6; --ink-2:#A8B0AC; --ink-3:#7C8580;
    --accent:#E08A3C; --accent-ink:#F0A863; --accent-wash:#2E2318;
    --lamp-done:#79B189; --lamp-done-wash:#1D2A21;
    --lamp-active:#6FAFD8; --lamp-active-wash:#17242E;
    --lamp-ready:#CFBB63; --lamp-ready-wash:#282415;
    --lamp-gated:#E0876A; --lamp-gated-wash:#2E1E18;
    --lamp-idle:#8B938E; --lamp-idle-wash:#22262A;
    --grid:#2A3137;
    --shadow:0 1px 0 rgba(0,0,0,.3), 0 1px 3px rgba(0,0,0,.35);
  }
}
:root[data-theme="dark"]{
  --paper:#14171A; --panel:#1B1F23; --panel-2:#20252A;
  --edge:#2E353B; --edge-soft:#262C31;
  --ink:#E8EAE6; --ink-2:#A8B0AC; --ink-3:#7C8580;
  --accent:#E08A3C; --accent-ink:#F0A863; --accent-wash:#2E2318;
  --lamp-done:#79B189; --lamp-done-wash:#1D2A21;
  --lamp-active:#6FAFD8; --lamp-active-wash:#17242E;
  --lamp-ready:#CFBB63; --lamp-ready-wash:#282415;
  --lamp-gated:#E0876A; --lamp-gated-wash:#2E1E18;
  --lamp-idle:#8B938E; --lamp-idle-wash:#22262A;
  --grid:#2A3137;
  --shadow:0 1px 0 rgba(0,0,0,.3), 0 1px 3px rgba(0,0,0,.35);
}

*{box-sizing:border-box}
body{margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--sans); font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased}
.wrap{max-width:1180px; margin:0 auto; padding:28px 22px 72px; display:flex; flex-direction:column; gap:30px}
h1,h2,h3{margin:0; text-wrap:balance; letter-spacing:-.015em}
a{color:var(--accent-ink)}

/* ---------- motion ---------- */
.reveal{opacity:0; transform:translateY(14px)}
.reveal.in{opacity:1; transform:none; transition:opacity .5s ease, transform .55s cubic-bezier(.22,.7,.3,1)}
.draw{stroke-dasharray:var(--len); stroke-dashoffset:var(--len)}
.in .draw{stroke-dashoffset:0; transition:stroke-dashoffset 1.5s cubic-bezier(.3,.8,.3,1) .15s}
/* Arcs keep their own stroke-dasharray attribute (dash + gap), so they animate
   dashoffset ONLY — .draw would flatten that pair into one repeating dash. */
.arc{stroke-dashoffset:var(--len)}
.in .arc{stroke-dashoffset:0; transition:stroke-dashoffset 1.3s cubic-bezier(.3,.85,.3,1) var(--d,.15s)}
.grow{transform:scaleY(0); transform-origin:bottom}
.in .grow{transform:none; transition:transform .8s cubic-bezier(.22,.9,.3,1) var(--d,0s)}
.wipe{transform:scaleX(0); transform-origin:left}
.in .wipe{transform:none; transition:transform .9s cubic-bezier(.22,.9,.3,1) var(--d,0s)}
/* .fade drives opacity to 1, so it must never wrap an element that carries its
   own partial opacity — put it on a <g> and keep the opacity on the child. */
.fade{opacity:0}
.in .fade{opacity:1; transition:opacity .6s ease var(--d,.5s)}
@keyframes blip{0%,100%{opacity:1; transform:scale(1)} 50%{opacity:.35; transform:scale(.72)}}
/* transform-box is what keeps this centred on an SVG circle — without it the
   scale resolves against the SVG viewport origin and the dot drifts off-mark. */
.blip{animation:blip 1.9s ease-in-out infinite; transform-box:fill-box; transform-origin:center}
@media (prefers-reduced-motion:reduce){
  .reveal,.reveal.in{opacity:1; transform:none; transition:none}
  .draw,.in .draw{stroke-dashoffset:0; transition:none}
  .grow,.in .grow,.wipe,.in .wipe{transform:none; transition:none}
  .fade,.in .fade{opacity:1; transition:none}
  .blip{animation:none}
  html{scroll-behavior:auto}
}

/* ---------- masthead ---------- */
.mast{border:1px solid var(--edge); background:var(--panel); border-radius:3px;
  box-shadow:var(--shadow); overflow:hidden}
.mast-top{display:flex; flex-wrap:wrap; gap:18px; align-items:flex-end; justify-content:space-between;
  padding:22px 24px 18px; border-bottom:1px solid var(--edge-soft)}
.mast-id{flex:1 1 340px; min-width:0}
.eyebrow{font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--accent-ink); margin-bottom:6px}
.mast h1{font-size:clamp(24px,3.4vw,34px); font-weight:800}
.mast .sub{color:var(--ink-2); font-size:14px; margin-top:6px; max-width:62ch}
.stamp{font-family:var(--mono); font-size:11.5px; color:var(--ink-2); text-align:right;
  display:flex; flex-direction:column; gap:3px; align-items:flex-end;
  max-width:100%; min-width:0; overflow-wrap:anywhere}
.stamp b{color:var(--ink); font-weight:600}
.stamp .live{display:flex; align-items:center; gap:6px; color:var(--accent-ink)}
.theme{display:flex; gap:0; margin-top:7px; border:1px solid var(--edge); border-radius:2px; overflow:hidden}
.theme button{font-family:var(--mono); font-size:10px; letter-spacing:.08em; text-transform:uppercase;
  padding:4px 9px; border:0; border-left:1px solid var(--edge); background:var(--panel);
  color:var(--ink-3); cursor:pointer; transition:background .15s ease, color .15s ease}
.theme button:first-child{border-left:0}
.theme button:hover{color:var(--accent-ink)}
.theme button[aria-pressed="true"]{background:var(--accent); color:var(--paper)}
.theme button:focus-visible{outline:2px solid var(--accent); outline-offset:-2px}
.stamp .dot{width:7px; height:7px; border-radius:50%; background:var(--accent); flex:none}

/* ---------- refresh explainer ---------- */
.explain{background:var(--accent-wash); border-top:1px solid var(--edge-soft); padding:16px 24px 18px}
.explain h2{font-size:13px; letter-spacing:.02em; color:var(--accent-ink); font-weight:750; margin-bottom:9px}
.explain ol{margin:0; padding:0; list-style:none; display:grid;
  grid-template-columns:repeat(auto-fit,minmax(215px,1fr)); gap:12px}
.explain li{display:flex; gap:10px; font-size:12.5px; color:var(--accent-ink); line-height:1.45}
.explain .step{font-family:var(--mono); font-weight:700; font-size:11px; flex:none;
  width:19px; height:19px; border-radius:50%; border:1px solid currentColor;
  display:grid; place-items:center; margin-top:1px}
.explain .tail{margin-top:11px; font-size:12.5px; color:var(--accent-ink); opacity:.85; max-width:88ch}

/* ---------- stat rail ---------- */
.rail{display:grid; grid-template-columns:repeat(auto-fit,minmax(148px,1fr)); gap:10px}
.tile{background:var(--panel); border:1px solid var(--edge); border-radius:3px;
  padding:14px 15px 13px; box-shadow:var(--shadow); border-top:3px solid var(--lamp)}
.tile .n{font-family:var(--mono); font-size:30px; font-weight:700; line-height:1; color:var(--ink);
  font-variant-numeric:tabular-nums}
.tile .k{font-family:var(--mono); font-size:10.5px; letter-spacing:.12em; text-transform:uppercase;
  color:var(--ink-2); margin-top:8px}
.tile .h{font-size:12px; color:var(--ink-3); margin-top:5px; line-height:1.35}

/* ---------- sections ---------- */
section{display:flex; flex-direction:column; gap:12px}
.sec-head{display:flex; flex-direction:column; gap:5px}
.sec-title{display:flex; align-items:baseline; gap:12px; flex-wrap:wrap}
.sec-head h2{font-size:19px; font-weight:750}
.sec-head .count{font-family:var(--mono); font-size:12px; color:var(--ink-3)}
.sec-head p{margin:0; font-size:13px; color:var(--ink-2); max-width:76ch}

/* ---------- figure panels ---------- */
.figs{display:grid; grid-template-columns:minmax(250px,.85fr) minmax(300px,1.4fr); gap:10px}
.figs-2{display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:10px}
.fig{background:var(--panel); border:1px solid var(--edge); border-radius:3px; box-shadow:var(--shadow);
  padding:15px 17px 14px; display:flex; flex-direction:column; gap:10px; min-width:0}
.fig h3{font-size:12.5px; font-weight:700; letter-spacing:.02em}
.fig .cap{font-size:11.5px; color:var(--ink-3); line-height:1.4}
.fig svg{display:block; width:100%; height:auto; overflow:visible}
.fig .legend{display:flex; flex-wrap:wrap; gap:5px 14px; font-family:var(--mono); font-size:10.5px; color:var(--ink-2)}
.fig .legend span{display:flex; align-items:center; gap:5px}
.fig .legend i{width:9px; height:9px; border-radius:2px; display:block}
.svg-label{font-family:var(--mono); font-size:9.5px; fill:var(--ink-3)}
.svg-num{font-family:var(--mono); font-size:10px; fill:var(--ink-2)}

/* gauge */
.gauge-wrap{display:flex; align-items:center; gap:16px; flex-wrap:wrap}
.gauge{flex:0 0 152px; max-width:152px}
.gauge-read{display:flex; flex-direction:column; gap:9px; min-width:0}
.gauge-read .big{font-family:var(--mono); font-size:29px; font-weight:700; line-height:1;
  color:var(--lamp-done); font-variant-numeric:tabular-nums}
.gauge-read .lbl{font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3)}
.gauge-read .sm{font-family:var(--mono); font-size:16px; font-weight:700; color:var(--accent-ink)}

/* heatmap */
.heat{display:grid; gap:3px; font-family:var(--mono)}
.heat .hd{font-size:9.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3);
  text-align:center; padding-bottom:2px; overflow:hidden; text-overflow:ellipsis}
.heat .rl{font-size:11px; font-weight:700; color:var(--ink-2); display:flex; align-items:center}
.heat .cell{aspect-ratio:2.1/1; display:grid; place-items:center; border-radius:2px;
  font-size:13px; font-weight:700; border:1px solid var(--edge-soft); color:var(--ink)}
.heat .cell.z{color:var(--ink-3); background:var(--panel-2)}

/* swimlanes */
.lanes-scroll{overflow-x:auto}
.lanes{display:grid; gap:2px; min-width:600px}
.lane-hd{font-family:var(--mono); font-size:9.5px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-3); padding:0 0 4px 7px}
.lane-name{display:flex; align-items:baseline; gap:7px; font-size:12px; color:var(--ink-2);
  padding:7px 10px 7px 0; border-top:1px solid var(--edge-soft); min-width:0}
.lane-name b{font-family:var(--mono); color:var(--accent-ink); flex:none}
.lane-name span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
/* Uniform, not striped: the grid is 7 columns wide, so nth-child parity
   alternates *within* a row and flips between rows — a checkerboard, which
   reads as meaning something it does not. */
.lane-cell{display:flex; flex-wrap:wrap; align-content:flex-start; gap:3px;
  padding:7px; border-top:1px solid var(--edge-soft); background:var(--panel-2); border-radius:2px}
.chip-i{display:block; width:11px; height:11px; border-radius:2px; background:var(--lamp);
  border:1px solid color-mix(in srgb, var(--lamp) 55%, var(--panel))}
.chip-i.p0i{box-shadow:0 0 0 1.5px var(--panel), 0 0 0 2.5px var(--lamp)}
.lane-none{color:var(--ink-3); font-size:11px; line-height:11px; opacity:.5}

/* critical path */
.paths{display:flex; flex-direction:column; gap:9px}
.path{background:var(--panel); border:1px solid var(--edge); border-radius:3px; box-shadow:var(--shadow);
  padding:12px 15px; display:flex; flex-direction:column; gap:9px}
.path .plabel{font-size:12.5px; color:var(--ink-2); font-weight:600}
.chain{display:flex; align-items:stretch; gap:0; flex-wrap:wrap}
.node{display:flex; flex-direction:column; gap:3px; padding:8px 12px; border-radius:3px;
  border:1px solid var(--lamp); background:var(--lamp-wash); min-width:0; flex:0 1 auto}
.node .nid{font-family:var(--mono); font-size:11.5px; font-weight:700; color:var(--lamp)}
.node .nt{font-size:11.5px; color:var(--ink-2); max-width:26ch; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.link{display:flex; align-items:center; padding:0 7px; color:var(--ink-3); font-size:15px}

/* ---------- cards ---------- */
.cards{display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:10px}
.card{background:var(--panel); border:1px solid var(--edge); border-radius:3px;
  padding:13px 15px; box-shadow:var(--shadow); border-left:3px solid var(--lamp);
  display:flex; flex-direction:column; gap:7px}
.card-top{display:flex; align-items:center; gap:9px; flex-wrap:wrap}
.card h3{font-size:14.5px; font-weight:650; line-height:1.35}
.card .why{font-size:12.5px; color:var(--ink-2)}
.card .meta{font-family:var(--mono); font-size:11px; color:var(--ink-3); display:flex; gap:12px; flex-wrap:wrap}

.id{font-family:var(--mono); font-weight:700; font-size:12.5px; letter-spacing:.02em;
  background:var(--panel-2); border:1px solid var(--edge); border-radius:2px; padding:1px 6px}
.pill{font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase;
  font-weight:700; padding:2px 7px; border-radius:2px; white-space:nowrap;
  color:var(--lamp); background:var(--lamp-wash); border:1px solid currentColor}
.pill .blip{display:inline-block; width:6px; height:6px; border-radius:50%;
  background:currentColor; margin-right:5px; vertical-align:middle}
.p0{color:var(--accent-ink); background:var(--accent-wash)}
.star{color:var(--accent-ink); font-size:12px}

.lamp-done{--lamp:var(--lamp-done); --lamp-wash:var(--lamp-done-wash)}
.lamp-active{--lamp:var(--lamp-active); --lamp-wash:var(--lamp-active-wash)}
.lamp-ready{--lamp:var(--lamp-ready); --lamp-wash:var(--lamp-ready-wash)}
.lamp-gated{--lamp:var(--lamp-gated); --lamp-wash:var(--lamp-gated-wash)}
.lamp-idle{--lamp:var(--lamp-idle); --lamp-wash:var(--lamp-idle-wash)}
.lamp-accent{--lamp:var(--accent); --lamp-wash:var(--accent-wash)}

.gate-why{font-size:12.5px; color:var(--ink-2); background:var(--panel-2);
  border-left:2px solid var(--lamp-gated); padding:7px 10px; border-radius:0 2px 2px 0}
.gate-src{font-family:var(--mono); font-size:10.5px; color:var(--ink-3); margin-top:5px}

/* ---------- track rows ---------- */
.tracks{background:var(--panel); border:1px solid var(--edge); border-radius:3px;
  box-shadow:var(--shadow); padding:6px 4px}
.trow{display:grid; grid-template-columns:minmax(190px,1.4fr) 3fr minmax(132px,auto);
  gap:14px; align-items:center; padding:9px 16px; border-bottom:1px solid var(--edge-soft)}
.trow:last-child{border-bottom:0}
.trow .tname{font-size:13.5px}
.trow .tname b{font-family:var(--mono); color:var(--accent-ink); margin-right:7px}
.sbar{height:9px; background:var(--panel-2); border:1px solid var(--edge-soft); border-radius:2px;
  overflow:hidden; display:flex}
.sbar i{display:block; height:100%; transform-origin:left}
.trow .tnum{font-family:var(--mono); font-size:11.5px; color:var(--ink-2); text-align:right;
  font-variant-numeric:tabular-nums}

/* ---------- board table ---------- */
.controls{display:flex; gap:8px; flex-wrap:wrap; align-items:center}
.controls input[type="search"]{font:inherit; font-size:13px; padding:7px 11px; border:1px solid var(--edge);
  background:var(--panel); color:var(--ink); border-radius:2px; min-width:220px}
.chip{font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase;
  padding:6px 11px; border:1px solid var(--edge); background:var(--panel); color:var(--ink-2);
  border-radius:2px; cursor:pointer; transition:background .15s ease, color .15s ease, border-color .15s ease}
.chip:hover{border-color:var(--accent); color:var(--accent-ink)}
.chip[aria-pressed="true"]{background:var(--accent); border-color:var(--accent); color:var(--paper)}
.chip:focus-visible,.row-btn:focus-visible,input:focus-visible{outline:2px solid var(--accent); outline-offset:2px}

.board{border:1px solid var(--edge); border-radius:3px; background:var(--panel);
  box-shadow:var(--shadow); overflow-x:auto}
table{border-collapse:collapse; width:100%; min-width:720px}
th{font-family:var(--mono); font-size:10.5px; letter-spacing:.11em; text-transform:uppercase;
  color:var(--ink-3); text-align:left; padding:10px 14px; border-bottom:1px solid var(--edge);
  background:var(--panel-2); position:sticky; top:0}
td{padding:9px 14px; border-bottom:1px solid var(--edge-soft); vertical-align:top; font-size:13.5px}
tr:last-child td{border-bottom:0}
tbody tr.item{transition:background .12s ease}
tbody tr.item:hover{background:var(--panel-2)}
td.c-id{white-space:nowrap}
td.c-num{font-family:var(--mono); font-size:12px; color:var(--ink-2); white-space:nowrap; text-align:right;
  font-variant-numeric:tabular-nums}
.row-btn{background:none; border:0; padding:0; font:inherit; text-align:left; color:var(--ink);
  cursor:pointer; text-decoration:underline; text-decoration-color:var(--edge); text-underline-offset:3px}
.row-btn:hover{text-decoration-color:var(--accent)}
.detail td{background:var(--panel-2); font-size:13px; color:var(--ink-2)}
.detail .d-body{max-width:96ch}
.detail dl{display:grid; grid-template-columns:auto 1fr; gap:3px 14px; margin:10px 0 0;
  font-family:var(--mono); font-size:11.5px}
.detail dt{color:var(--ink-3); text-transform:uppercase; letter-spacing:.08em}
.detail dd{margin:0; color:var(--ink)}
.hidden{display:none}
.empty{padding:16px; font-size:13px; color:var(--ink-3)}

/* ---------- activity ---------- */
.log{background:var(--panel); border:1px solid var(--edge); border-radius:3px;
  box-shadow:var(--shadow); padding:4px 0; font-family:var(--mono); font-size:12px}
.log div{display:grid; grid-template-columns:78px 108px 1fr; gap:12px; padding:6px 16px; align-items:baseline}
.log .sha,.log .d{color:var(--ink-3)}
.log .s{color:var(--ink-2); overflow-wrap:anywhere}
.log .s b{color:var(--accent-ink); font-weight:700}

footer{border-top:1px solid var(--edge); padding-top:18px; color:var(--ink-3); font-size:12.5px;
  display:flex; flex-direction:column; gap:8px}
footer code{font-family:var(--mono); background:var(--panel-2); border:1px solid var(--edge-soft);
  padding:1px 5px; border-radius:2px; color:var(--ink-2)}
.warn{color:var(--lamp-gated)}
@media (max-width:820px){.figs{grid-template-columns:1fr}}
@media (max-width:640px){
  .trow{grid-template-columns:1fr; gap:6px}
  .stamp{text-align:left; align-items:flex-start}
  .node .nt{max-width:18ch}
}
`;

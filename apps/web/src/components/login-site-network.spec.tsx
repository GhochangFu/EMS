import { render } from "@testing-library/react";
import { expect } from "vitest";

import indexCss from "../index.css?raw";
import { CLEAR_ZONE, LINKS, LoginSiteNetwork, SITES, insideClearZone } from "./login-site-network";

/**
 * `F4.398` (ADR 0142 Amendment 3 items 4–6) — the login page's site network is decoration that
 * never sits under text: no site inside the clear zone, the lines masked by the same ellipse, the
 * whole thing hidden from assistive technology and drawn only from `lg` up, and moving only when
 * motion is allowed.
 *
 * Assertions live here; `login-site-network.test.tsx` is the Vitest entry point (ADR 0014).
 */

const css = indexCss.split("\r\n").join("\n");

/** SN1 — no site is inside the clear zone; a point at its centre is, so the rule can fail. */
export function keepsEverySiteOutOfTheClearZone(): void {
  expect(insideClearZone([CLEAR_ZONE.cx, CLEAR_ZONE.cy])).toBe(true);
  expect(insideClearZone([CLEAR_ZONE.cx + CLEAR_ZONE.rx - 1, CLEAR_ZONE.cy])).toBe(true);
  expect(SITES.length).toBeGreaterThanOrEqual(20);
  expect(SITES.filter(insideClearZone)).toEqual([]);
  for (const [x, y] of SITES) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(100);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(100);
  }
  expect(new Set(SITES.map(([x, y]) => `${x},${y}`)).size).toBe(SITES.length);
}

/** SN2 — every line joins two different, existing sites, and no line is drawn twice. */
export function joinsOnlyRealSites(): void {
  expect(LINKS.length).toBeGreaterThan(0);
  for (const [from, to] of LINKS) {
    expect(SITES[from]).toBeDefined();
    expect(SITES[to]).toBeDefined();
    expect(from).not.toBe(to);
  }
  expect(new Set(LINKS.map(([a, b]) => [a, b].sort((p, q) => p - q).join("-"))).size).toBe(LINKS.length);
}

/** SN3 — decoration: hidden from assistive technology, no text, not clickable, only from `lg` up. */
export function isDecorationOnly(): void {
  const { container } = render(<LoginSiteNetwork />);
  const network = container.querySelector("[data-part='site-network']");
  expect(network?.getAttribute("aria-hidden")).toBe("true");
  expect(network?.textContent).toBe("");
  const classes = network?.getAttribute("class")?.split(" ") ?? [];
  expect(classes).toContain("pointer-events-none");
  expect(classes).toContain("hidden");
  expect(classes).toContain("lg:block");
  expect(container.querySelectorAll("[data-part='site']")).toHaveLength(SITES.length);
  expect(container.querySelectorAll("line")).toHaveLength(LINKS.length);
  expect(container.querySelector("a, button, [tabindex]")).toBeNull();
}

/** SN4 — the mask that fades the lines is the clear zone's own ellipse, hidden up to its edge. */
export function masksTheLinesWithTheClearZone(): void {
  const rule = /\.login-network-lines \{([^}]*)\}/.exec(css)?.[1] ?? "";
  const ellipse = /mask-image: radial-gradient\(\s*ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%,\s*transparent 100%/.exec(rule);
  expect(ellipse?.slice(1).map(Number)).toEqual([CLEAR_ZONE.rx, CLEAR_ZONE.ry, CLEAR_ZONE.cx, CLEAR_ZONE.cy]);
}

/** SN5 — the sites and the rise-in move only when motion is allowed, by transform and opacity. */
export function movesOnlyWhenMotionIsAllowed(): void {
  const block = /@media \(prefers-reduced-motion: no-preference\) \{\s*\.login-site \{[\s\S]*?\n\}\n/.exec(css)?.[0] ?? "";
  for (const name of ["login-site", "login-rise"]) {
    expect(block, name).toMatch(new RegExp(`\\.${name} \\{[^}]*animation: ${name} `));
    const frames = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`).exec(css)?.[1] ?? "";
    const props = [...frames.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]);
    expect(props.length, name).toBeGreaterThan(0);
    expect(props.every((prop) => prop === "transform" || prop === "opacity"), name).toBe(true);
  }
  expect(css.replace(block, "")).not.toMatch(/animation: login-(site|rise)/);
  // One brightening every 5 s for a site: far under three flashes a second (WCAG 2.3.1).
  expect(block).toMatch(/animation: login-site 5s /);
}

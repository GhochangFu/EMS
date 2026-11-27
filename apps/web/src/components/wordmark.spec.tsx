import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import indexCss from "../index.css?raw";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../lib/brand";
import { VERVE_LOGO } from "./verve-logo-data";
import { Wordmark } from "./wordmark";

/**
 * `F4.398` U2 (ADR 0142 decision 3 and Amendment 1) — the Verve logo: an inline `svg` named
 * `Verve`, the pulse V as one filled path with one gradient, then the letters as one outline path.
 * The colours are the fixed brand colours of `verve-logo-data.ts`; the dark form is the default
 * because every call site sits on chrome. There is no text, no `<img>` and no role colour class.
 *
 * Assertions live here; `wordmark.test.tsx` is the Vitest entry point (ADR 0014).
 */

const DARK_STOPS = ["#38BDF8", "#22B5D4", "#14B8A6", "#2DD4A0", "#34D399"];
const LIGHT_STOPS = ["#16405C", "#18576C", "#189E7F", "#14B088", "#1DAF86"];

function mark(): HTMLElement {
  return screen.getByRole("img", { name: "Verve" });
}

function pulseOf(svg: Element): Element {
  const pulses = svg.querySelectorAll('path[data-part="pulse"]');
  expect(pulses).toHaveLength(1);
  return pulses[0] as Element;
}

function lettersOf(svg: Element): Element {
  const letters = svg.querySelectorAll('path[data-part="letters"]');
  expect(letters).toHaveLength(1);
  return letters[0] as Element;
}

/** The gradient the pulse of `svg` points at, looked up inside the same `svg`. */
function gradientOf(svg: Element): Element {
  const id = /^url\(#(verve-pulse-[\w-]+)\)$/.exec(pulseOf(svg).getAttribute("fill") ?? "")?.[1];
  expect(id).toBeTruthy();
  const gradient = [...svg.querySelectorAll("linearGradient")].find((g) => g.getAttribute("id") === id);
  if (!gradient) throw new Error(`no linearGradient with id ${id} inside the svg`);
  return gradient;
}

function stopColours(svg: Element): (string | null)[] {
  return [...gradientOf(svg).querySelectorAll("stop")].map((s) => s.getAttribute("stop-color"));
}

/** W1 — the header variant is one image named Verve; the name and the tagline are the brand constants. */
export function namesTheHeaderLogoVerve(): void {
  render(<Wordmark variant="header" />);
  expect(mark()).toBeTruthy();
  expect(PRODUCT_NAME).toBe("Verve");
  expect(PRODUCT_TAGLINE).toBe("The pulse of every site");
}

/** W2 — it is an inline svg with the asset's view box, no text and no `<img>`. */
export function drawsAnInlineSvgWithNoText(): void {
  const { container } = render(<Wordmark variant="header" />);
  expect(mark().tagName.toLowerCase()).toBe("svg");
  expect(mark().getAttribute("viewBox")).toBe("0 0 455 205");
  expect(mark().textContent).toBe("");
  expect(container.querySelector("img")).toBeNull();
}

/** W3 — one pulse path, filled by its own gradient on a vertical axis with five stops, never stroked. */
export function fillsThePulseWithOneGradient(): void {
  render(<Wordmark variant="header" />);
  const pulse = pulseOf(mark());
  expect(pulse.getAttribute("fill")).toMatch(/^url\(#verve-pulse-[\w-]+\)$/);
  expect(pulse.hasAttribute("stroke")).toBe(false);
  const gradient = gradientOf(mark());
  expect(gradient.getAttribute("gradientUnits")).toBe("userSpaceOnUse");
  expect(gradient.getAttribute("x1")).toBe(gradient.getAttribute("x2"));
  expect(gradient.querySelectorAll("stop")).toHaveLength(5);
}

/** W4 — the default tone is the dark form: the dark stops and white letters. */
export function drawsTheDarkFormByDefault(): void {
  render(<Wordmark variant="header" />);
  expect(stopColours(mark())).toEqual(DARK_STOPS);
  expect(lettersOf(mark()).getAttribute("fill")).toBe("#FFFFFF");
}

/** W5 — `tone="light"` is the light form: the light stops and navy letters. */
export function drawsTheLightFormOnRequest(): void {
  render(<Wordmark variant="header" tone="light" />);
  expect(stopColours(mark())).toEqual(LIGHT_STOPS);
  expect(lettersOf(mark()).getAttribute("fill")).toBe("#0F172A");
}

/** W6 — two logos in one document have two gradient ids, and each pulse points at its own. */
export function givesEachLogoItsOwnGradientId(): void {
  render(
    <>
      <Wordmark variant="header" />
      <Wordmark variant="hero" />
    </>,
  );
  const marks = screen.getAllByRole("img", { name: "Verve" });
  expect(marks).toHaveLength(2);
  const ids = marks.map((svg) => gradientOf(svg).getAttribute("id"));
  expect(new Set(ids).size).toBe(2);
}

/** W7 — the hero has the same name and paths at its own size; the header keeps `h-8`. */
export function sizesTheHeroAndTheHeader(): void {
  const header = render(<Wordmark variant="header" />);
  const headerSvg = mark();
  const paths = [pulseOf(headerSvg).getAttribute("d"), lettersOf(headerSvg).getAttribute("d")];
  expect(headerSvg.getAttribute("class")).toContain("h-8");
  expect(headerSvg.getAttribute("class")).not.toContain("h-28");
  header.unmount();

  render(<Wordmark variant="hero" />);
  expect(mark().getAttribute("class")).toContain("h-28");
  expect(mark().getAttribute("class")).not.toContain("h-8");
  expect([pulseOf(mark()).getAttribute("d"), lettersOf(mark()).getAttribute("d")]).toEqual(paths);
  expect(paths.every((d) => (d ?? "").length > 1000)).toBe(true);
}

/**
 * W10 — the letters, not the logo's box, sit on the header's centre line. The peak of the pulse
 * puts the letters' centre 21 % of the logo's height below the box's centre (viewBox 205 high,
 * letters y 107.6–183.91), so a logo centred by its box shows "erve" about 7 px below the header
 * text beside it (owner, 2026-11-22). Both header sizes lift by that share; the 40 px rail header
 * takes the smaller `h-7`, because a lifted `h-8` would put the peak above the header. The hero
 * stands alone and is not lifted.
 */
export function centresTheLettersOnTheHeaderLine(): void {
  const LIFT = "-translate-y-[21%]";
  const header = render(<Wordmark variant="header" />);
  expect(mark().getAttribute("class")?.split(" ")).toEqual(["h-8", "w-auto", LIFT]);
  header.unmount();

  const rail = render(<Wordmark variant="rail" />);
  expect(mark().getAttribute("class")?.split(" ")).toEqual(["h-7", "w-auto", LIFT]);
  rail.unmount();

  render(<Wordmark variant="hero" />);
  expect(mark().getAttribute("class")).not.toContain("translate");

  // The share itself, from the drawing: (letters' centre − box centre) ÷ box height.
  const [, , , boxHeight] = VERVE_LOGO.viewBox.split(" ").map(Number);
  const ys = [...VERVE_LOGO.letters.matchAll(/[ML]-?[\d.]+ (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const lettersCentre = (Math.min(...ys) + Math.max(...ys)) / 2;
  expect(Math.round(((lettersCentre - boxHeight / 2) / boxHeight) * 100)).toBe(21);
}

/** W8 — the letters fill by the even-odd rule; without it the counters of "e" fill in. */
export function fillsTheLettersEvenOdd(): void {
  render(<Wordmark variant="header" />);
  expect(lettersOf(mark()).getAttribute("fill-rule")).toBe("evenodd");
}

/** W9 — the svg carries no role colour class: the colours are the fixed brand colours. */
export function carriesNoRoleColourClass(): void {
  render(<Wordmark variant="hero" />);
  const classes = (mark().getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  expect(classes.length).toBeGreaterThan(0);
  expect(classes.filter((c) => /(^|:)(text|fill|stroke|bg)-/.test(c))).toEqual([]);
}

/**
 * W11 — `animated` (ADR 0142 Amendment 2) adds the draw-on clip, the letters' fade and the
 * travelling light, and changes nothing in the drawing: still one pulse path with its one gradient
 * fill, the light a second copy of the same `d` in the logo's own white behind its own mask. A
 * logo that is not animated carries none of it.
 */
export function animatesOnlyOnRequest(): void {
  const still = render(<Wordmark variant="hero" />);
  expect(mark().querySelector("clipPath, mask, [data-part='light']")).toBeNull();
  expect(mark().innerHTML).not.toContain("verve-logo-");
  const stillPulse = pulseOf(mark()).getAttribute("d");
  still.unmount();

  render(<Wordmark variant="hero" animated />);
  const svg = mark();
  expect(svg.querySelectorAll("path[data-part='pulse']")).toHaveLength(1);
  const pulse = pulseOf(svg);
  expect(pulse.getAttribute("d")).toBe(stillPulse);
  expect(pulse.getAttribute("fill")).toMatch(/^url\(#verve-pulse-[\w-]+\)$/);

  const clip = svg.querySelector("clipPath");
  expect(pulse.parentElement?.getAttribute("clip-path")).toBe(`url(#${clip?.getAttribute("id")})`);
  expect(clip?.querySelector("rect")?.getAttribute("class")).toBe("verve-logo-reveal");

  const light = svg.querySelector("path[data-part='light']");
  expect(light?.getAttribute("d")).toBe(stillPulse);
  expect(light?.getAttribute("fill")).toBe("#FFFFFF");
  const mask = svg.querySelector("mask");
  expect(light?.getAttribute("mask")).toBe(`url(#${mask?.getAttribute("id")})`);
  expect(mask?.querySelector("rect")?.getAttribute("class")).toBe("verve-logo-light");
  expect(lettersOf(svg).getAttribute("class")).toBe("verve-logo-letters");

  const ids = [...svg.querySelectorAll("[id]")].map((node) => node.getAttribute("id"));
  expect(new Set(ids).size).toBe(ids.length);
}

/**
 * W12 — with reduced motion the logo does not move: every `animation` on a `verve-logo-*` class
 * sits inside `prefers-reduced-motion: no-preference`, the keyframes move transform and opacity
 * only, and the light's cycle is slower than three flashes a second (WCAG 2.3.1).
 */
export function movesOnlyWhenMotionIsAllowed(): void {
  const css = indexCss.split("\r\n").join("\n");
  const block = /@media \(prefers-reduced-motion: no-preference\) \{\s*\.verve-logo-reveal[\s\S]*?\n\}\n/.exec(css)?.[0] ?? "";
  for (const name of ["verve-logo-reveal", "verve-logo-letters", "verve-logo-light"]) {
    expect(block, name).toMatch(new RegExp(`\\.${name} \\{[^}]*animation: ${name} `));
    const frames = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`).exec(css)?.[1] ?? "";
    const props = [...frames.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]);
    expect(props.length, name).toBeGreaterThan(0);
    expect(props.every((prop) => prop === "transform" || prop === "opacity"), name).toBe(true);
  }
  const outside = css.replace(block, "");
  expect(outside).not.toMatch(/animation: verve-logo-/);
  expect(block).toMatch(/animation: verve-logo-light 6s /);
}

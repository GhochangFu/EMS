import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../lib/brand";
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

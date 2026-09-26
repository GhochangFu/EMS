import { SMOC_PAGES } from "./smoc-pages";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `P1` — the seven SMOC pages, labels and paths exactly as the shell's
 * *Control Room 2D* group named them before `F3.66` U6 deleted it (OQ1):
 * the site page's `builtin` body lists these.
 */
export function runP1(): void {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ["CR · Main Dashboard", "/cr-overview"],
    ["CR · Electrical SLD", "/cr-sld"],
    ["CR · UPS Monitoring", "/cr-ups"],
    ["CR · Battery Bank", "/cr-battery"],
    ["CR · HVAC System", "/cr-hvac"],
    ["CR · Environment", "/cr-env"],
    ["CR · IT & Rack Load", "/cr-it"],
  ];
  assert(SMOC_PAGES.length === expected.length, `expected 7 pages, got ${SMOC_PAGES.length}`);
  expected.forEach(([label, path], index) => {
    const page = SMOC_PAGES[index];
    assert(page?.label === label, `page ${index}: expected label ${label}, got ${page?.label}`);
    assert(page?.path === path, `page ${index}: expected path ${path}, got ${page?.path}`);
  });
}

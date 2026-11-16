import type { RoleName, Roles } from "./theme";

/**
 * `F4.381` (the owner's AWS check of `6bec61f6`, 2026-11-16) — which series roles the past-forecast
 * line and the live forecast take, so that the three first colours on a forecast chart are clearly
 * distinct in every colour profile.
 *
 * ADR 0135 `F4.377` (the owner's ruling, 2026-11-16: three colours) gave the past line
 * `series-2`, `series-6`, `series-7`, `series-8` and the live forecast `series-3`, `series-4`,
 * `series-5`, with `series-1` the first actual line. Under some profiles two of the first three are
 * close: `sand` light's actual `#155E75` and past `#0F766E` are ΔE2000 16.6 apart, the default dark
 * theme's actual `#818CF8` and live `#C084FC` 13.4. The owner's ruling (2026-11-16): pick the roles
 * in code, no token change. The rule: the first actual, past and live colours are each at least
 * {@link MIN_FORECAST_DELTA_E} apart. The past line takes the first role of its palette that holds
 * it against `series-1` and against some live role; the live forecast takes the first role of its
 * palette that holds it against both. `series-2` and `series-3` stay wherever they hold. Each
 * palette keeps its own roles, so the three kinds never share one; the chosen role moves to the
 * front and the rest keep their order. `tests/f4.381-forecast-colours-distinct.test.ts` holds every
 * profile in both themes.
 */

/** The least ΔE2000 between any two of the first actual, past and live colours. */
export const MIN_FORECAST_DELTA_E = 20;

const PAST_ROLES: readonly RoleName[] = ["series-2", "series-6", "series-7", "series-8"];
const LIVE_ROLES: readonly RoleName[] = ["series-3", "series-4", "series-5"];

/** The roles each forecast kind takes, in order: the first is the one-point chart's colour. */
export interface ForecastRoles {
  readonly past: readonly RoleName[];
  readonly live: readonly RoleName[];
}

const cache = new WeakMap<Roles, ForecastRoles>();

function chosenFirst(order: readonly RoleName[], chosen: RoleName): RoleName[] {
  return [chosen, ...order.filter((role) => role !== chosen)];
}

/** The past and live roles for `roles` (cached per resolved roles object). */
export function forecastRoles(roles: Roles): ForecastRoles {
  const hit = cache.get(roles);
  if (hit) {
    return hit;
  }
  const actual = roles["series-1"];
  const far = (a: string, b: string) => deltaE2000(a, b) >= MIN_FORECAST_DELTA_E;
  let picked: ForecastRoles = { past: [...PAST_ROLES], live: [...LIVE_ROLES] };
  search: for (const past of PAST_ROLES) {
    if (!far(actual, roles[past])) {
      continue;
    }
    for (const live of LIVE_ROLES) {
      if (far(actual, roles[live]) && far(roles[past], roles[live])) {
        picked = { past: chosenFirst(PAST_ROLES, past), live: chosenFirst(LIVE_ROLES, live) };
        break search;
      }
    }
  }
  cache.set(roles, picked);
  return picked;
}

const RGB = /^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/;

type Lab = readonly [number, number, number];

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** CIE L*a*b* (D65) of a resolved role `rgb(r, g, b)`. */
function labOf(rgb: string): Lab {
  const m = RGB.exec(rgb);
  if (!m) {
    throw new Error(`deltaE2000 expects a resolved role "rgb(r, g, b)", got "${rgb}"`);
  }
  const [r, g, b] = [linear(Number(m[1])), linear(Number(m[2])), linear(Number(m[3]))];
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : (1 / 3) * (29 / 6) ** 2 * t + 4 / 29);
  const [fx, fy, fz] = [f(x / 95.047), f(y / 100), f(z / 108.883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 between two L*a*b* colours (Sharma, Wu and Dalal 2005). */
export function deltaE2000Lab([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b: number, ap: number) => (b === 0 && ap === 0 ? 0 : (deg(Math.atan2(b, ap)) + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp) / 2);
  const lBarp = (l1 + l2) / 2;
  const cBarp = (c1p + c2p) / 2;
  let hBarp = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hBarp = (h1p + h2p + 360) / 2;
    else hBarp = (h1p + h2p - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hBarp - 30)) +
    0.24 * Math.cos(rad(2 * hBarp)) +
    0.32 * Math.cos(rad(3 * hBarp + 6)) -
    0.2 * Math.cos(rad(4 * hBarp - 63));
  const dTheta = 30 * Math.exp(-(((hBarp - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarp ** 7 / (cBarp ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBarp - 50) ** 2) / Math.sqrt(20 + (lBarp - 50) ** 2);
  const sc = 1 + 0.045 * cBarp;
  const sh = 1 + 0.015 * cBarp * t;
  const rt = -Math.sin(rad(2 * dTheta)) * rc;
  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh));
}

/** CIEDE2000 between two resolved roles `rgb(r, g, b)`. Throws on any other string. */
export function deltaE2000(rgbA: string, rgbB: string): number {
  return deltaE2000Lab(labOf(rgbA), labOf(rgbB));
}

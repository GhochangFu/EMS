import type { Surface } from "../lib/surface";
import { useSurface, useSurfaceStore } from "../stores/surface-store";
import { PreferenceSwitch, type PreferenceOption } from "./preference-switch";

// Material Icons "layers" and "crop_square" (Apache-2.0), the family `theme-switch.tsx` draws
// from: stacked sheets for the raised, shadowed style, a plain square for the flat one.
const LAYERS_PATH =
  "M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z";
const SQUARE_PATH =
  "M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H6V6h12v12z";

const OPTIONS: readonly PreferenceOption<Surface>[] = [
  { value: "neumorphic", label: "Neumorphic", title: "Neumorphic surfaces", icon: "layers", path: LAYERS_PATH },
  { value: "flat", label: "Flat", title: "Flat surfaces", icon: "square", path: SQUARE_PATH },
];

/**
 * `F3.71` — the user's Neumorphic / Flat switch (ADR 0085 decision 1), beside the theme switch on
 * the `chrome` header. A click calls the store's `setSurface`, which flips `data-surface` on
 * `<html>` and writes `bms.surface` — `"neumorphic"` or `"flat"`, the one format the boot script
 * in `index.html` reads.
 */
export function SurfaceSwitch() {
  const surface = useSurface();
  const setSurface = useSurfaceStore((s) => s.setSurface);
  return <PreferenceSwitch label="Surface" options={OPTIONS} value={surface} onChange={setSurface} />;
}

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { drawsEachIconFromItsLucideShapes } from "./nav-icon.spec";

afterEach(() => cleanup());

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.348 the navigation icon (ADR 0118 Amendment 4)", () => {
  it("I4 draws each item's Lucide shapes in currentColor, decorative", () => drawsEachIconFromItsLucideShapes());
});

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import { rendersANamedNavWithAnOrderedList, rendersNothingForOneStep } from "./breadcrumb.spec";

afterEach(cleanup);

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 the breadcrumb (ADR 0118 Amendment 1 A6)", () => {
  it("BC1 a nav named Breadcrumb with an ordered list; the last step is aria-current", () => rendersANamedNavWithAnOrderedList());
  it("BC2 one step renders nothing", () => rendersNothingForOneStep());
});

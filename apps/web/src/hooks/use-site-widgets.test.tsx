// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anAlarmEventInvalidatesTheCatalogValuesRead,
  anAlarmEventInvalidatesTheSiteWidgetsRead,
} from "./use-site-widgets.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.73 useSiteWidgetsAlarmRefresh", () => {
  afterEach(() => {
    cleanup();
  });

  it("an alarm event invalidates the site-widgets read", () => {
    anAlarmEventInvalidatesTheSiteWidgetsRead();
  });

  it("an alarm event invalidates the catalog-values read, so the alarm tile moves with the rail", () => {
    anAlarmEventInvalidatesTheCatalogValuesRead();
  });
});

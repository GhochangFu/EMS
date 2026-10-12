import { expect, test } from "@playwright/test";

import { apiGet, apiPost, authFile, E2eApiError, readFixtures, tokenFromStorageState } from "../src/api.js";
import { RUN_ID } from "../src/run-id.js";

/**
 * ADR 0100 path 3 — an operator acknowledges an active alarm.
 *
 * The seeded rules cannot fire on demand (plan §2 Q1), so the spec makes its
 * own: a threshold rule `kw >= 1` on `CR-MAIN-BUS`, whose simulated demand is
 * about 4.4 kW and always matches. It is created and published through the
 * API, then "evaluate now" raises the alarm in the API process. When that
 * press is throttled (429), the streaming engine raises it once its 60 s
 * rule cache expires, so the wait is 70 s.
 *
 * The acknowledged state after a reload is the claim. `AlarmsService.acknowledge`
 * (`apps/api/src/alarms/alarms.service.ts`) stamps `acknowledged_at`; an
 * acknowledge that stops stamping it still answers 200, and the row then reads
 * "Active" again with its Ack button back.
 *
 * Rows are found by the alarm's own raised time, not by "the one Active row
 * on CR-MAIN-BUS": an earlier run on the same database (plan §8 ruling 3) can
 * leave its own rows on that asset.
 */

const ASSET_CODE = "CR-MAIN-BUS";
// `apps/web/src/lib/alarm-state.ts` `alarmStateLabel`.
const ACTIVE = "Active";
const ACKNOWLEDGED = "Acknowledged";
const ACK_REASON = "E2E acknowledgement";
// The streaming engine's rule cache is 60 s (`alarm-engine.service.ts` `CACHE_TTL_MS`).
const RAISE_TIMEOUT_MS = 70_000;

type Rule = { id: string };
type AlarmItem = {
  id: string;
  ruleId: string | null;
  raisedAt: string;
  acknowledgedAt: string | null;
  clearedAt: string | null;
  assetCode: string;
};
type AlarmPage = { items: AlarmItem[]; nextCursor: string | null };

let ruleId: string | null = null;

async function alarmForRule(token: string, assetId: string, id: string): Promise<AlarmItem | undefined> {
  const params = new URLSearchParams({ limit: "100", assetIds: assetId });
  const page = await apiGet<AlarmPage>(`/api/v1/alarms?${params}`, token);
  return page.items.find((item) => item.ruleId === id);
}

test.use({ storageState: authFile("admin") });

test.describe("path 3 — alarm acknowledgement", () => {
  // The raise can take the full 70 s; the UI part needs its own margin.
  test.setTimeout(120_000);

  test.afterAll(async () => {
    if (ruleId === null) return;
    const token = tokenFromStorageState(authFile("admin"));
    await apiPost(`/api/v1/rules/${ruleId}/archive`, token, {});
  });

  test("an active alarm is acknowledged and stays acknowledged after a reload", async ({ page }) => {
    const token = tokenFromStorageState(authFile("admin"));
    const { crMainBusAssetId } = readFixtures();

    const rule = await apiPost<Rule>("/api/v1/rules", token, {
      name: `E2E ${RUN_ID} demand`,
      ruleType: "threshold",
      assetId: crMainBusAssetId,
      pointKey: "kw",
      operator: "gte",
      thresholdValue: 1,
      severity: "warning",
      condition: { window: "latest", unit: "kW" },
      action: { type: "review", target: "Operations" },
    });
    ruleId = rule.id;
    await apiPost(`/api/v1/rules/${rule.id}/publish`, token, {});
    try {
      await apiPost("/api/v1/rules/evaluate", token, {});
    } catch (err) {
      if (!(err instanceof E2eApiError) || err.status !== 429) throw err;
    }

    await expect
      .poll(async () => (await alarmForRule(token, crMainBusAssetId, rule.id))?.acknowledgedAt, {
        message: `an unacknowledged alarm raised by rule ${rule.id}`,
        timeout: RAISE_TIMEOUT_MS,
        intervals: [1_000, 2_000, 5_000],
      })
      .toBeNull();
    const alarm = await alarmForRule(token, crMainBusAssetId, rule.id);
    if (alarm === undefined) throw new Error(`the alarm of rule ${rule.id} vanished`);
    expect(alarm.clearedAt).toBeNull();

    await page.goto("/alarms");
    // The Raised column renders `new Date(raisedAt).toLocaleString()` in the browser.
    const raisedText = await page.evaluate((iso) => new Date(iso).toLocaleString(), alarm.raisedAt);
    const search = page.getByPlaceholder("Asset, site, severity, subsystem...");

    const ourRow = () =>
      page.locator("tbody tr").filter({ hasText: ASSET_CODE }).filter({ hasText: raisedText });
    const stateCell = () => ourRow().locator("td").nth(5);

    await search.fill(ASSET_CODE);
    await expect(ourRow()).toHaveCount(1);
    await expect(stateCell()).toHaveText(ACTIVE);

    await ourRow().getByRole("button", { name: "Ack", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Acknowledge alarm" });
    await dialog.locator("#reason").fill(ACK_REASON);
    await dialog.getByRole("button", { name: "Confirm ack", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(stateCell()).toHaveText(ACKNOWLEDGED);
    await expect(ourRow().getByRole("button", { name: "Ack", exact: true })).toHaveCount(0);

    await page.reload();
    await search.fill(ASSET_CODE);
    await expect(ourRow()).toHaveCount(1);
    await expect(stateCell()).toHaveText(ACKNOWLEDGED);
    await expect(ourRow().getByRole("button", { name: "Ack", exact: true })).toHaveCount(0);

    const after = await alarmForRule(token, crMainBusAssetId, rule.id);
    expect(after?.acknowledgedAt).not.toBeNull();
    expect(after?.acknowledgedAt).toEqual(expect.any(String));
  });
});

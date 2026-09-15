import { expect, test } from "@playwright/test";
import { generatePlan, resetApp } from "./helpers";

test.describe("重排：人工调整实时重算缺口/班次/未满足站点", () => {
  test("减量 → 出现剩余缺口与未满足站；恢复/改派后清零", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");

    const remaining = page.getByTestId("metric-remaining");
    const unmetStations = page.getByTestId("metric-unmet-stations");
    await expect(remaining).toHaveText("0L");
    await expect(unmetStations).toHaveText("0");

    // 东区二站 92# 原缺口 18000，减量到 9000
    const row = page
      .locator(".stop-table tbody tr")
      .filter({ hasText: "东区二站" })
      .filter({ hasText: "92#汽油" });
    await expect(row).toHaveCount(1);
    const qty = row.locator(".qty-input");
    await qty.fill("9000");
    await qty.dispatchEvent("change");

    // 实时重算：剩余缺口 9000L，1 个无法满足站点
    await expect(remaining).toHaveText("9000L");
    await expect(unmetStations).toHaveText("1");
    await expect(page.getByTestId("unmet-panel")).toBeVisible();
    await expect(page.getByTestId("unmet-item").filter({ hasText: "东区二站" })).toContainText("9000");
    await expect(page.getByTestId("review-remaining-seed-3-P92")).toHaveText("9000");

    // 阻断性校验不应出现（减量不超容量），仍可提交
    await expect(page.getByTestId("violations")).toHaveCount(0);

    // 恢复数量：缺口清零
    await qty.fill("18000");
    await qty.dispatchEvent("change");
    await expect(remaining).toHaveText("0L");
    await expect(unmetStations).toHaveText("0");
    await expect(page.getByTestId("unmet-panel")).toHaveCount(0);
  });

  test("站点任务改派到另一辆车：总量与剩余缺口不变，班次数可能合并，行不重复", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");

    const plannedBefore = Number((await page.getByTestId("metric-planned").innerText()).replace("L", ""));
    const stopRowsBefore = await page.locator('[data-testid^="stop-row-"]').count();
    expect(stopRowsBefore).toBeGreaterThanOrEqual(8);

    // 把第一行任务用“调至车辆”下拉移到同油品的另一辆车
    const firstRow = page.locator(".stop-table tbody tr").first();
    const stationName = (await firstRow.locator("td").nth(0).innerText()).trim();
    const productNameText = (await firstRow.locator("td").nth(1).innerText()).trim();
    await firstRow.locator(".move-select").selectOption({ index: 1 });

    // 总量不变、无新增缺口；站点+油品仍只有一行
    await expect(page.getByTestId("metric-planned")).toHaveText(`${plannedBefore}L`);
    await expect(page.getByTestId("metric-remaining")).toHaveText("0L");
    await expect(page.locator('[data-testid^="stop-row-"]')).toHaveCount(stopRowsBefore);
    const sameRows = page
      .locator(".stop-table tbody tr")
      .filter({ hasText: stationName })
      .filter({ hasText: productNameText });
    await expect(sameRows).toHaveCount(1);
  });

  test("移除任务后待执行站点减少、缺口回到未满足", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");

    const stopsBefore = await page.locator('[data-testid^="stop-row-"]').count();
    const row = page
      .locator(".stop-table tbody tr")
      .filter({ hasText: "东区三站" })
      .filter({ hasText: "95#汽油" });
    await row.locator('[data-testid^="stop-remove-"]').click();

    await expect(page.locator('[data-testid^="stop-row-"]')).toHaveCount(stopsBefore - 1);
    // 东区三站 95# 缺口 11000 重新变为未满足
    await expect(page.getByTestId("metric-remaining")).toHaveText("11000L");
    await expect(page.getByTestId("unmet-panel")).toBeVisible();
    await expect(page.getByTestId("review-remaining-seed-4-P95")).toHaveText("11000");
  });
});

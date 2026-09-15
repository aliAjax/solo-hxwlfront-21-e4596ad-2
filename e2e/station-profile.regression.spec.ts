import { expect, test } from "@playwright/test";
import { resetApp, STORAGE_KEYS } from "./helpers";

test.describe("油站资料页回归（行为保持不变）", () => {
  test("种子数据、新增、区域过滤、状态流转、删除、刷新持久化", async ({ page }) => {
    await resetApp(page);
    await expect(page.getByTestId("station-view")).toBeVisible();

    // 8 个种子站
    const initialCards = page.locator('[data-testid^="station-card-"]');
    await expect(initialCards).toHaveCount(8);

    // 新增油站（按字段标签定位）
    const form = page.getByTestId("station-form");
    await form.locator("label", { hasText: "油站名称" }).locator("input").fill("测试新城站");
    await form.locator("label", { hasText: "区域" }).locator("select").selectOption("西区");
    await form.locator("label", { hasText: "库存摘要" }).locator("input").fill("15000");
    await form.locator("label", { hasText: "负责人" }).locator("input").fill("测试站长");
    await form.locator("button[type=submit]").click();

    await expect(page.locator('[data-testid^="station-card-"]').filter({ hasText: "测试新城站" })).toHaveCount(1);
    await expect(page.getByTestId("station-view")).toContainText("测试新城站 / 西区");

    // 区域过滤
    await page.getByTestId("station-filter").selectOption("西区");
    const westCards = page.locator('[data-testid^="station-card-"]:visible');
    const westCount = await westCards.count();
    expect(westCount).toBe(4); // 3 种子 + 新增
    for (const card of await westCards.all()) {
      await expect(card).toContainText("西区");
    }
    await page.getByTestId("station-filter").selectOption("全部区域");

    // 状态流转：营业中 -> 暂停营业 -> 库存紧张
    const newCard = page.locator('[data-testid^="station-card-"]').filter({ hasText: "测试新城站" });
    await newCard.locator('[data-testid^="station-flow-"]').click();
    await expect(newCard.locator(".status")).toHaveText("暂停营业");
    await newCard.locator('[data-testid^="station-flow-"]').click();
    await expect(newCard.locator(".status")).toHaveText("库存紧张");

    // 刷新持久化
    await page.reload();
    await expect(page.locator('[data-testid^="station-card-"]').filter({ hasText: "测试新城站" })).toHaveCount(1);
    const persisted = await page.evaluate((key) => {
      const rows = JSON.parse(localStorage.getItem(key) || "[]");
      return rows.map((r: { station: string }) => r.station);
    }, STORAGE_KEYS[0]);
    expect(persisted).toContain("测试新城站");

    // 调度模块出现新站默认参数
    await page.getByTestId("tab-replenishment").click();
    await expect(page.locator('[data-testid^="param-"]').filter({ hasText: "测试新城站" })).toHaveCount(1);
    await page.getByTestId("tab-stations").click();

    // 删除
    await newCard.locator('[data-testid^="station-remove-"]').click();
    await expect(page.locator('[data-testid^="station-card-"]').filter({ hasText: "测试新城站" })).toHaveCount(0);
    await expect(page.locator('[data-testid^="station-card-"]')).toHaveCount(8);
  });
});

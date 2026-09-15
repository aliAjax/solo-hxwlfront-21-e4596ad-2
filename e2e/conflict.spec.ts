import { expect, test, type Page } from "@playwright/test";
import { backToList, generatePlan, resetApp } from "./helpers";

test.describe("冲突校验", () => {
  test("超容量 / 错时段 / 错油品 → 阻断提交，修正后可提交", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");

    // 初始无阻断
    await expect(page.getByTestId("violations")).toHaveCount(0);
    const submit = page.getByTestId("plan-submit");
    await expect(submit).toBeEnabled();

    // 1) 超容量：把第一个补货量改成巨量
    const qty = page.locator('[data-testid^="stop-qty-"]').first();
    await qty.fill("999999");
    await qty.dispatchEvent("change");
    await expect(page.getByTestId("violation-over_capacity").first()).toBeVisible();
    await expect(submit).toBeDisabled();

    // 恢复
    await qty.fill("1000");
    await qty.dispatchEvent("change");
    await expect(page.getByTestId("violations")).toHaveCount(0);

    // 2) 到站时段：高优先级东区二站窗口 07:00-19:00，改成 22:00
    const rowEast2 = page.locator("tr", { hasText: "东区二站" }).first();
    const time = rowEast2.locator('input[type="time"]');
    await time.fill("22:00");
    await time.dispatchEvent("change");
    await expect(page.getByTestId("violation-outside_window").first()).toBeVisible();
    await expect(submit).toBeDisabled();
    await time.fill("09:00");
    await time.dispatchEvent("change");

    // 3) 油品不兼容：把某汽油班次改派柴油车
    const shiftSelect = page.locator('[data-testid^="shift-vehicle-"]').first();
    const current = await shiftSelect.inputValue();
    const dieselOption = page.locator('option', { hasText: "柴油" }).first();
    const dieselValue = (await dieselOption.getAttribute("value"))!;
    await shiftSelect.selectOption(dieselValue);
    await expect(page.getByTestId("violation-product_incompatible").first()).toBeVisible();
    await expect(submit).toBeDisabled();
    // 改回原车辆
    await shiftSelect.selectOption(current);
    await expect(page.getByTestId("violations")).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });

  test("同区域同日期重复生成不产生重复计划/重复班次", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "西区");
    const stopsOnce = await page.locator('[data-testid^="stop-row-"]').count();
    const shiftsOnce = await page.locator('[data-testid^="shift-"]').count();
    await backToList(page);

    // 同区同日再次点击生成
    await page.getByTestId("create-area").selectOption("西区");
    await page.getByTestId("create-generate").click();
    await expect(page.getByTestId("plan-status")).toHaveText("草稿");
    await expect(page.locator('[data-testid^="stop-row-"]')).toHaveCount(stopsOnce);
    await expect(page.locator('[data-testid^="shift-"]')).toHaveCount(shiftsOnce);

    // 列表中草稿列仍然只有 1 张西区计划
    await backToList(page);
    await expect(page.getByTestId("plan-column-draft").locator('[data-testid^="plan-card-"]')).toHaveCount(1);
  });

  test("车辆有限：西区柴油缺口超过车队容量 → 标记无法满足站点，且不阻断评审", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "西区");

    // 西区柴油缺口 56000L > 两辆柴油车合计 55000L
    await expect(page.getByTestId("unmet-panel")).toBeVisible();
    await expect(page.getByTestId("metric-unmet-stations")).not.toHaveText("0");
    await expect(page.getByTestId("metric-remaining")).toContainText("1000L");
    await expect(page.getByTestId("unmet-item").filter({ hasText: "0#柴油" })).toContainText("1000");

    // 未满足缺口不是阻断性违规，仍可提交锁定
    await expect(page.getByTestId("plan-submit")).toBeEnabled();
    await page.getByTestId("plan-submit").click();
    await expect(page.getByTestId("plan-status")).toHaveText("待评审");
  });

  test("跨计划占用：在审计划已占车辆时段，另一计划提交被阻断；撤回后放行", async ({ page }) => {
    await resetApp(page);

    // 东区计划：记录柴油班次车辆与首个到站时刻，提交评审
    await generatePlan(page, "东区");
    const eastDieselCard = page
      .locator('[data-testid^="shift-"]')
      .filter({ has: page.locator("tbody tr", { hasText: "0#柴油" }) })
      .first();
    const eastVehicle = await eastDieselCard.locator("select").first().inputValue();
    const eastTime = await eastDieselCard.locator(".time-input").first().inputValue();
    await page.getByTestId("plan-submit").click();
    await expect(page.getByTestId("plan-status")).toHaveText("待评审");
    await page.getByTestId("plan-back").click();

    // 机场线同日计划
    await page.getByTestId("create-area").selectOption("机场线");
    await page.getByTestId("create-generate").click();
    await expect(page.getByTestId("plan-status")).toHaveText("草稿");

    // 只保留机场快线站（24 小时收货）的 0#柴油 单站任务
    const dieselRow = page
      .locator("tbody tr", { hasText: "机场快线站" })
      .filter({ hasText: "0#柴油" })
      .first();
    const keepStopId = (await dieselRow.getAttribute("data-testid"))!.replace("stop-row-", "");
    const card = dieselRow.locator("xpath=ancestor::article");
    let siblings = await card
      .locator("tbody tr")
      .evaluateAll((rows, keep) =>
        rows
          .map((r) => (r.getAttribute("data-testid") ?? "").replace("stop-row-", ""))
          .filter((id) => id && id !== keep)
      , keepStopId);
    for (const id of siblings) {
      await card.locator(`[data-testid="stop-remove-${id}"]`).click();
    }

    // 如该单站不在东区在审柴油车上，移动过去；到站对齐东区首站 → 跨计划时段冲突
    const currentVehicle = await card.locator("select").first().inputValue();
    if (currentVehicle !== eastVehicle) {
      await dieselRow.locator(".move-select").selectOption({ label: `→ ${await vehicleLabel(page, eastVehicle)}` });
    }
    const movedRow = page
      .locator("tbody tr", { hasText: "机场快线站" })
      .filter({ hasText: "0#柴油" });
    const time = movedRow.locator(".time-input");
    await time.fill(eastTime);
    await time.dispatchEvent("change");

    await expect(page.getByTestId("violation-cross_plan_conflict").first()).toBeVisible();
    await expect(page.getByTestId("plan-submit")).toBeDisabled();

    // 撤回东区在审计划后，占用解除
    await page.getByTestId("plan-back").click();
    await page.getByTestId("plan-column-in_review").locator('[data-testid^="plan-card-"]').first().click();
    await page.getByTestId("plan-withdraw").click();
    await page.getByTestId("plan-back").click();
    await page.getByTestId("plan-column-draft").locator('[data-testid^="plan-card-"]').first().click();
    await expect(page.getByTestId("violation-cross_plan_conflict")).toHaveCount(0);
    await expect(page.getByTestId("plan-submit")).toBeEnabled();
  });

  test("跨标签页并发改派：后写方按版本处理，刷新后无重复班次", async ({ page, context }) => {
    await resetApp(page);
    await generatePlan(page, "东区");
    const stopRows = page.locator('[data-testid^="stop-row-"]');
    const stopCount = await stopRows.count();
    expect(stopCount).toBeGreaterThan(1);

    // 两个标签页打开同一草稿（storage 事件实时同步）
    const tab2 = await context.newPage();
    await tab2.goto("/");
    await tab2.getByTestId("tab-replenishment").click();
    await tab2.getByTestId("plan-column-draft").locator('[data-testid^="plan-card-"]').first().click();
    await expect(tab2.getByTestId("plan-status")).toHaveText("草稿");

    // 两个标签页几乎同时把“同一班次”改派到不同车辆 → 只有一方能提交版本
    const selectsA = page.locator('[data-testid^="shift-vehicle-"]');
    const selectsB = tab2.locator('[data-testid^="shift-vehicle-"]');
    const firstSelect = selectsA.nth(0);
    const currentVehicle = await firstSelect.inputValue();
    const gasolineIds = await gasolineOptionValues(page);
    const targets = gasolineIds.filter((v) => v !== currentVehicle);
    expect(targets.length).toBeGreaterThanOrEqual(2);
    const [targetA, targetB] = targets;

    await Promise.all([firstSelect.selectOption(targetA), selectsB.nth(0).selectOption(targetB)]);

    // 后写方必须收到“版本过期/已刷新”提示，不能静默覆盖
    const toastPattern = /版本|刷新/;
    const sawError = await Promise.race([
      page.getByTestId("toast", { hasText: toastPattern }).waitFor({ timeout: 4000 }).then(() => true).catch(() => false),
      tab2.getByTestId("toast", { hasText: toastPattern }).waitFor({ timeout: 4000 }).then(() => true).catch(() => false),
      page.waitForTimeout(4000).then(() => false)
    ]);
    expect(sawError).toBe(true);

    // 重新进入计划：恰好一次写入成功（rev=2），数据一致、无重复
    await openFirstDraft(page);
    await expect(page.locator(".plan-rev")).toHaveText("v2");
    await openFirstDraft(tab2);
    for (const p of [page, tab2]) {
      const keys = new Set<string>();
      const rows = await p.locator('[data-testid^="stop-row-"]').all();
      expect(rows.length).toBe(stopCount);
      for (const row of rows) {
        const cells = await row.locator("td").allInnerTexts();
        const key = `${cells[0]}|${cells[1]}`;
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    }
    await tab2.close();
  });
});

async function gasolineOptionValues(page: Page) {
  const first = page.locator('[data-testid^="shift-vehicle-"]').first();
  const options = first.locator("option", { hasText: "汽油" });
  const values: string[] = [];
  const total = await options.count();
  for (let i = 0; i < total; i++) {
    values.push((await options.nth(i).getAttribute("value"))!);
  }
  return values;
}

async function vehicleLabel(page: Page, vehicleId: string) {
  const option = page.locator(`[data-testid^="shift-vehicle-"] option[value="${vehicleId}"]`).first();
  const text = (await option.innerText()).trim();
  return text.split("（")[0];
}

async function openFirstDraft(page: Page) {
  await page.reload();
  await page.getByTestId("tab-replenishment").click();
  await page.getByTestId("plan-column-draft").locator('[data-testid^="plan-card-"]').first().click();
  await expect(page.getByTestId("plan-status")).toHaveText("草稿");
}

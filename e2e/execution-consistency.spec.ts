import { expect, test, type Page } from "@playwright/test";
import { generatePlan, resetApp, submitAndApprove } from "./helpers";

/** 读取顶部剩余缺口(L) */
async function remainingMetric(page: Page) {
  return Number((await page.getByTestId("metric-remaining").innerText()).replace("L", ""));
}

/** 回看表中指定站+油品行的「当前剩余缺口」与「未补足」 */
async function reviewGap(page: Page, station: string, product: string) {
  const row = page
    .locator(".review-table tbody tr")
    .filter({ hasText: station })
    .filter({ hasText: product });
  await expect(row).toHaveCount(1);
  const cells = row.locator("td");
  return {
    current: Number((await cells.nth(4).innerText()).trim()),
    unfilled: Number((await cells.nth(8).innerText()).trim())
  };
}

/** 第一个待执行站点任务信息 */
async function firstPendingStop(page: Page) {
  const button = page.locator('[data-testid^="stop-execute-"]').first();
  const row = button.locator("xpath=ancestor::tr");
  return {
    station: (await row.locator("td").nth(0).innerText()).trim(),
    product: (await row.locator("td").nth(1).innerText()).trim(),
    qty: Number(await row.locator(".qty-input").inputValue())
  };
}

/** 登记执行弹窗（按选项） */
async function executeFirst(page: Page, opts?: { shortfall?: number; reason?: string; note?: string }) {
  await page.locator('[data-testid^="stop-execute-"]').first().click();
  await expect(page.getByTestId("execute-dialog")).toBeVisible();
  if (opts) {
    if (opts.shortfall) {
      const v = Number(await page.getByTestId("exec-actual-qty").inputValue());
      await page.getByTestId("exec-actual-qty").fill(String(v - opts.shortfall));
    }
    if (opts.reason) await page.getByTestId("exec-diff-reason").selectOption(opts.reason);
    if (opts.note) await page.getByTestId("exec-diff-note").fill(opts.note);
  }
  await page.getByTestId("exec-confirm").click();
  await expect(page.getByTestId("execute-dialog")).toBeHidden();
}

/** 剩余所有站点按默认（足额）登记完 */
async function executeRestFull(page: Page) {
  while ((await page.locator('[data-testid^="stop-execute-"]:visible').count()) > 0) {
    await page.locator('[data-testid^="stop-execute-"]').first().click();
    await page.getByTestId("exec-confirm").click();
    await expect(page.getByTestId("execute-dialog")).toBeHidden();
  }
}

async function reopenPlanAfterReload(page: Page, column: "locked" | "completed") {
  await page.reload();
  await page.getByTestId("tab-replenishment").click();
  await page
    .getByTestId(`plan-column-${column}`)
    .locator('[data-testid^="plan-card-"]')
    .first()
    .click();
}

test.describe("执行登记：顶部剩余缺口与回看表未补足一致", () => {
  test("短收 → 两处同为短收量；足额/撤销/刷新后恢复", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");
    await submitAndApprove(page);

    // 执行前：未执行站点按计划量抵扣，剩余缺口为 0
    expect(await remainingMetric(page)).toBe(0);

    const stop = await firstPendingStop(page);
    const shortfall = 1000;

    // 1) 短收 1000L（运输损耗）
    await executeFirst(page, { shortfall, reason: "运输损耗", note: "路途损耗" });
    expect(await remainingMetric(page)).toBe(shortfall);
    let gaps = await reviewGap(page, stop.station, stop.product);
    expect(gaps.current).toBe(shortfall); // 当前剩余缺口
    expect(gaps.unfilled).toBe(shortfall); // 未补足
    await expect(page.getByTestId("metric-unmet-stations")).toHaveText("1");
    await expect(page.getByTestId("unmet-item").filter({ hasText: stop.station })).toContainText(
      String(shortfall)
    );

    // 2) 其余站点足额登记 → 计划完成；顶部总量与回看未补足总和仍为 1000
    await executeRestFull(page);
    await expect(page.getByTestId("plan-status")).toHaveText("已完成");
    expect(await remainingMetric(page)).toBe(shortfall);
    gaps = await reviewGap(page, stop.station, stop.product);
    expect(gaps.current).toBe(shortfall);
    expect(gaps.unfilled).toBe(shortfall);
    // 其他行未补足均为 0
    for (const li of await page.locator(".review-table tbody tr").all()) {
      const cells = li.locator("td");
      const station = (await cells.nth(0).innerText()).trim();
      const product = (await cells.nth(1).innerText()).trim();
      if (station === stop.station && product === stop.product) continue;
      expect(Number((await cells.nth(8).innerText()).trim())).toBe(0);
    }

    // 3) 刷新后恢复（实收/差异/缺口持久化）
    await reopenPlanAfterReload(page, "completed");
    await expect(page.getByTestId("plan-status")).toHaveText("已完成");
    expect(await remainingMetric(page)).toBe(shortfall);
    gaps = await reviewGap(page, stop.station, stop.product);
    expect(gaps.current).toBe(shortfall);
    expect(gaps.unfilled).toBe(shortfall);
    await expect(page.locator(".review-table")).toContainText("运输损耗");

    // 4) 撤销该站执行 → 恢复按计划量抵扣，两处缺口回到 0，计划回到已锁定
    await page.locator('[data-testid^="stop-undo-"]').first().click();
    await expect(page.getByTestId("plan-status")).toHaveText("已锁定");
    expect(await remainingMetric(page)).toBe(0);
    gaps = await reviewGap(page, stop.station, stop.product);
    expect(gaps.current).toBe(0);
    expect(gaps.unfilled).toBe(0);

    // 撤销后刷新仍为 0
    await reopenPlanAfterReload(page, "locked");
    expect(await remainingMetric(page)).toBe(0);
    gaps = await reviewGap(page, stop.station, stop.product);
    expect(gaps.current).toBe(0);
    expect(gaps.unfilled).toBe(0);

    // 5) 重新足额登记 → 再次完成，缺口仍为 0
    await executeRestFull(page);
    await expect(page.getByTestId("plan-status")).toHaveText("已完成");
    expect(await remainingMetric(page)).toBe(0);
    gaps = await reviewGap(page, stop.station, stop.product);
    expect(gaps.current).toBe(0);
    expect(gaps.unfilled).toBe(0);
  });
});

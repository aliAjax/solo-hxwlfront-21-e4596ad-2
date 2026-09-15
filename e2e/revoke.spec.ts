import { expect, test } from "@playwright/test";
import { executeAllStops, expectLog, generatePlan, resetApp, submitAndApprove } from "./helpers";

test.describe("撤销与改单", () => {
  test("待评审撤回 → 回到草稿，日志留痕", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");
    await page.getByTestId("plan-submit").click();
    await expect(page.getByTestId("plan-status")).toHaveText("待评审");
    await expect(page.getByTestId("plan-submit")).toHaveCount(0);

    await page.getByTestId("plan-withdraw").click();
    await expect(page.getByTestId("plan-status")).toHaveText("草稿");
    await expect(page.getByTestId("plan-submit")).toBeVisible();
    await expectLog(page, "撤回评审");

    // 撤回后仍可继续编辑
    const qty = page.locator('[data-testid^="stop-qty-"]').first();
    await expect(qty).toBeEnabled();
  });

  test("锁定改单 → 草稿；已有执行登记时禁止改单，撤销执行后可改单", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");
    await submitAndApprove(page);

    // 无执行登记：可直接改单
    await page.getByTestId("plan-reopen").click();
    await expect(page.getByTestId("plan-status")).toHaveText("草稿");
    await expectLog(page, "改单");

    // 再锁定，登记一个站点
    await submitAndApprove(page);
    const executeBtn = page.locator('[data-testid^="stop-execute-"]').first();
    await executeBtn.click();
    await page.getByTestId("exec-confirm").click();
    await expect(page.getByTestId("execute-dialog")).toBeHidden();

    // 已有登记：改单被拒绝（toast），状态仍为已锁定
    await page.getByTestId("plan-reopen").click();
    await expect(page.getByTestId("toast")).toContainText(/请先撤销执行|已锁定|不能/);
    await expect(page.getByTestId("plan-status")).toHaveText("已锁定");

    // 撤销执行登记后可改单
    await page.locator('[data-testid^="stop-undo-"]').first().click();
    await expect(page.getByTestId("toast")).toContainText("已撤销执行登记");
    await page.getByTestId("plan-reopen").click();
    await expect(page.getByTestId("plan-status")).toHaveText("草稿");
    await expectLog(page, "撤销执行登记");
  });

  test("全部执行完成后撤销一笔 → 计划回到已锁定，可再次登记", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "机场线");
    await submitAndApprove(page);
    await executeAllStops(page, { reason: "足额", note: "" });
    await expect(page.getByTestId("plan-status")).toHaveText("已完成");

    // 完成后“改单”入口不存在
    await expect(page.getByTestId("plan-reopen")).toHaveCount(0);

    await page.locator('[data-testid^="stop-undo-"]').first().click();
    await expect(page.getByTestId("plan-status")).toHaveText("已锁定");
    await expect(page.locator('[data-testid^="stop-execute-"]:visible')).toHaveCount(1);

    // 再次登记后重新完成
    await page.locator('[data-testid^="stop-execute-"]').first().click();
    await page.getByTestId("exec-confirm").click();
    await expect(page.getByTestId("plan-status")).toHaveText("已完成");
  });
});

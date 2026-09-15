import { expect, test } from "@playwright/test";
import { backToList, executeAllStops, expectLog, generatePlan, resetApp, submitAndApprove } from "./helpers";

test.describe("正常流：生成 → 调整 → 评审锁定 → 执行登记 → 回看", () => {
  test("东区计划完整闭环", async ({ page }) => {
    await resetApp(page);
    await generatePlan(page, "东区");

    // 缺口驱动：东区高优先级站库存紧张，必然生成多班次且无未满足（车队容量充足）
    await expect(page.getByTestId("metric-pending")).toHaveText(/[1-9]/);
    await expect(page.getByTestId("metric-unmet-stations")).toHaveText("0");
    await expect(page.getByTestId("metric-planned")).not.toHaveText("0L");

    // 实时重算：剩余缺口 = 生成缺口 - 已安排
    const plannedText = await page.getByTestId("metric-planned").innerText();
    const planned = Number(plannedText.replace("L", ""));
    expect(planned).toBeGreaterThan(0);
    await expect(page.getByTestId("metric-remaining")).toHaveText("0L");

    // 草稿 -> 待评审 -> 锁定
    await submitAndApprove(page);
    await expectLog(page, "评审通过并锁定");

    // 锁定后编辑控件不可用
    await expect(page.locator('[data-testid^="stop-qty-"]').first()).toBeDisabled();

    // 执行登记：第一站登记运输损耗（少 1000L），其余足额
    const executed = await executeAllStops(page, {
      shortfall: 1000,
      reason: "运输损耗",
      note: "E2E 运输损耗 1000L"
    });
    expect(executed).toBeGreaterThanOrEqual(8);

    // 全部执行后计划自动完成
    await expect(page.getByTestId("plan-status")).toHaveText("已完成");
    await expectLog(page, "计划完成");
    await expectLog(page, "登记实收");

    // 回看：至少一条差异记录带损耗原因
    await expect(page.getByTestId("review-table")).toContainText("运输损耗");

    // 完成计划出现在列表的已完成列
    await backToList(page);
    await expect(page.getByTestId("plan-column-completed")).toContainText("BH-");
  });
});

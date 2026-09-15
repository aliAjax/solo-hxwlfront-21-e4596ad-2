import { expect, type Page } from "@playwright/test";

export const STORAGE_KEYS = [
  "hxwlfront-21-station-map",
  "hxwlfront-21-scheduling-profile",
  "hxwlfront-21-scheduling-vehicles",
  "hxwlfront-21-scheduling-plans"
];

export async function resetApp(page: Page) {
  // 先打开再清理，避免 addInitScript 在后续 reload 时把持久化数据再次清掉
  await page.goto("/");
  await page.evaluate((keys) => {
    for (const key of keys) localStorage.removeItem(key);
  }, STORAGE_KEYS);
  await page.reload();
}

export async function openReplenishment(page: Page) {
  await page.getByTestId("tab-replenishment").click();
  await expect(page.getByTestId("replenish-view")).toBeVisible();
}

/** 在主页生成建议并进入计划详情 */
export async function generatePlan(page: Page, area: string, date?: string) {
  await openReplenishment(page);
  await page.getByTestId("create-area").selectOption(area);
  if (date) await page.getByTestId("create-date").fill(date);
  await page.getByTestId("create-generate").click();
  await expect(page.getByTestId("plan-status")).toHaveText("草稿");
}

export async function backToList(page: Page) {
  await page.getByTestId("plan-back").click();
  await expect(page.getByTestId("create-panel")).toBeVisible();
}

export async function submitAndApprove(page: Page) {
  await page.getByTestId("plan-submit").click();
  await expect(page.getByTestId("plan-status")).toHaveText("待评审");
  await page.getByTestId("plan-approve").click();
  await expect(page.getByTestId("plan-status")).toHaveText("已锁定");
}

/** 登记所有待执行 stop；第一个可指定短少（计划量 - shortfall）与差异原因 */
export async function executeAllStops(
  page: Page,
  firstShortfall?: { shortfall?: number; reason: string; note: string }
) {
  let index = 0;
  while ((await page.locator('[data-testid^="stop-execute-"]:visible').count()) > 0) {
    const button = page.locator('[data-testid^="stop-execute-"]:visible').first();
    const row = button.locator("xpath=ancestor::tr");
    const planned = Number((await row.locator(".qty-input").inputValue()) || "0");
    await button.click();
    const dialog = page.getByTestId("execute-dialog");
    await expect(dialog).toBeVisible();
    if (index === 0 && firstShortfall) {
      const actual = Math.max(0, planned - (firstShortfall.shortfall ?? 0));
      await page.getByTestId("exec-actual-qty").fill(String(actual));
      await page.getByTestId("exec-diff-reason").selectOption(firstShortfall.reason);
      await page.getByTestId("exec-diff-note").fill(firstShortfall.note);
    }
    await page.getByTestId("exec-confirm").click();
    await expect(dialog).toBeHidden();
    index++;
  }
  return index;
}

export async function expectLog(page: Page, action: string) {
  await expect(page.getByTestId("log-entry").filter({ hasText: action }).first()).toBeVisible();
}

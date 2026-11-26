import { expect, type Page } from '@playwright/test'

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 打开统一模型选择器并选中指定模型；选项名可能带“默认”或短 ID 后缀。 */
export async function chooseModel(page: Page, model: { name: string }, label = '模型来源') {
  const trigger = page.getByRole('combobox', { name: label })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await page.getByRole('option', { name: new RegExp(`^${escapeRegExp(model.name)}(?: · |$)`) }).first().click()
  return trigger
}

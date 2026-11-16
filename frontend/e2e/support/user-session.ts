import { expect, type Page } from '@playwright/test'

export const USER = {
  username: 'e2e-user',
  password: 'isolated-e2e-user-password',
}

export async function loginOrCreateUser(page: Page) {
  const registered = await page.request.post('/api/user/register', { data: USER })
  if (registered.ok()) {
    expect(registered.status()).toBe(201)
    return
  }
  expect(registered.status()).toBe(409)
  const loggedIn = await page.request.post('/api/user/login', { data: USER })
  expect(loggedIn.ok()).toBeTruthy()
}

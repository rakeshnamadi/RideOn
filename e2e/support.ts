import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/** Seeded development accounts (see apps/api/prisma/seed.ts). All share this password. */
export const DEMO_PASSWORD = 'Demo@12345';
export const ACCOUNTS = {
  superAdmin: '9000000001',
  kmHead: '9000000002',
  kmAdmin: '9000000003',
  kmApprover: '9000000004',
  reporter: '9000000006',
  inHead: '9000000005',
  driver1: '9000000010',
  driver2: '9000000011',
  passenger: '9000000020',
  passenger2: '9000000021',
} as const;

export const API = 'http://localhost:4100/api/v1';

export async function signIn(page: Page, phone: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Mobile number or email').fill(phone);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A fresh, isolated browser session signed in as the given account. */
export async function sessionFor(browser: Browser, phone: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, phone);
  return { context, page };
}

/** Click a point on a Leaflet map, offset in pixels from the map's centre. */
export async function clickMap(page: Page, mapLabel: string, dx = 0, dy = 0) {
  const map = page.getByRole('region', { name: mapLabel });
  await expect(map).toBeVisible();
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

export async function communityId(request: APIRequestContext, namePrefix: string) {
  const res = await request.get(`${API}/communities`);
  const list = (await res.json()).data as { id: string; name: string }[];
  const c = list.find((x) => x.name.startsWith(namePrefix));
  if (!c) throw new Error(`Community ${namePrefix} not found`);
  return c.id;
}

/** A unique valid Indian mobile number for registration tests. */
export function freshPhone() {
  return `7${String(Date.now()).slice(-9)}`;
}

import { expect, test } from '@playwright/test';
import { ACCOUNTS, communityId, sessionFor } from '../support';

/** Required E2E workflows 8–10: isolation between communities and platform oversight. */
test.describe('role boundaries', () => {
  test("a community admin cannot open another community's console", async ({ browser, request }) => {
    const km = await communityId(request, 'Koramangala');
    const { page, context } = await sessionFor(browser, ACCOUNTS.inHead);
    await expect(page).toHaveURL(/\/community\//);
    await page.goto(`/community/${km}/drivers`);
    await expect(page.getByRole('heading', { name: 'Not authorised' })).toBeVisible();
    await expect(page.getByText('You are not an administrator of this community.')).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Not authorised' })).toBeVisible();
    await context.close();
  });

  test('a passenger cannot open the community or platform consoles', async ({ browser, request }) => {
    const km = await communityId(request, 'Koramangala');
    const { page, context } = await sessionFor(browser, ACCOUNTS.passenger);
    for (const path of [`/community/${km}`, '/admin', '/driver']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Not authorised' })).toBeVisible();
    }
    await context.close();
  });

  test('the super admin inspects platform-wide operations', async ({ browser }) => {
    const { page, context } = await sessionFor(browser, ACCOUNTS.superAdmin);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
    await expect(page.getByText('Active communities')).toBeVisible();
    await page.getByRole('link', { name: 'Communities', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Koramangala Auto Drivers Association' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Indiranagar Auto Union' })).toBeVisible();
    await page.getByRole('link', { name: 'Bookings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All bookings' })).toBeVisible();
    await expect(page.getByText(/RO-SEED/).first()).toBeVisible();
    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByText('Append-only. Updates and deletions are blocked by the database.')).toBeVisible();
    await context.close();
  });
});

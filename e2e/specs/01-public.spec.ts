import { expect, test } from '@playwright/test';

test.describe('public pages (no account)', () => {
  test('landing page carries the positioning, both promises and a live example fare', async ({ page }) => {
    await page.goto('/');
    const hero = page.getByRole('heading', { level: 1 });
    await expect(hero).toContainText('Your city.');
    await expect(hero).toContainText('Your people.');
    await expect(hero).toContainText('Your ride.');
    await expect(page.getByRole('heading', { name: 'The freedom to travel your way' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Respect for the people who move your city' })).toBeVisible();

    // The example trip is priced by the real fare engine, and the driver card shows real fees.
    const trip = page.getByRole('figure', { name: 'Your trip' });
    await expect(trip).toContainText(/₹\d+/);
    const earnings = page.getByRole('figure', { name: 'What the driver sees' });
    await expect(earnings).toContainText(/Platform fee \(\d+(\.\d+)?%\)/);
    await expect(earnings).toContainText(/You keep\s*₹[\d.]+/);
  });

  test('header anchor scrolls to the driver section', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'For drivers' }).click();
    await expect(page).toHaveURL(/#drivers$/);
    await expect(page.getByRole('heading', { name: 'Respect for the people who move your city' })).toBeInViewport();
  });

  test('published fares and shared routes are browsable without signing in', async ({ page }) => {
    await page.goto('/fares');
    await page.getByRole('button', { name: /Koramangala Auto Drivers Association/ }).click();
    await expect(page.getByRole('heading', { name: 'Regular auto fare' })).toBeVisible();
    await expect(page.getByText('₹30 for the first 2.0 km')).toBeVisible();
    await expect(page.getByRole('heading', { name: /KM-1/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Route KM-1' })).toBeVisible();
    await expect(page.getByText(/OpenStreetMap/).first()).toBeVisible();
  });

  test('the site can be read in Hindi', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Language').selectOption('hi');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('आपका शहर।');
    await expect(page.getByRole('heading', { name: 'अपने तरीके से सफ़र करने की आज़ादी' })).toBeVisible();
    await page.getByLabel('Language').selectOption('en');
  });

  test('protected pages send visitors to sign in and back again', async ({ page }) => {
    await page.goto('/app/bookings');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fbookings/);
    await page.getByLabel('Mobile number or email').fill('9000000020');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-1');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect phone/email or password');
    await page.getByLabel('Password', { exact: true }).fill('Demo@12345');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/bookings$/);
  });
});

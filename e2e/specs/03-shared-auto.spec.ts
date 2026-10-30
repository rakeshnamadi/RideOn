import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from '../support';

/** Required E2E workflow 3: a passenger books seats on a scheduled shared auto. */
test('a passenger holds and confirms a seat on a scheduled shared auto', async ({ page }) => {
  await signIn(page, ACCOUNTS.passenger);
  await page.getByRole('link', { name: 'Shared autos' }).first().click();
  await expect(page.getByRole('heading', { name: 'Shared autos' })).toBeVisible();

  const departures = page.getByRole('radiogroup', { name: 'Departure' }).getByRole('radio');
  await expect(departures.first()).toBeVisible();
  await expect(departures.first()).toContainText(/seats left/);
  await departures.first().click();

  await expect(page.getByText(/per seat · ₹\d+ total/)).toBeVisible();
  await page.getByRole('button', { name: /Hold seats · 1 seat/ }).click();

  await expect(page).toHaveURL(/\/app\/bookings\/[a-z0-9]+$/);
  await expect(page.getByText(/Seats held until/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText('Seats confirmed')).toBeVisible();
  await expect(page.getByText('Confirmed').first()).toBeVisible();
  await expect(page.locator('[aria-label^="PIN "]')).toBeVisible();
  await expect(page.getByText(/1 \(seat \d\)/)).toBeVisible();
});

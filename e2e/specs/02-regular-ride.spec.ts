import { expect, test } from '@playwright/test';
import { ACCOUNTS, clickMap, freshPhone, sessionFor } from '../support';

/**
 * Required E2E workflows 1 and 2, in two real browser sessions:
 * a new passenger registers and books a regular auto; a driver goes online,
 * accepts it, starts it with the passenger's PIN, completes it and records cash.
 */
test('a new passenger books a regular auto and a driver completes the trip', async ({ browser, page }) => {
  // ── Driver goes online at a manually placed location inside Ainavilli ──
  const driver = await sessionFor(browser, ACCOUNTS.driver1);
  await expect(driver.page).toHaveURL(/\/driver$/);
  await expect(driver.page.getByText('Respect for the people who move your city')).toBeVisible();
  await driver.page.getByLabel('Set on the map').check();
  await clickMap(driver.page, 'Set your location', 30, -30); // off-centre: a stand's pin sits at the centre
  await driver.page.getByRole('button', { name: 'Go online' }).click();
  await expect(driver.page.getByRole('heading', { name: 'Trip requests' })).toBeVisible();
  await expect(driver.page.getByText('Waiting for requests')).toBeVisible();

  // ── Passenger registers ──
  await page.goto('/register');
  await expect(page.getByText('The freedom to travel your way')).toBeVisible();
  await page.getByLabel('Full name').fill('Ananya Iyer');
  await page.getByLabel('Mobile number', { exact: true }).fill(freshPhone());
  await page.getByLabel('Password', { exact: true }).fill('Ride-safely-2026');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Where are you going?' })).toBeVisible();

  // ── Passenger picks pickup and destination on the map and gets a server quote ──
  await clickMap(page, 'Choose pickup and destination');
  await expect(page.getByLabel('Pickup', { exact: true })).not.toHaveValue('');
  await clickMap(page, 'Choose pickup and destination', -90, 110);
  await expect(page.getByLabel('Destination', { exact: true })).not.toHaveValue('');
  await page.getByRole('button', { name: 'See fare' }).click();
  const book = page.getByRole('button', { name: /^Book auto · ₹\d+/ });
  await expect(book).toBeVisible();
  await expect(page.getByText('Served by Ainavilli Auto Drivers Union')).toBeVisible();
  await book.click();

  await expect(page).toHaveURL(/\/app\/bookings\/[a-z0-9]+$/);
  const pinLabel = await page.locator('[aria-label^="PIN "]').getAttribute('aria-label');
  const pin = pinLabel!.replace(/\D/g, '');
  expect(pin).toMatch(/^\d{4}$/);

  // ── Driver receives the offer and runs the trip ──
  await driver.page.getByRole('button', { name: 'Accept' }).click({ timeout: 30_000 });
  await expect(driver.page.getByText(/Current trip/)).toBeVisible();
  await expect(page.getByText('Driver on the way').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('AP05TA1234')).toBeVisible();

  await driver.page.getByRole('button', { name: 'I have arrived' }).click();
  await expect(page.getByText('Driver has arrived').first()).toBeVisible({ timeout: 30_000 });

  // A wrong PIN is refused; the passenger's PIN starts the trip.
  await driver.page.getByLabel('Passenger’s start PIN').fill(pin === '0000' ? '1111' : '0000');
  await driver.page.getByRole('button', { name: 'Start trip' }).click();
  await expect(driver.page.getByText('Incorrect start PIN')).toBeVisible();
  await driver.page.getByLabel('Passenger’s start PIN').fill(pin);
  await driver.page.getByRole('button', { name: 'Start trip' }).click();
  await driver.page.getByRole('button', { name: 'Complete trip' }).click();
  await driver.page.getByRole('button', { name: 'Cash received' }).click();
  await expect(driver.page.getByText('Cash payment recorded')).toBeVisible();

  // ── Passenger sees the completed, paid trip and rates the driver ──
  await expect(page.getByText('Completed').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Paid')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('radio', { name: '5 stars' }).click();
  await page.getByRole('button', { name: 'Submit rating' }).click();
  await expect(page.getByText('Thanks for rating your driver')).toBeVisible();

  // ── Driver's earnings show the trip with its deductions ──
  await driver.page.getByRole('link', { name: 'Earnings' }).click();
  await expect(driver.page.getByText('Every rupee of every trip: the fare, each fee, and what you keep.')).toBeVisible();
  await driver.page.getByRole('link', { name: 'Today' }).click();
  await driver.page.getByRole('button', { name: 'Go offline' }).click();
  await expect(driver.page.getByText('You are offline. Location sharing stopped.')).toBeVisible();
  await driver.context.close();
});

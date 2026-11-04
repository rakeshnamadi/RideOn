import { expect, test } from '@playwright/test';
import { ACCOUNTS, communityId, sessionFor } from '../support';

// 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.describe('union administration', () => {
  test('a local admin sets the union’s name, logo and contact details, and the public sees them', async ({ browser, request }) => {
    const av = await communityId(request, 'Ainavilli');
    const { page, context } = await sessionFor(browser, ACCOUNTS.kmHead);
    await page.goto(`/community/${av}/profile`);
    await page.getByLabel('Tagline').fill('Our village, our autos');
    await page.getByLabel('Pincode').fill('533211');
    await page.getByRole('button', { name: 'Save union details' }).click();
    await expect(page.getByText('Union details saved')).toBeVisible();
    await page.getByLabel('Union logo file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('Logo updated')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

    await page.goto('/fares');
    const union = page.getByRole('button', { name: /Ainavilli Auto Drivers Union/ });
    const logo = union.locator('img');
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await context.close();
  });

  test('a local admin delegates a role, and the delegate sees only what it allows', async ({ browser, request }) => {
    const av = await communityId(request, 'Ainavilli');
    const admin = await sessionFor(browser, ACCOUNTS.kmHead);
    await admin.page.goto(`/community/${av}/team`);
    await admin.page.getByLabel('Mobile number of a registered person').fill(ACCOUNTS.passenger2);
    // Local admins can only hand out the roles below them.
    await expect(admin.page.getByLabel('Role').locator('option')).toHaveText(['Reporter', 'Approver', 'Operator']);
    await admin.page.getByLabel('Role').selectOption({ label: 'Operator' });
    await admin.page.getByRole('button', { name: 'Assign role' }).click();
    const row = admin.page.getByRole('row', { name: /Teja Varma/ });
    await expect(row.getByRole('cell', { name: 'Operator' })).toBeVisible();

    // Add one permission on top of the role.
    await row.getByRole('button', { name: 'Edit access' }).click();
    const dialog = admin.page.getByRole('dialog');
    await dialog.getByLabel(/Choose individual permissions/).check();
    await dialog.getByLabel('Publish announcements').check();
    await dialog.getByRole('button', { name: 'Save access' }).click();
    await expect(row.getByText('Custom')).toBeVisible();
    await admin.context.close();

    const delegate = await sessionFor(browser, ACCOUNTS.passenger2);
    await delegate.page.goto(`/community/${av}`);
    const nav = delegate.page.getByRole('navigation', { name: 'Union console navigation' });
    await expect(nav.getByRole('link', { name: 'Live queue' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Announcements' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Team & permissions' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await delegate.context.close();
  });

  test('a reporter prepares and publishes a report', async ({ browser, request }) => {
    const av = await communityId(request, 'Ainavilli');
    const { page, context } = await sessionFor(browser, ACCOUNTS.reporter);
    await page.goto(`/community/${av}/reports`);
    await page.getByRole('button', { name: 'New report' }).click();
    await page.getByRole('dialog').getByLabel('Title').fill('E2E members’ meeting');
    await page.getByRole('dialog').getByRole('button', { name: 'Prepare report' }).click();
    await expect(page.getByText('Completed trips')).toBeVisible();
    await page.getByLabel('Notes').fill('Evening demand is up.');
    await page.getByRole('button', { name: 'Save notes' }).click();
    await expect(page.getByText('Notes saved')).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Report published')).toBeVisible();
    // Published reports cannot be refreshed or deleted.
    await expect(page.getByRole('button', { name: 'Refresh figures' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await context.close();
  });

  test('a driver gives feedback on the union’s fare, and the union replies', async ({ browser, request }) => {
    const av = await communityId(request, 'Ainavilli');
    const driver = await sessionFor(browser, ACCOUNTS.driver2);
    await driver.page.getByRole('link', { name: 'Fares & feedback' }).click();
    await expect(driver.page.getByRole('heading', { name: 'Current fares' })).toBeVisible();
    await driver.page.getByRole('button', { name: 'Too low' }).click();
    await driver.page.getByLabel('Per km you suggest (₹)').fill('19');
    await driver.page.getByLabel('Tell your union why').fill('Lanka road trips come back empty');
    await driver.page.getByRole('button', { name: 'Send to my union' }).click();
    await expect(driver.page.getByText('Sent to your union')).toBeVisible();
    await expect(driver.page.getByText('Lanka road trips come back empty')).toBeVisible();

    const admin = await sessionFor(browser, ACCOUNTS.kmHead);
    await admin.page.goto(`/community/${av}/feedback`);
    const item = admin.page.locator('section, div').filter({ hasText: 'Lanka road trips come back empty' }).filter({ has: admin.page.getByRole('button', { name: 'Reply' }) }).last();
    await expect(item.getByText('Suggests ₹19/km')).toBeVisible();
    await item.getByRole('button', { name: 'Reply' }).click();
    await admin.page.getByRole('dialog').getByLabel(/Your reply/).fill('We will raise this at the next meeting');
    await admin.page.getByRole('dialog').getByRole('button', { name: 'Send reply' }).click();
    await expect(admin.page.getByText('Reply sent to the driver')).toBeVisible();
    await admin.context.close();

    await driver.page.reload();
    await expect(driver.page.getByText('We will raise this at the next meeting')).toBeVisible();
    await driver.context.close();
  });

  test('the super admin assigns a union role and reads the activity log', async ({ browser }) => {
    const { page, context } = await sessionFor(browser, ACCOUNTS.superAdmin);
    await page.getByRole('link', { name: 'Users & roles' }).click();
    await page.getByLabel('Search name, phone or email').fill(ACCOUNTS.passenger);
    const row = page.getByRole('row', { name: /Sravani Kotipalli/ });
    await row.getByRole('button', { name: 'Manage roles' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Union', { exact: true }).selectOption({ label: 'Amalapuram Town Auto Union' });
    await dialog.getByLabel('Role', { exact: true }).selectOption({ label: 'Reporter' });
    await dialog.getByRole('button', { name: 'Assign union role' }).click();
    await expect(page.getByText('Union role assigned')).toBeVisible();
    await expect(dialog.getByText('Reporter · Amalapuram Town Auto Union')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Union role removed')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('link', { name: 'Activity log' }).click();
    await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Asha Rao' }).first()).toBeVisible();
    await context.close();
  });

  test('passengers can use the site in Telugu', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Language').selectOption({ label: 'తెలుగు' });
    await expect(page.getByText('ఆటో బుక్ చేయండి').first()).toBeVisible();
  });
});

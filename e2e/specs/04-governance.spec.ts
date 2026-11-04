import { expect, test } from '@playwright/test';
import { ACCOUNTS, communityId, sessionFor } from '../support';

/**
 * Required E2E workflows 5–7, through the community console:
 * an admin creates a route and proposes a rule change; an authorised approver approves it.
 */
test.describe('community governance', () => {
  test('a community admin creates a shared route with ordered stops', async ({ browser, request }) => {
    const km = await communityId(request, 'Ainavilli');
    const { page, context } = await sessionFor(browser, ACCOUNTS.kmAdmin);
    await page.goto(`/community/${km}/routes`);
    await page.getByRole('button', { name: 'New route' }).click();
    const dialog = page.getByRole('dialog', { name: 'New shared route' });
    await dialog.getByLabel('Code').fill('KM-E2E');
    await dialog.getByLabel('Name', { exact: true }).fill('Muktheswaram → Pothukurru (E2E)');
    const stops = dialog.getByLabel('Stop', { exact: true });
    await stops.nth(0).selectOption({ label: 'Muktheswaram Stand' });
    await stops.nth(1).selectOption({ label: 'Pothukurru' });
    await dialog.getByRole('button', { name: 'Create route' }).click();
    await expect(page.getByText('Route created as a draft')).toBeVisible();
    await expect(page.getByRole('heading', { name: /KM-E2E/ })).toBeVisible();
    await context.close();
  });

  test('rule changes need an approver: admin proposes, approver approves', async ({ browser, request }) => {
    const km = await communityId(request, 'Ainavilli');

    // Admin proposes a higher cancellation fee.
    const admin = await sessionFor(browser, ACCOUNTS.kmAdmin);
    await admin.page.goto(`/community/${km}/settings`);
    const rules = admin.page.getByRole('region', { name: 'Governance rules' }).or(admin.page.locator('section', { hasText: 'Governance rules' }));
    await expect(rules.first()).toContainText('₹20');
    await admin.page.getByRole('button', { name: 'Propose a rule change' }).click();
    const dialog = admin.page.getByRole('dialog', { name: 'Propose a rule change' });
    await dialog.getByPlaceholder('e.g. Longer free cancellation window').fill('Raise late cancellation fee to ₹25');
    await dialog.getByLabel('Cancellation fee (₹)').fill('25');
    await dialog.getByRole('button', { name: 'Send to approvers' }).click();
    await expect(admin.page.getByText('Proposal sent to your approvers')).toBeVisible();

    // The proposer cannot approve it themselves.
    await admin.page.getByRole('link', { name: 'Fares & governance' }).click();
    await expect(admin.page.getByText('Cancellation fee: ₹20 → ₹25')).toBeVisible();
    await expect(admin.page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await admin.context.close();

    // The approver approves; the rule takes effect.
    const approver = await sessionFor(browser, ACCOUNTS.kmApprover);
    await approver.page.goto(`/community/${km}/fares`);
    await expect(approver.page.getByText('Cancellation fee: ₹20 → ₹25')).toBeVisible();
    await approver.page.getByRole('button', { name: 'Approve' }).click();
    await expect(approver.page.getByText('Approved — the change is now in effect')).toBeVisible();
    await approver.page.getByRole('link', { name: 'Settings' }).click();
    await expect(approver.page.locator('dd', { hasText: '₹25' })).toBeVisible();
    await approver.context.close();
  });
});

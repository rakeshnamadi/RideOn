import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ErrorState } from '@/components/ui';
import { ApiError, tokenStore } from '@/services/api';
import { mockApi, passengerMe, renderApp } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  tokenStore.set(null);
});

describe('route guards', () => {
  it('sends anonymous visitors to sign in, remembering where they were going', async () => {
    mockApi((url) => (url.endsWith('/auth/refresh') ? { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'no session' } } } : undefined));
    const router = renderApp('/app/bookings');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fapp%2Fbookings');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('blocks a passenger from the platform admin console', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { data: { accessToken: 't' } } };
      if (url.endsWith('/auth/me')) return { status: 200, body: { data: passengerMe } };
      return { status: 200, body: { data: [] } };
    });
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Not authorised' })).toBeInTheDocument();
  });

  it('blocks a community admin from a community they do not administer', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { data: { accessToken: 't' } } };
      if (url.endsWith('/auth/me')) {
        return { status: 200, body: { data: { ...passengerMe, roles: ['COMMUNITY_ADMIN'], communities: [{ id: 'mine', name: 'Mine', slug: 'mine', status: 'ACTIVE', role: 'HEAD', permissions: [] }] } } };
      }
      return { status: 200, body: { data: [] } };
    });
    renderApp('/community/someone-else');
    expect(await screen.findByText('You are not an administrator of this community.')).toBeInTheDocument();
  });
});

describe('sign in', () => {
  it('validates input before calling the API', async () => {
    const fetchMock = mockApi((url) => (url.endsWith('/auth/refresh') ? { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'x' } } } : undefined));
    renderApp('/login');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your mobile number or email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/login'))).toHaveLength(0);
  });

  it('shows the server error when credentials are wrong', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'x' } } };
      if (url.endsWith('/auth/login')) return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Incorrect phone/email or password' } } };
      return undefined;
    });
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Mobile number or email'), '9000000020');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect phone/email or password')).toBeInTheDocument();
  });

  it('signs a passenger in and lands on the booking screen', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/refresh')) return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'x' } } };
      if (url.endsWith('/auth/login')) return { status: 200, body: { data: { accessToken: 'abc', userId: 'u1' } } };
      if (url.endsWith('/auth/me')) return { status: 200, body: { data: passengerMe } };
      if (url.includes('/config')) return { status: 200, body: { data: { paymentMethods: ['CASH'], mockPayments: false } } };
      return { status: 200, body: { data: [] } };
    });
    const router = renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Mobile number or email'), '9000000020');
    await user.type(screen.getByLabelText('Password'), 'Demo@12345');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'));
    expect(await screen.findByRole('heading', { name: 'Where are you going?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See fare' })).toBeDisabled();
  });
});

describe('registration', () => {
  it('requires a valid Indian mobile number, a strong password and consent', async () => {
    mockApi((url) => (url.endsWith('/auth/refresh') ? { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'x' } } } : undefined));
    renderApp('/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Mobile number'), '12345');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid 10-digit mobile number')).toBeInTheDocument();
    expect(screen.getByText('At least 10 characters')).toBeInTheDocument();
    expect(screen.getByText('Please accept to continue')).toBeInTheDocument();
  });
});

describe('error states', () => {
  it('shows an actionable message with the request reference and a retry', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(409, 'BOOKING_TAKEN', 'This booking is no longer available', undefined, 'req-42')} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This booking is no longer available');
    expect(screen.getByText('Reference: req-42')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

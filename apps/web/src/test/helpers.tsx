import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '@/app/auth';
import { routes } from '@/app/router';
import { ToastProvider } from '@/components/ui/toast';
import { I18nProvider } from '@/i18n';

type Handler = (url: string, init?: RequestInit) => { status: number; body?: unknown } | undefined;

/** Replace fetch with a small router of canned API responses. Unmatched calls return 404. */
export function mockApi(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const res = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not mocked' } } };
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return router;
}

export const passengerMe = {
  id: 'u1',
  name: 'Priya Nair',
  phone: '+919000000020',
  email: null,
  preferredLanguage: 'en',
  trustedContactName: null,
  trustedContactPhone: null,
  roles: ['PASSENGER'],
  permissions: ['booking.create'],
  communities: [],
  driver: null,
};

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, tokenStore } from '@/services/api';
import { mockApi } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  tokenStore.set(null);
});

describe('API client', () => {
  it('sends the access token and the CSRF header', async () => {
    tokenStore.set('token-1');
    const fetchMock = mockApi(() => ({ status: 200, body: { data: { ok: true } } }));
    await api.get('/auth/me');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('rideon');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    tokenStore.set('expired');
    const fetchMock = mockApi((url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (url.endsWith('/auth/refresh')) return { status: 200, body: { data: { accessToken: 'fresh' } } };
      if (auth === 'Bearer fresh') return { status: 200, body: { data: [1, 2, 3] } };
      return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } };
    });
    const res = await api.get<number[]>('/bookings');
    expect(res.data).toEqual([1, 2, 3]);
    expect(tokenStore.get()).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('notifies the app when the session cannot be refreshed', async () => {
    const lost = vi.fn();
    tokenStore.onLost(lost);
    mockApi(() => ({ status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'no' } } }));
    await expect(api.get('/bookings')).rejects.toBeInstanceOf(ApiError);
    expect(lost).toHaveBeenCalled();
  });

  it('surfaces server validation details as field errors', async () => {
    mockApi(() => ({ status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Validation failed', details: [{ path: 'phone', message: 'Invalid' }], requestId: 'req-1' } } }));
    const err = (await api.post('/auth/register', {}).catch((e) => e)) as ApiError;
    expect(err.status).toBe(400);
    expect(err.fieldErrors).toEqual([{ path: 'phone', message: 'Invalid' }]);
    expect(err.requestId).toBe('req-1');
  });

  it('reports network failures clearly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = (await api.get('/health').catch((e) => e)) as ApiError;
    expect(err.code).toBe('NETWORK');
    expect(err.message).toMatch(/Cannot reach the server/);
  });
});

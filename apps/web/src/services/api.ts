/**
 * API client. The access token lives only in memory (never localStorage); the refresh
 * token is an http-only cookie the browser sends to /api/v1/auth. A 401 triggers a single
 * shared refresh attempt and one retry.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public requestId?: string,
  ) {
    super(message);
  }

  /** Field-level validation messages, if any. */
  get fieldErrors(): { path: string; message: string }[] {
    return Array.isArray(this.details) && this.details.every((d) => typeof d === 'object' && d && 'message' in d)
      ? (this.details as { path: string; message: string }[])
      : [];
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: Record<string, unknown> & { page?: number; pageSize?: number; total?: number; totalPages?: number };
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onAuthLost: (() => void) | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
  onLost: (cb: () => void) => {
    onAuthLost = cb;
  },
};

export async function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'rideon' },
      });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const body = (await res.json()) as { data: { accessToken: string } };
      accessToken = body.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function buildUrl(path: string, query?: Query) {
  const url = `/api/v1${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function request<T>(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Query; form?: FormData; retry?: boolean } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'X-Requested-With': 'rideon' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }

  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/')) {
    if (await refreshAccessToken()) return request<T>(method, path, { ...opts, retry: false });
    onAuthLost?.();
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : null;
  if (!res.ok) {
    const e = payload?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? `Request failed (${res.status})`, e.details, e.requestId);
  }
  return payload as ApiResult<T>;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
};

/** Download an authenticated file (CSV, documents) without exposing the token in a URL. */
export async function downloadFile(path: string, query: Query, filename: string) {
  const go = () => fetch(buildUrl(path, query), { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await go();
  if (res.status === 401 && (await refreshAccessToken())) res = await go();
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function openPrivateFile(path: string) {
  const go = () => fetch(buildUrl(path), { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  let res = await go();
  if (res.status === 401 && (await refreshAccessToken())) res = await go();
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', res.status === 403 ? 'You are not allowed to view this file' : 'Could not open file');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Idempotency key for a single user intent (reused across retries of the same submit). */
export function newIdempotencyKey() {
  return `web-${crypto.randomUUID()}`;
}

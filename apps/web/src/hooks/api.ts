import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api, type ApiResult } from '@/services/api';
import { useToast } from '@/components/ui/toast';

type Query = Record<string, string | number | boolean | undefined | null>;

/** GET helper returning the unwrapped `data` (and `meta` via the second form). */
export function useApi<T>(key: QueryKey, path: string | null, query?: Query, opts: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...key, query],
    queryFn: async () => (await api.get<T>(path!, query)).data,
    enabled: path !== null && opts.enabled !== false,
    refetchInterval: opts.refetchInterval,
  });
}

export function useApiPage<T>(key: QueryKey, path: string, query?: Query) {
  return useQuery({
    queryKey: [...key, query],
    queryFn: async () => api.get<T[]>(path, query) as Promise<ApiResult<T[]>>,
    placeholderData: (prev) => prev,
  });
}

/**
 * Mutation that toasts the outcome and invalidates the listed query keys.
 * Server responses are authoritative — the UI never assumes success.
 */
export function useAction<TVars = void, TRes = unknown>(
  fn: (vars: TVars) => Promise<ApiResult<TRes>>,
  opts: { success?: string | ((res: TRes) => string); invalidate?: QueryKey[]; onSuccess?: (res: TRes) => void; onSettled?: () => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (vars: TVars) => (await fn(vars)).data,
    onSuccess: (res) => {
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(res) : opts.success);
      opts.onSuccess?.(res);
    },
    onSettled: () => opts.onSettled?.(),
    onError: (err) => {
      if (!opts.silentError) toast.error(err);
    },
  });
}

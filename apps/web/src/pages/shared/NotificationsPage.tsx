import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, cx, EmptyState, PageHeader, Pagination, Spinner, ErrorState } from '@/components/ui';
import { useAction, useApiPage } from '@/hooks/api';
import { api } from '@/services/api';
import { dateTime } from '@/utils/format';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const q = useApiPage<Notification>(['notifications', 'list'], '/notifications', { page });
  const readAll = useAction(() => api.post('/notifications/read-all'), { invalidate: [['notifications']] });
  const read = useAction((id: string) => api.post(`/notifications/${id}/read`), { invalidate: [['notifications']], silentError: true });
  return (
    <div>
      <PageHeader title="Notifications" actions={<Button variant="secondary" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}>Mark all read</Button>} />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No notifications yet" />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-100">
            {q.data.data.map((n) => (
              <li key={n.id} className={cx('flex items-start gap-3 py-3', !n.readAt && 'font-medium')}>
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-label={n.readAt ? undefined : 'Unread'} />
                <div className="flex-1">
                  <p>{n.link ? <Link to={n.link} onClick={() => read.mutate(n.id)} className="hover:underline">{n.title}</Link> : n.title}</p>
                  {n.body && <p className="text-sm font-normal text-stone-600">{n.body}</p>}
                  <p className="text-xs font-normal text-stone-400">{dateTime(n.createdAt)}</p>
                </div>
                {!n.readAt && <Button variant="ghost" size="sm" onClick={() => read.mutate(n.id)}>Mark read</Button>}
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={Number(q.data.meta?.totalPages ?? 1)} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}

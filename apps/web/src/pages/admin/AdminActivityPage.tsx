import { Download } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, DataTable, ErrorState, Input, PageHeader, Pagination, QueryState, Select, Spinner, Stat } from '@/components/ui';
import { useApi, useApiPage } from '@/hooks/api';
import { downloadFile } from '@/services/api';
import { dateTime } from '@/utils/format';

interface Row {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  ipAddress: string | null;
}
interface Summary {
  windowHours: number;
  total: number;
  clientErrors: number;
  serverErrors: number;
  activeUsers: number;
  busiest: { method: string; path: string; count: number }[];
  topUsers: { userId: string; userName: string | null; count: number }[];
  retentionDays: number;
}

const statusTone = (s: number) => (s >= 500 ? 'red' : s >= 400 ? 'amber' : 'green');

/** Every request the website handled, stored in the local database. */
export default function AdminActivityPage() {
  const [page, setPage] = useState(1);
  const [path, setPath] = useState('');
  const [method, setMethod] = useState('');
  const [outcome, setOutcome] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const filters = {
    path,
    method,
    outcome,
    from: from ? new Date(`${from}T00:00:00+05:30`).toISOString() : undefined,
    to: to ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000).toISOString() : undefined,
  };
  const summary = useApi<Summary>(['admin', 'activity', 'summary'], '/admin/activity/summary', undefined, { refetchInterval: 60_000 });
  const q = useApiPage<Row>(['admin', 'activity', 'list'], '/admin/activity', { ...filters, page });
  const filter = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    set(e.target.value);
    setPage(1);
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity log"
        subtitle={`Who did what on the website, kept in the local database for ${summary.data?.retentionDays ?? 90} days. Decisions are also kept permanently in the audit log.`}
        actions={<Button variant="secondary" icon={<Download className="size-4" />} onClick={() => void downloadFile('/admin/activity/export.csv', filters, 'rideon-activity.csv')}>Export CSV</Button>}
      />
      <QueryState query={summary}>
        {(s) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={`Requests (last ${s.windowHours} h)`} value={s.total} />
              <Stat label="People active" value={s.activeUsers} tone="good" />
              <Stat label="Refused or invalid" value={s.clientErrors} hint="4xx responses" />
              <Stat label="Server errors" value={s.serverErrors} hint="5xx responses" tone={s.serverErrors ? 'warn' : 'default'} />
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <Card title="Busiest pages and actions">
                <DataTable rows={s.busiest} rowKey={(r) => r.method + r.path} empty="Nothing yet" columns={[{ header: 'Request', cell: (r) => <span className="break-all font-mono text-xs">{r.method} {r.path}</span> }, { header: 'Count', cell: (r) => r.count }]} />
              </Card>
              <Card title="Most active people">
                <DataTable rows={s.topUsers} rowKey={(r) => r.userId} empty="Nothing yet" columns={[{ header: 'Person', cell: (r) => r.userName ?? r.userId }, { header: 'Requests', cell: (r) => r.count }]} />
              </Card>
            </div>
          </>
        )}
      </QueryState>
      <Card title="All activity">
        <div className="mb-4 flex flex-wrap gap-3">
          <Input label="Address contains" value={path} onChange={filter(setPath)} placeholder="/fares" />
          <Select label="Type" value={method} onChange={filter(setMethod)} options={[{ value: '', label: 'All' }, ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))]} />
          <Select label="Result" value={outcome} onChange={filter(setOutcome)} options={[{ value: '', label: 'All' }, { value: 'success', label: 'Succeeded' }, { value: 'client_error', label: 'Refused or invalid' }, { value: 'server_error', label: 'Server error' }]} />
          <Input label="From" type="date" value={from} onChange={filter(setFrom)} />
          <Input label="To" type="date" value={to} onChange={filter(setTo)} />
        </div>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorState error={q.error} /> : (
          <>
            <DataTable
              rows={q.data?.data ?? []}
              rowKey={(r) => r.id}
              empty="No matching activity"
              columns={[
                { header: 'When', cell: (r) => <span className="whitespace-nowrap text-xs">{dateTime(r.createdAt)}</span> },
                { header: 'Who', cell: (r) => r.userName ?? <span className="text-muted">Not signed in</span> },
                { header: 'Request', cell: (r) => <span className="break-all font-mono text-xs">{r.method} {r.path}</span> },
                { header: 'Result', cell: (r) => <Badge tone={statusTone(r.statusCode)}>{r.statusCode}</Badge> },
                { header: 'Took', cell: (r) => <span className="text-xs">{r.durationMs} ms</span> },
                { header: 'IP', cell: (r) => <span className="text-xs">{r.ipAddress ?? '—'}</span> },
              ]}
            />
            <Pagination page={page} totalPages={Number(q.data?.meta?.totalPages ?? 1)} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

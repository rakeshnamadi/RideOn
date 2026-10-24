import { useState } from 'react';
import { Button, DataTable } from '@/components/ui';
import { dateTime, humanize } from '@/utils/format';

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorRole: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor: { name: string } | null;
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty="No entries"
      columns={[
        { header: 'When', cell: (r) => <span className="whitespace-nowrap">{dateTime(r.createdAt)}</span> },
        { header: 'Who', cell: (r) => <>{r.actor?.name ?? 'System'}<p className="text-xs text-stone-500">{humanize(r.actorRole)}</p></> },
        { header: 'Action', cell: (r) => <code className="text-xs">{r.action}</code> },
        { header: 'Record', cell: (r) => <span className="text-xs">{r.entityType} {r.entityId?.slice(-8)}</span> },
        {
          header: 'Details',
          cell: (r) =>
            r.before || r.after ? (
              open === r.id ? (
                <div className="max-w-md space-y-1">
                  {r.before ? <pre className="overflow-x-auto rounded bg-red-50 p-2 text-[11px]">{JSON.stringify(r.before, null, 1)}</pre> : null}
                  {r.after ? <pre className="overflow-x-auto rounded bg-emerald-50 p-2 text-[11px]">{JSON.stringify(r.after, null, 1)}</pre> : null}
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Hide</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setOpen(r.id)}>Show</Button>
              )
            ) : (
              '—'
            ),
        },
      ]}
    />
  );
}

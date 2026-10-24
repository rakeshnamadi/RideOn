import { useState } from 'react';
import { Button, Card, ConfirmDialog, DataTable, PageHeader, QueryState, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import { date, humanize } from '@/utils/format';

interface Membership {
  id: string;
  status: string;
  applicationNote: string | null;
  decisionNote: string | null;
  createdAt: string;
  driver: {
    id: string;
    licenseNumber: string;
    licenseExpiry: string;
    verificationStatus: string;
    status: string;
    ratingSum: number;
    ratingCount: number;
    user: { name: string; phone: string };
    documents: { id: string; type: string; status: string }[];
  };
}

type Decision = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE';

export default function MembersPage() {
  const { id } = useCommunity();
  const [tab, setTab] = useState<'APPLIED' | 'APPROVED' | 'SUSPENDED' | 'REJECTED'>('APPLIED');
  const q = useApi<Membership[]>(['community', id, 'memberships', tab], `/communities/${id}/memberships`, { status: tab });
  const [pending, setPending] = useState<{ m: Membership; decision: Decision } | null>(null);
  const [note, setNote] = useState('');
  const decide = useAction(() => api.post(`/communities/${id}/memberships/${pending!.m.id}/decision`, { decision: pending!.decision, note: note || undefined }), {
    invalidate: [['community', id]],
    success: 'Decision recorded',
    onSuccess: () => {
      setPending(null);
      setNote('');
    },
  });
  const needsReason = pending && ['REJECT', 'SUSPEND'].includes(pending.decision);

  return (
    <div>
      <PageHeader title="Membership" subtitle="Driver applications and the community roster. Every decision is recorded in the decision history." />
      <Tabs value={tab} onChange={setTab} options={[{ value: 'APPLIED', label: 'Applications' }, { value: 'APPROVED', label: 'Members' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'REJECTED', label: 'Rejected' }]} />
      <Card>
        <QueryState query={q}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="No drivers in this list"
              columns={[
                { header: 'Driver', cell: (r) => <><p className="font-medium">{r.driver.user.name}</p><p className="text-xs text-stone-500">{r.driver.user.phone}</p></> },
                { header: 'Licence', cell: (r) => <><p>{r.driver.licenseNumber}</p><p className="text-xs text-stone-500">valid to {date(r.driver.licenseExpiry)}</p></> },
                { header: 'Platform verification', cell: (r) => <StatusBadge status={r.driver.verificationStatus} /> },
                { header: 'Documents', cell: (r) => <span className="text-xs">{r.driver.documents.map((d) => `${humanize(d.type)}: ${d.status.toLowerCase()}`).join(' · ') || 'None'}</span> },
                { header: 'Note', cell: (r) => <span className="text-sm text-stone-600">{r.decisionNote ?? r.applicationNote ?? '—'}</span> },
                {
                  header: 'Actions',
                  cell: (r) => (
                    <div className="flex flex-wrap gap-1">
                      {r.status === 'APPLIED' && <><Button size="sm" onClick={() => setPending({ m: r, decision: 'APPROVE' })}>Approve</Button><Button size="sm" variant="secondary" onClick={() => setPending({ m: r, decision: 'REJECT' })}>Reject</Button></>}
                      {r.status === 'APPROVED' && <Button size="sm" variant="secondary" onClick={() => setPending({ m: r, decision: 'SUSPEND' })}>Suspend</Button>}
                      {r.status === 'SUSPENDED' && <Button size="sm" onClick={() => setPending({ m: r, decision: 'REINSTATE' })}>Reinstate</Button>}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      </Card>
      <ConfirmDialog
        open={!!pending}
        title={pending ? `${humanize(pending.decision)} ${pending.m.driver.user.name}?` : ''}
        tone={pending?.decision === 'APPROVE' || pending?.decision === 'REINSTATE' ? 'primary' : 'danger'}
        confirmLabel={pending ? humanize(pending.decision) : ''}
        loading={decide.isPending}
        onClose={() => setPending(null)}
        onConfirm={() => decide.mutate()}
        message={pending?.decision === 'APPROVE' ? 'The driver can go online once platform verification and their vehicle are approved.' : pending?.decision === 'SUSPEND' ? 'The driver is taken offline immediately and notified. They can appeal.' : 'The driver is notified of this decision.'}
      >
        <Textarea label={needsReason ? 'Reason (required)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

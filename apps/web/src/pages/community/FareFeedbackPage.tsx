import { useState } from 'react';
import { Badge, Button, Card, Modal, PageHeader, QueryState, Select, Stat, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { useAction, useApiPage } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import { dateTime, humanize, inr } from '@/utils/format';

interface Feedback {
  id: string;
  serviceType: 'REGULAR' | 'SHARED';
  routeCode: string | null;
  sentiment: 'TOO_LOW' | 'FAIR' | 'TOO_HIGH';
  suggestedBaseFarePaise: number | null;
  suggestedPerKmPaise: number | null;
  suggestedPerSeatPaise: number | null;
  comment: string;
  status: string;
  response: string | null;
  createdAt: string;
  driver: { user: { name: string } };
}
interface Summary {
  bySentiment: { serviceType: string; sentiment: string; count: number }[];
  averageSuggestion: { baseFarePaise: number | null; perKmPaise: number | null; perSeatPaise: number | null };
}

const SENTIMENT_TONE = { TOO_LOW: 'amber', FAIR: 'green', TOO_HIGH: 'red' } as const;

function suggestion(f: Feedback) {
  const parts = [
    f.suggestedBaseFarePaise !== null && `Base ${inr(f.suggestedBaseFarePaise)}`,
    f.suggestedPerKmPaise !== null && `${inr(f.suggestedPerKmPaise)}/km`,
    f.suggestedPerSeatPaise !== null && `${inr(f.suggestedPerSeatPaise)}/seat`,
  ].filter(Boolean);
  return parts.length ? `Suggests ${parts.join(' · ')}` : null;
}

/** What drivers think of the fares this union has fixed, with a reply to each. */
export default function FareFeedbackPage() {
  const { id } = useCommunity();
  const [tab, setTab] = useState<'' | 'OPEN' | 'ACKNOWLEDGED' | 'ADOPTED' | 'DECLINED'>('');
  const q = useApiPage<Feedback>(['community', id, 'feedback', tab], `/fare-feedback/communities/${id}`, { status: tab });
  const [replying, setReplying] = useState<Feedback | null>(null);
  const [status, setStatus] = useState('ACKNOWLEDGED');
  const [response, setResponse] = useState('');
  const reply = useAction(() => api.patch(`/fare-feedback/${replying!.id}`, { status, response }), {
    invalidate: [['community', id, 'feedback']],
    success: 'Reply sent to the driver',
    onSuccess: () => { setReplying(null); setResponse(''); },
  });
  const summary = q.data?.meta?.summary as Summary | undefined;
  const count = (sentiment: string) => (summary?.bySentiment ?? []).filter((s) => s.sentiment === sentiment).reduce((n, s) => n + s.count, 0);
  const avg = summary?.averageSuggestion;

  return (
    <div className="space-y-5">
      <PageHeader title="Driver feedback on fares" subtitle="Drivers tell you how the fares you fixed are working. Reply to each one; use it when you next propose a fare." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Fare too low" value={count('TOO_LOW')} hint="Open feedback" tone={count('TOO_LOW') ? 'warn' : 'default'} />
        <Stat label="Fare is fair" value={count('FAIR')} hint="Open feedback" tone="good" />
        <Stat label="Fare too high" value={count('TOO_HIGH')} hint="Open feedback" />
        <Stat label="Average suggestion" value={avg?.perKmPaise ? `${inr(avg.perKmPaise)}/km` : avg?.baseFarePaise ? inr(avg.baseFarePaise) : '—'} hint={avg?.baseFarePaise && avg.perKmPaise ? `Base ${inr(avg.baseFarePaise)}` : avg?.perSeatPaise ? `${inr(avg.perSeatPaise)}/seat` : 'From drivers’ suggestions'} />
      </div>
      <Tabs value={tab} onChange={setTab} options={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'ACKNOWLEDGED', label: 'Acknowledged' }, { value: 'ADOPTED', label: 'Adopted' }, { value: 'DECLINED', label: 'Declined' }]} />
      <QueryState query={{ data: q.data?.data, isLoading: q.isLoading, error: q.error, refetch: q.refetch }} empty={(d) => d.length === 0 && <p className="text-sm text-muted">No feedback here yet.</p>}>
        {(rows) => (
          <div className="space-y-3">
            {rows.map((f) => (
              <Card key={f.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SENTIMENT_TONE[f.sentiment]}>{humanize(f.sentiment)}</Badge>
                  <span className="text-sm font-medium">{f.driver.user.name}</span>
                  <span className="text-xs text-muted">{f.serviceType === 'SHARED' ? `Shared · ${f.routeCode ?? 'route'}` : 'Regular auto'} · {dateTime(f.createdAt)}</span>
                  <span className="ml-auto"><StatusBadge status={f.status} /></span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{f.comment}</p>
                {suggestion(f) && <p className="mt-1 text-sm font-medium text-brand-700">{suggestion(f)}</p>}
                {f.response && <p className="mt-2 rounded-lg bg-sand/50 p-2 text-sm"><span className="font-medium">Your reply:</span> {f.response}</p>}
                <div className="mt-3">
                  <Button size="sm" variant="secondary" onClick={() => { setReplying(f); setStatus(f.status === 'OPEN' ? 'ACKNOWLEDGED' : f.status); setResponse(f.response ?? ''); }}>{f.response ? 'Change reply' : 'Reply'}</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
      <Modal open={!!replying} onClose={() => setReplying(null)} title={`Reply to ${replying?.driver.user.name ?? ''}`} footer={<Button disabled={response.trim().length < 3} loading={reply.isPending} onClick={() => reply.mutate()}>Send reply</Button>}>
        <div className="space-y-3">
          <p className="rounded-lg bg-sand/50 p-2 text-sm">{replying?.comment}</p>
          <Select label="Outcome" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'ACKNOWLEDGED', label: 'Acknowledged: we are looking at it' }, { value: 'ADOPTED', label: 'Adopted: it will shape our next fare' }, { value: 'DECLINED', label: 'Declined' }]} />
          <Textarea label="Your reply (the driver sees this)" value={response} onChange={(e) => setResponse(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}

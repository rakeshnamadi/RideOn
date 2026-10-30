import { useState } from 'react';
import { Badge, Button, Card, PageHeader, QueryState, StatusBadge, Textarea, EmptyState } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { api } from '@/services/api';
import { dateTime, inr } from '@/utils/format';
import { PolicyChangeSummary } from '@/features/governance/PolicyChangeSummary';

interface Review {
  id: string;
  type: 'FARE_CHANGE' | 'POLICY_CHANGE';
  policyChanges: Record<string, unknown> | null;
  policyBefore: Record<string, unknown> | null;
  title: string;
  rationale: string | null;
  status: string;
  requiredApprovals: number;
  platformDecision: string | null;
  platformReviewNote: string | null;
  effectiveFrom: string;
  community: { id: string; name: string };
  proposedBy: { name: string };
  votes: { decision: string; voter: { name: string } }[];
  fareProposal: { serviceType: string; baseFarePaise: number; baseDistanceMeters: number; perKmPaise: number; minimumFarePaise: number; perSeatPaise: number; perStopPaise: number; nightSurchargeBps: number } | null;
}

export default function AdminFareReviewsPage() {
  const q = useApi<Review[]>(['admin', 'fare-reviews'], '/fares/reviews');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decide = useAction(({ id, decision }: { id: string; decision: string }) => api.post<{ status: string }>(`/fares/reviews/${id}`, { decision, note: notes[id] || undefined }), {
    invalidate: [['admin']],
    success: (r) => (r.status === 'APPLIED' ? 'Approved and published' : r.status === 'REJECTED' ? 'Rejected' : 'Approved — waiting for community approvals'),
  });
  return (
    <div>
      <PageHeader title="Governance reviews" subtitle="Fare and rule proposals that need platform review — large fare increases, or communities that opted into platform review. Community votes still apply." />
      <QueryState query={q} empty={(d) => d.length === 0 && <EmptyState title="No proposals need platform review" />}>
        {(list) => (
          <div className="space-y-4">
            {list.map((p) => {
              const f = p.fareProposal;
              const approvals = p.votes.filter((v) => v.decision === 'APPROVE').length;
              const pending = p.status === 'PENDING' && !p.platformDecision;
              return (
                <Card key={p.id} title={<span className="flex flex-wrap items-center gap-2">{p.title} <StatusBadge status={p.status} /></span>}>
                  <p className="text-sm text-stone-600">{p.community.name} · proposed by {p.proposedBy.name} · effective {dateTime(p.effectiveFrom)}</p>
                  {f && (
                    <p className="mt-1 text-sm">
                      <Badge>{f.serviceType}</Badge>{' '}
                      {f.serviceType === 'REGULAR' ? `Base ${inr(f.baseFarePaise)}/${(f.baseDistanceMeters / 1000).toFixed(1)} km, ${inr(f.perKmPaise)}/km, min ${inr(f.minimumFarePaise)}, night +${f.nightSurchargeBps / 100}%` : `Seat ${inr(f.perSeatPaise)} + ${inr(f.perStopPaise)}/stop`}
                    </p>
                  )}
                  {p.type === 'POLICY_CHANGE' && <PolicyChangeSummary changes={p.policyChanges} before={p.policyBefore} />}
                  {p.rationale && <p className="mt-1 text-sm text-stone-600">“{p.rationale}”</p>}
                  <p className="mt-1 text-xs text-stone-500">Community approvals {approvals}/{p.requiredApprovals} · platform: {p.platformDecision?.toLowerCase() ?? 'pending'}</p>
                  {p.platformReviewNote && <p className="text-xs text-stone-500">Note: {p.platformReviewNote}</p>}
                  {pending && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <Textarea label="Review note" className="min-w-64 flex-1" value={notes[p.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))} />
                      <Button onClick={() => decide.mutate({ id: p.id, decision: 'APPROVED' })} loading={decide.isPending}>Approve</Button>
                      <Button variant="danger" onClick={() => decide.mutate({ id: p.id, decision: 'REJECTED' })} loading={decide.isPending}>Reject</Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </QueryState>
    </div>
  );
}

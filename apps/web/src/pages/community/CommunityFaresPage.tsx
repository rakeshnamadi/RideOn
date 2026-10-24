import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/app/auth';
import { Alert, Badge, Button, Card, DataTable, Input, Modal, PageHeader, QueryState, Select, StatusBadge, Textarea, Tabs } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import type { FareRule } from '@/types';
import { dateTime, humanize, inr, rupeesToPaise } from '@/utils/format';
import { FareRuleSummary } from '@/features/fares/FareRuleSummary';

interface Proposal {
  id: string;
  title: string;
  rationale: string | null;
  status: string;
  requiredApprovals: number;
  requiresPlatformReview: boolean;
  platformDecision: string | null;
  platformReviewNote: string | null;
  effectiveFrom: string;
  createdAt: string;
  proposedBy: { id: string; name: string };
  votes: { decision: string; comment: string | null; voter: { id: string; name: string } }[];
  fareProposal: (Omit<FareRule, 'id' | 'version' | 'effectiveFrom' | 'effectiveTo'> & { previousFareRuleId: string | null }) | null;
}
interface Policy {
  fareApprovalMode: string;
  requiredApprovals: number;
  allowSelfApproval: boolean;
  maxFareIncreasePercent: number;
  minNoticeHours: number;
}
interface Fares {
  regular: FareRule | null;
  shared: { route: { id: string; code: string; name: string }; rule: FareRule }[];
  upcoming: FareRule[];
}

const rupees = z.coerce.number().min(0).max(10_000);
const ProposalSchema = z.object({
  serviceType: z.enum(['REGULAR', 'SHARED']),
  sharedRouteId: z.string().optional(),
  title: z.string().trim().min(5, 'At least 5 characters'),
  rationale: z.string().trim().optional(),
  effectiveFrom: z.string().min(1, 'Required'),
  baseFare: rupees,
  baseDistanceKm: z.coerce.number().min(0).max(20),
  perKm: rupees,
  minimumFare: rupees,
  waitingPerMinute: rupees,
  freeWaitingMinutes: z.coerce.number().int().min(0).max(30),
  perSeat: rupees,
  perStop: rupees,
  nightSurchargePercent: z.coerce.number().min(0).max(100),
  nightStartHour: z.coerce.number().int().min(0).max(23),
  nightEndHour: z.coerce.number().int().min(0).max(23),
});
type ProposalValues = z.infer<typeof ProposalSchema>;

function localInput(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function ProposalForm({ fares, routes, policy, onDone }: { fares: Fares; routes: { id: string; code: string; name: string }[]; policy: Policy; onDone: () => void }) {
  const { id } = useCommunity();
  const r = fares.regular;
  const form = useForm<ProposalValues>({
    resolver: zodResolver(ProposalSchema),
    defaultValues: {
      serviceType: 'REGULAR',
      effectiveFrom: localInput(new Date(Date.now() + Math.max(policy.minNoticeHours, 1) * 3_600_000)),
      baseFare: (r?.baseFarePaise ?? 3000) / 100,
      baseDistanceKm: (r?.baseDistanceMeters ?? 2000) / 1000,
      perKm: (r?.perKmPaise ?? 1500) / 100,
      minimumFare: (r?.minimumFarePaise ?? 3000) / 100,
      waitingPerMinute: (r?.waitingPerMinutePaise ?? 50) / 100,
      freeWaitingMinutes: r?.freeWaitingMinutes ?? 5,
      perSeat: 20,
      perStop: 5,
      nightSurchargePercent: (r?.nightSurchargeBps ?? 0) / 100,
      nightStartHour: r?.nightStartHour ?? 22,
      nightEndHour: r?.nightEndHour ?? 5,
    },
  });
  const type = form.watch('serviceType');
  const submit = useAction(
    (v: ProposalValues) =>
      api.post<{ requiresPlatformReview: boolean; validation: { maxIncreasePercent: number } }>(`/fares/communities/${id}/proposals`, {
        serviceType: v.serviceType,
        sharedRouteId: v.serviceType === 'SHARED' ? v.sharedRouteId : null,
        title: v.title,
        rationale: v.rationale || undefined,
        effectiveFrom: new Date(v.effectiveFrom).toISOString(),
        baseFarePaise: rupeesToPaise(v.baseFare),
        baseDistanceMeters: Math.round(v.baseDistanceKm * 1000),
        perKmPaise: rupeesToPaise(v.perKm),
        minimumFarePaise: rupeesToPaise(v.minimumFare),
        waitingPerMinutePaise: rupeesToPaise(v.waitingPerMinute),
        freeWaitingMinutes: v.freeWaitingMinutes,
        perSeatPaise: v.serviceType === 'SHARED' ? rupeesToPaise(v.perSeat) : 0,
        perStopPaise: v.serviceType === 'SHARED' ? rupeesToPaise(v.perStop) : 0,
        nightSurchargeBps: Math.round(v.nightSurchargePercent * 100),
        nightStartHour: v.nightStartHour,
        nightEndHour: v.nightEndHour,
      }),
    {
      invalidate: [['community', id]],
      success: (res) => (res.requiresPlatformReview ? `Proposal submitted. The ${res.validation.maxIncreasePercent}% increase also needs platform review.` : 'Proposal submitted for approval'),
      onSuccess: onDone,
    },
  );
  const e = form.formState.errors;
  return (
    <form className="space-y-3" onSubmit={form.handleSubmit((v) => submit.mutate(v))} noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Service" {...form.register('serviceType')} options={[{ value: 'REGULAR', label: 'Regular auto' }, { value: 'SHARED', label: 'Shared route' }]} />
        {type === 'SHARED' && <Select label="Route" {...form.register('sharedRouteId')} options={[{ value: '', label: 'Choose…' }, ...routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))]} />}
        <Input className="sm:col-span-2" label="Title" {...form.register('title')} error={e.title?.message} />
        <Textarea className="sm:col-span-2" label="Rationale" {...form.register('rationale')} />
        <Input label="Effective from" type="datetime-local" {...form.register('effectiveFrom')} error={e.effectiveFrom?.message} hint={policy.minNoticeHours ? `At least ${policy.minNoticeHours} h notice` : undefined} />
        {type === 'REGULAR' ? (
          <>
            <Input label="Base fare (₹)" type="number" step="0.5" {...form.register('baseFare')} />
            <Input label="Base distance (km)" type="number" step="0.1" {...form.register('baseDistanceKm')} />
            <Input label="Per km after (₹)" type="number" step="0.5" {...form.register('perKm')} />
            <Input label="Minimum fare (₹)" type="number" step="0.5" {...form.register('minimumFare')} />
            <Input label="Waiting per minute (₹)" type="number" step="0.5" {...form.register('waitingPerMinute')} />
            <Input label="Free waiting (min)" type="number" {...form.register('freeWaitingMinutes')} />
          </>
        ) : (
          <>
            <Input label="Per seat (₹)" type="number" step="0.5" {...form.register('perSeat')} />
            <Input label="Each extra stop (₹)" type="number" step="0.5" {...form.register('perStop')} />
            <Input label="Minimum per seat (₹)" type="number" step="0.5" {...form.register('minimumFare')} />
          </>
        )}
        <Input label="Night surcharge (%)" type="number" {...form.register('nightSurchargePercent')} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Night from (hour)" type="number" {...form.register('nightStartHour')} />
          <Input label="Night to (hour)" type="number" {...form.register('nightEndHour')} />
        </div>
      </div>
      <Alert tone="info">
        Approval: {humanize(policy.fareApprovalMode)} ({policy.requiredApprovals} approval{policy.requiredApprovals > 1 ? 's' : ''}). Increases above {policy.maxFareIncreasePercent}% also need platform review. Fares above regulatory caps are rejected.
      </Alert>
      <Button type="submit" loading={submit.isPending}>Submit proposal</Button>
    </form>
  );
}

function ProposalSummary({ p }: { p: Proposal }) {
  const f = p.fareProposal;
  if (!f) return null;
  return (
    <p className="text-sm text-stone-700">
      {f.serviceType === 'REGULAR'
        ? `Base ${inr(f.baseFarePaise)} for ${(f.baseDistanceMeters / 1000).toFixed(1)} km, then ${inr(f.perKmPaise)}/km · min ${inr(f.minimumFarePaise)} · night +${f.nightSurchargeBps / 100}%`
        : `Seat ${inr(f.perSeatPaise)} + ${inr(f.perStopPaise)}/extra stop · min ${inr(f.minimumFarePaise)}`}
    </p>
  );
}

export default function CommunityFaresPage() {
  const { id, can } = useCommunity();
  const { me } = useAuth();
  const fares = useApi<Fares>(['community', id, 'fares'], `/fares/communities/${id}`);
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const proposals = useApi<Proposal[]>(['community', id, 'proposals', tab], `/fares/communities/${id}/proposals`, tab === 'PENDING' ? { status: 'PENDING' } : undefined);
  const policy = useApi<Policy>(['community', id, 'policy'], `/communities/${id}/policy`);
  const routes = useApi<{ id: string; code: string; name: string }[]>(['community', id, 'routes'], `/communities/${id}/routes`);
  const history = useApi<{ id: string; createdAt: string; effectiveFrom: string; serviceType: string; summary: Record<string, unknown> }[]>(['community', id, 'fare-history'], `/fares/communities/${id}/history`);
  const [creating, setCreating] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});
  const vote = useAction(({ pid, decision }: { pid: string; decision: string }) => api.post<{ status: string }>(`/fares/proposals/${pid}/votes`, { decision, comment: comments[pid] || undefined }), {
    invalidate: [['community', id]],
    success: (r) => (r.status === 'APPLIED' ? 'Approved — the new fare is published' : r.status === 'REJECTED' ? 'Proposal rejected' : 'Vote recorded'),
  });
  const withdraw = useAction((pid: string) => api.post(`/fares/proposals/${pid}/withdraw`), { invalidate: [['community', id]], success: 'Proposal withdrawn' });

  return (
    <div className="space-y-5">
      <PageHeader title="Fares & governance" subtitle="Fares change only through proposals approved under this community's policy." actions={can('fares.propose') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)} disabled={!fares.data || !policy.data}>Propose a change</Button>} />
      <QueryState query={fares}>
        {(f) => (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Regular auto — current">{f.regular ? <FareRuleSummary rule={f.regular} /> : <p className="text-sm text-stone-600">No regular fare published.</p>}</Card>
            <Card title="Shared routes — current">
              {f.shared.length === 0 ? <p className="text-sm text-stone-600">No shared fares published.</p> : f.shared.map((s) => (
                <div key={s.route.id} className="mb-3">
                  <p className="mb-1 font-medium"><Badge tone="blue">{s.route.code}</Badge> {s.route.name}</p>
                  <FareRuleSummary rule={s.rule} />
                </div>
              ))}
            </Card>
            {f.upcoming.length > 0 && <Alert tone="warn">Scheduled fare change{f.upcoming.length > 1 ? 's' : ''}: {f.upcoming.map((u) => `${u.serviceType.toLowerCase()} v${u.version} from ${dateTime(u.effectiveFrom)}`).join('; ')}</Alert>}
          </div>
        )}
      </QueryState>

      <Card title="Proposals">
        <Tabs value={tab} onChange={setTab} options={[{ value: 'PENDING', label: 'Open' }, { value: 'ALL', label: 'All' }]} />
        <QueryState query={proposals} empty={(d) => d.length === 0 && <p className="text-sm text-stone-600">No proposals.</p>}>
          {(list) => (
            <ul className="space-y-4">
              {list.map((p) => {
                const approvals = p.votes.filter((v) => v.decision === 'APPROVE').length;
                const voted = p.votes.some((v) => v.voter.id === me?.id);
                const own = p.proposedBy.id === me?.id;
                return (
                  <li key={p.id} className="rounded-lg p-4 ring-1 ring-stone-200">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{p.title}</p>
                      <StatusBadge status={p.status} />
                      <Badge>{p.fareProposal?.serviceType === 'SHARED' ? 'Shared' : 'Regular'}</Badge>
                      {p.requiresPlatformReview && <Badge tone={p.platformDecision === 'APPROVED' ? 'green' : p.platformDecision === 'REJECTED' ? 'red' : 'amber'}>Platform review: {p.platformDecision?.toLowerCase() ?? 'pending'}</Badge>}
                    </div>
                    <ProposalSummary p={p} />
                    {p.rationale && <p className="mt-1 text-sm text-stone-600">{p.rationale}</p>}
                    <p className="mt-1 text-xs text-stone-500">By {p.proposedBy.name} · effective {dateTime(p.effectiveFrom)} · approvals {approvals}/{p.requiredApprovals}</p>
                    {p.votes.length > 0 && <ul className="mt-2 text-xs text-stone-600">{p.votes.map((v, i) => <li key={i}>{v.voter.name}: {v.decision.toLowerCase()}{v.comment ? ` — “${v.comment}”` : ''}</li>)}</ul>}
                    {p.platformReviewNote && <p className="mt-1 text-xs text-stone-600">Platform note: {p.platformReviewNote}</p>}
                    {p.status === 'PENDING' && (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        {can('fares.approve') && !voted && !(own && !policy.data?.allowSelfApproval) && (
                          <>
                            <Input label="Comment" className="min-w-56 flex-1" value={comments[p.id] ?? ''} onChange={(e) => setComments((c) => ({ ...c, [p.id]: e.target.value }))} />
                            <Button size="sm" loading={vote.isPending} onClick={() => vote.mutate({ pid: p.id, decision: 'APPROVE' })}>Approve</Button>
                            <Button size="sm" variant="danger" loading={vote.isPending} onClick={() => vote.mutate({ pid: p.id, decision: 'REJECT' })}>Reject</Button>
                          </>
                        )}
                        {own && !policy.data?.allowSelfApproval && can('fares.approve') && <span className="text-xs text-stone-500">You cannot approve your own proposal.</span>}
                        {voted && <span className="text-xs text-stone-500">You have voted.</span>}
                        {own && <Button size="sm" variant="ghost" onClick={() => withdraw.mutate(p.id)}>Withdraw</Button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </Card>

      <Card title="Fare revision history (public, append-only)">
        <QueryState query={history}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="No fare changes yet"
              columns={[
                { header: 'Recorded', cell: (r) => dateTime(r.createdAt) },
                { header: 'Service', cell: (r) => humanize(r.serviceType) },
                { header: 'Effective', cell: (r) => dateTime(r.effectiveFrom) },
                { header: 'Change', cell: (r) => String(r.summary.title ?? r.summary.note ?? '—') },
              ]}
            />
          )}
        </QueryState>
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Propose a fare change">
        {creating && fares.data && policy.data && <ProposalForm fares={fares.data} routes={routes.data ?? []} policy={policy.data} onDone={() => setCreating(false)} />}
      </Modal>
    </div>
  );
}

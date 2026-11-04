import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Input, PageHeader, QueryState, Select, StatusBadge, Textarea } from '@/components/ui';
import { FareRuleSummary } from '@/features/fares/FareRuleSummary';
import { useAction, useApi } from '@/hooks/api';
import { useT, type MessageKey } from '@/i18n';
import { api } from '@/services/api';
import type { FareRule } from '@/types';
import { dateTime, inr, rupeesToPaise } from '@/utils/format';

interface Profile {
  memberships: { status: string; communityId: string; community: { id: string; name: string } }[];
}
interface Fares {
  regular: FareRule | null;
  shared: { route: { id: string; code: string; name: string }; rule: FareRule }[];
}
interface MyFeedback {
  id: string;
  serviceType: string;
  sentiment: 'TOO_LOW' | 'FAIR' | 'TOO_HIGH';
  suggestedBaseFarePaise: number | null;
  suggestedPerKmPaise: number | null;
  suggestedPerSeatPaise: number | null;
  comment: string;
  status: string;
  response: string | null;
  createdAt: string;
  community: { name: string };
}

const SENTIMENTS: { value: MyFeedback['sentiment']; key: MessageKey }[] = [
  { value: 'TOO_LOW', key: 'fares.tooLow' },
  { value: 'FAIR', key: 'fares.fair' },
  { value: 'TOO_HIGH', key: 'fares.tooHigh' },
];
const TONE = { TOO_LOW: 'amber', FAIR: 'green', TOO_HIGH: 'red' } as const;

function FeedbackForm({ communityId, fares }: { communityId: string; fares: Fares }) {
  const { t } = useT();
  const [serviceType, setServiceType] = useState<'REGULAR' | 'SHARED'>(fares.regular || !fares.shared.length ? 'REGULAR' : 'SHARED');
  const [routeId, setRouteId] = useState(fares.shared[0]?.route.id ?? '');
  const [sentiment, setSentiment] = useState<MyFeedback['sentiment'] | ''>('');
  const [base, setBase] = useState('');
  const [perKm, setPerKm] = useState('');
  const [perSeat, setPerSeat] = useState('');
  const [comment, setComment] = useState('');
  const toPaise = (v: string) => (v === '' ? undefined : rupeesToPaise(Number(v)));
  const send = useAction(
    () =>
      api.post('/fare-feedback', {
        communityId,
        serviceType,
        sharedRouteId: serviceType === 'SHARED' ? routeId : undefined,
        sentiment,
        suggestedBaseFarePaise: serviceType === 'REGULAR' ? toPaise(base) : undefined,
        suggestedPerKmPaise: serviceType === 'REGULAR' ? toPaise(perKm) : undefined,
        suggestedPerSeatPaise: serviceType === 'SHARED' ? toPaise(perSeat) : undefined,
        comment,
      }),
    {
      invalidate: [['driver', 'fare-feedback']],
      success: t('fares.sent'),
      onSuccess: () => { setSentiment(''); setBase(''); setPerKm(''); setPerSeat(''); setComment(''); },
    },
  );
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      {fares.shared.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('fares.which')} value={serviceType} onChange={(e) => setServiceType(e.target.value as 'REGULAR' | 'SHARED')} options={[{ value: 'REGULAR', label: t('fares.regular') }, { value: 'SHARED', label: t('fares.shared') }]} />
          {serviceType === 'SHARED' && <Select label={t('fares.route')} value={routeId} onChange={(e) => setRouteId(e.target.value)} options={fares.shared.map((s) => ({ value: s.route.id, label: `${s.route.code} · ${s.route.name}` }))} />}
        </div>
      )}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('fares.question')}</legend>
        <div className="flex flex-wrap gap-2">
          {SENTIMENTS.map((s) => (
            <Button key={s.value} type="button" size="sm" variant={sentiment === s.value ? 'primary' : 'secondary'} aria-pressed={sentiment === s.value} onClick={() => setSentiment(s.value)}>{t(s.key)}</Button>
          ))}
        </div>
      </fieldset>
      {serviceType === 'REGULAR' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('fares.suggestBase')} type="number" min={0} step="1" value={base} onChange={(e) => setBase(e.target.value)} hint={t('fares.optional')} />
          <Input label={t('fares.suggestKm')} type="number" min={0} step="0.5" value={perKm} onChange={(e) => setPerKm(e.target.value)} hint={t('fares.optional')} />
        </div>
      ) : (
        <Input label={t('fares.suggestSeat')} type="number" min={0} step="1" value={perSeat} onChange={(e) => setPerSeat(e.target.value)} hint={t('fares.optional')} />
      )}
      <Textarea label={t('fares.why')} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      <Button type="submit" disabled={!sentiment || comment.trim().length < 5} loading={send.isPending}>{t('fares.send')}</Button>
    </form>
  );
}

function suggestionText(f: MyFeedback) {
  return [f.suggestedBaseFarePaise !== null && inr(f.suggestedBaseFarePaise), f.suggestedPerKmPaise !== null && `${inr(f.suggestedPerKmPaise)}/km`, f.suggestedPerSeatPaise !== null && `${inr(f.suggestedPerSeatPaise)}/seat`].filter(Boolean).join(' · ');
}

/** The fares a driver's union has fixed, and the driver's voice on them. */
export default function DriverFaresPage() {
  const { t } = useT();
  const profile = useApi<Profile>(['driver', 'profile'], '/drivers/me');
  const unions = (profile.data?.memberships ?? []).filter((m) => m.status === 'APPROVED');
  const [selected, setSelected] = useState<string | null>(null);
  const union = selected ?? unions[0]?.communityId ?? null;
  const fares = useApi<Fares>(['driver', 'fares', union], union ? `/fares/communities/${union}` : null);
  const mine = useApi<MyFeedback[]>(['driver', 'fare-feedback'], '/fare-feedback/mine');

  if (profile.data && unions.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('driver.navFares')} subtitle={t('fares.subtitle')} />
        <Alert tone="info">{t('fares.notMember')} <Link className="font-medium underline" to="/driver/profile">{t('driver.navProfile')}</Link></Alert>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <PageHeader title={t('driver.navFares')} subtitle={t('fares.subtitle')} />
      {unions.length > 1 && <Select label={t('fares.union')} value={union ?? ''} onChange={(e) => setSelected(e.target.value)} options={unions.map((u) => ({ value: u.communityId, label: u.community.name }))} />}
      {union && (
        <QueryState query={fares}>
          {(f) => (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card title={t('fares.current')}>
                {f.regular ? <><p className="mb-2 text-sm font-medium">{t('fares.regular')}</p><FareRuleSummary rule={f.regular} /></> : <p className="text-sm text-muted">{t('fares.none')}</p>}
                {f.shared.map((s) => (
                  <div key={s.route.id} className="mt-4 border-t border-line pt-3">
                    <p className="mb-2 text-sm font-medium">{s.route.code} · {s.route.name}</p>
                    <FareRuleSummary rule={s.rule} />
                  </div>
                ))}
              </Card>
              <Card title={t('fares.giveFeedback')}>
                <FeedbackForm key={union} communityId={union} fares={f} />
              </Card>
            </div>
          )}
        </QueryState>
      )}
      <Card title={t('fares.mine')}>
        <QueryState query={mine} empty={(d) => d.length === 0 && <p className="text-sm text-muted">{t('fares.mineEmpty')}</p>}>
          {(rows) => (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[r.sentiment]}>{t(SENTIMENTS.find((s) => s.value === r.sentiment)!.key)}</Badge>
                    <span className="text-xs text-muted">{r.community.name} · {dateTime(r.createdAt)}</span>
                    <span className="ml-auto"><StatusBadge status={r.status} /></span>
                  </div>
                  <p className="mt-1 text-sm">{r.comment}</p>
                  {suggestionText(r) && <p className="text-sm font-medium text-brand-700">{suggestionText(r)}</p>}
                  {r.response && <p className="mt-2 rounded-lg bg-sand/50 p-2 text-sm"><span className="font-medium">{t('fares.reply')}</span> {r.response}</p>}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, DataTable, Input, PageHeader, QueryState, Select, StatusBadge } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { api } from '@/services/api';
import { dateTime, humanize, inr, rupeesToPaise } from '@/utils/format';

interface Fee {
  id: string;
  serviceType: string;
  feeBps: number;
  flatFeePaise: number;
  maxFeePaise: number | null;
  effectiveFrom: string;
}
interface Flag {
  key: string;
  enabled: boolean;
  description: string | null;
}
type Caps = Record<string, number>;

const CAP_LABELS: Record<string, string> = {
  maxBaseFarePaise: 'Max base fare',
  maxPerKmPaise: 'Max per km',
  maxMinimumFarePaise: 'Max minimum fare',
  maxPerSeatPaise: 'Max shared seat fare',
  maxPerStopPaise: 'Max per-stop increment',
  maxWaitingPerMinutePaise: 'Max waiting per minute',
};

function CapsForm({ caps }: { caps: Caps }) {
  const [v, setV] = useState(caps);
  useEffect(() => setV(caps), [caps]);
  const save = useAction(() => api.put('/admin/settings/fare-caps', v), { invalidate: [['admin', 'caps']], success: 'Fare caps saved' });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {Object.entries(CAP_LABELS).map(([k, label]) => (
        <Input key={k} label={`${label} (₹)`} type="number" step="0.5" value={(v[k] ?? 0) / 100} onChange={(e) => setV({ ...v, [k]: rupeesToPaise(Number(e.target.value)) })} />
      ))}
      <Input label="Max night surcharge (%)" type="number" value={(v.maxNightSurchargeBps ?? 0) / 100} onChange={(e) => setV({ ...v, maxNightSurchargeBps: Math.round(Number(e.target.value) * 100) })} />
      <div className="sm:col-span-2">
        <Button type="submit" loading={save.isPending}>Save caps</Button>
        <p className="mt-1 text-xs text-stone-500">Set these to the fares notified by the state transport authority. Proposals above a cap are rejected automatically.</p>
      </div>
    </form>
  );
}

export default function AdminSettingsPage() {
  const fees = useApi<Fee[]>(['admin', 'fees'], '/admin/fees');
  const flags = useApi<Flag[]>(['admin', 'flags'], '/admin/feature-flags');
  const caps = useApi<Caps>(['admin', 'caps'], '/admin/settings/fare-caps');
  const [fee, setFee] = useState({ serviceType: 'REGULAR', percent: 5, flat: 0, max: 20, effectiveFrom: new Date(Date.now() + 3_600_000).toISOString().slice(0, 16) });
  const addFee = useAction(() => api.post('/admin/fees', { serviceType: fee.serviceType, feeBps: Math.round(fee.percent * 100), flatFeePaise: rupeesToPaise(fee.flat), maxFeePaise: fee.max ? rupeesToPaise(fee.max) : null, effectiveFrom: new Date(fee.effectiveFrom).toISOString() }), {
    invalidate: [['admin', 'fees']],
    success: 'Fee schedule added',
  });
  const setFlag = useAction((f: Flag) => api.put(`/admin/feature-flags/${f.key}`, { enabled: !f.enabled }), { invalidate: [['admin', 'flags']], success: 'Feature flag updated' });
  return (
    <div className="space-y-5">
      <PageHeader title="Fees & settings" />
      <Card title="Platform service fee schedule">
        <QueryState query={fees}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              columns={[
                { header: 'Service', cell: (r) => humanize(r.serviceType) },
                { header: 'Fee', cell: (r) => `${r.feeBps / 100}%${r.flatFeePaise ? ` + ${inr(r.flatFeePaise)}` : ''}` },
                { header: 'Cap', cell: (r) => (r.maxFeePaise !== null ? inr(r.maxFeePaise) : 'None') },
                { header: 'Effective from', cell: (r) => dateTime(r.effectiveFrom) },
                { header: '', cell: (r) => (new Date(r.effectiveFrom) > new Date() ? <StatusBadge status="SCHEDULED" /> : null) },
              ]}
            />
          )}
        </QueryState>
        <form className="mt-4 grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); addFee.mutate(); }}>
          <Select label="Service" value={fee.serviceType} onChange={(e) => setFee({ ...fee, serviceType: e.target.value })} options={[{ value: 'REGULAR', label: 'Regular' }, { value: 'SHARED', label: 'Shared' }]} />
          <Input label="Percent" type="number" step="0.1" value={fee.percent} onChange={(e) => setFee({ ...fee, percent: Number(e.target.value) })} />
          <Input label="Flat (₹)" type="number" step="0.5" value={fee.flat} onChange={(e) => setFee({ ...fee, flat: Number(e.target.value) })} />
          <Input label="Cap (₹, 0 = none)" type="number" value={fee.max} onChange={(e) => setFee({ ...fee, max: Number(e.target.value) })} />
          <Input label="Effective from" type="datetime-local" value={fee.effectiveFrom} onChange={(e) => setFee({ ...fee, effectiveFrom: e.target.value })} />
          <div className="sm:col-span-5">
            <Button type="submit" loading={addFee.isPending}>Schedule fee change</Button>
            <p className="mt-1 text-xs text-stone-500">Fee changes can't be backdated. Completed trips keep the fee recorded at completion.</p>
          </div>
        </form>
      </Card>
      <Card title="Regulatory fare caps">
        <QueryState query={caps}>{(c) => <CapsForm caps={c} />}</QueryState>
      </Card>
      <Card title="Feature flags">
        <QueryState query={flags}>
          {(rows) => (
            <ul className="space-y-2">
              {rows.map((f) => (
                <li key={f.key}>
                  <Checkbox label={<><code>{f.key}</code> — {f.description}</>} checked={f.enabled} onChange={() => setFlag.mutate(f)} />
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
    </div>
  );
}

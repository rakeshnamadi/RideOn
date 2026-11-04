import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/app/auth';
import { Alert, Button, Card, DataTable, Input, PageHeader, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useAction, useApi } from '@/hooks/api';
import { api, openPrivateFile } from '@/services/api';
import { date, humanize } from '@/utils/format';

interface DriverMe {
  id: string;
  licenseNumber: string;
  licenseExpiry: string;
  verificationStatus: string;
  verificationNote: string | null;
  status: string;
  suspensionReason: string | null;
  documents: { id: string; type: string; originalName: string; status: string; reviewNote: string | null; createdAt: string }[];
  memberships: { id: string; communityId: string; status: string; decisionNote: string | null; community: { id: string; name: string } }[];
  vehicleAssignments: { vehicle: { id: string; registrationNumber: string; make: string; model: string; status: string; seatCapacity: number; communityId: string; reviewNote: string | null } }[];
  eligibility: { communityId: string; communityName: string; eligible: boolean; reasons: string[] }[];
}

const LicenseSchema = z.object({
  licenseNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[0-9A-Z -]{8,18}$/, 'Enter your licence number as printed, e.g. AP0520190012345'),
  licenseExpiry: z.string().min(1, 'Required'),
});
const VehicleSchema = z.object({
  communityId: z.string().min(1, 'Choose a community'),
  registrationNumber: z.string().trim().min(6, 'Enter the registration number'),
  make: z.string().trim().min(2),
  model: z.string().trim().min(1),
  color: z.string().trim().optional(),
  fuelType: z.enum(['CNG', 'LPG', 'PETROL', 'DIESEL', 'ELECTRIC']),
  permitNumber: z.string().trim().optional(),
  permitExpiry: z.string().optional(),
  insuranceExpiry: z.string().optional(),
});
const DOC_TYPES = ['DRIVING_LICENSE', 'ID_PROOF', 'VEHICLE_RC', 'PERMIT', 'INSURANCE', 'PHOTO'];

function Register() {
  const { reload } = useAuth();
  const form = useForm<z.infer<typeof LicenseSchema>>({ resolver: zodResolver(LicenseSchema) });
  const create = useAction((v: z.infer<typeof LicenseSchema>) => api.post('/drivers/me', { ...v, licenseExpiry: new Date(v.licenseExpiry).toISOString() }), {
    invalidate: [['driver']],
    success: 'Driver profile created',
    onSuccess: () => void reload(),
  });
  return (
    <Card title="Register as a driver">
      <form className="max-w-md space-y-3" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
        <Input label="Driving licence number" {...form.register('licenseNumber')} error={form.formState.errors.licenseNumber?.message} />
        <Input label="Licence valid until" type="date" {...form.register('licenseExpiry')} error={form.formState.errors.licenseExpiry?.message} />
        <Button type="submit" loading={create.isPending}>Continue</Button>
      </form>
    </Card>
  );
}

export default function DriverProfilePage() {
  const { me } = useAuth();
  const toast = useToast();
  const q = useApi<DriverMe>(['driver', 'me'], me?.driver ? '/drivers/me' : null);
  const communities = useApi<{ id: string; name: string }[]>(['public-communities'], '/communities');
  const [docType, setDocType] = useState('DRIVING_LICENSE');
  const [file, setFile] = useState<File | null>(null);
  const [applyTo, setApplyTo] = useState('');
  const [note, setNote] = useState('');

  const upload = useAction(
    () => {
      const form = new FormData();
      form.append('type', docType);
      form.append('file', file!);
      return api.upload('/drivers/me/documents', form);
    },
    { invalidate: [['driver']], success: 'Document uploaded for review', onSuccess: () => setFile(null) },
  );
  const apply = useAction(() => api.post('/drivers/me/memberships', { communityId: applyTo, note: note || undefined }), { invalidate: [['driver']], success: 'Application sent to the community' });
  const leave = useAction((id: string) => api.post(`/drivers/me/memberships/${id}/leave`), { invalidate: [['driver']], success: 'You left the community' });
  const vForm = useForm<z.infer<typeof VehicleSchema>>({ resolver: zodResolver(VehicleSchema), defaultValues: { fuelType: 'CNG' } });
  const addVehicle = useAction(
    (v: z.infer<typeof VehicleSchema>) =>
      api.post('/drivers/me/vehicles', {
        ...v,
        color: v.color || undefined,
        permitNumber: v.permitNumber || undefined,
        permitExpiry: v.permitExpiry ? new Date(v.permitExpiry).toISOString() : undefined,
        insuranceExpiry: v.insuranceExpiry ? new Date(v.insuranceExpiry).toISOString() : undefined,
      }),
    { invalidate: [['driver']], success: 'Vehicle submitted for community approval', onSuccess: () => vForm.reset({ fuelType: 'CNG' }) },
  );

  if (!me?.driver) return (<div className="space-y-5"><PageHeader title="Driver profile" /><Register /></div>);
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  const memberCommunities = d.memberships.filter((m) => ['APPLIED', 'APPROVED'].includes(m.status));

  return (
    <div className="space-y-5">
      <PageHeader title="Profile & documents" subtitle={<span className="flex items-center gap-2">Verification <StatusBadge status={d.verificationStatus} /> {d.status === 'SUSPENDED' && <StatusBadge status="SUSPENDED" />}</span>} />
      {d.verificationNote && <Alert tone={d.verificationStatus === 'REJECTED' ? 'error' : 'info'}>{d.verificationNote}</Alert>}
      {d.suspensionReason && <Alert tone="error">Suspended: {d.suspensionReason}. You can appeal from Help & complaints.</Alert>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Licence">
          <p className="text-sm">{d.licenseNumber} · valid until {date(d.licenseExpiry)}</p>
          <p className="mt-1 text-xs text-stone-500">Changing licence details sends your profile back for verification.</p>
        </Card>
        <Card title="Upload a document">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}>
            <Select label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} options={DOC_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700" htmlFor="doc-file">File (PDF, JPEG or PNG, max 5 MB)</label>
              <input
                id="doc-file"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f && f.size > 5 * 1024 * 1024) {
                    toast.error(new Error('File is larger than 5 MB'));
                    e.target.value = '';
                    return;
                  }
                  setFile(f);
                }}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-200 file:px-3 file:py-2"
              />
            </div>
            <Button type="submit" icon={<Upload className="size-4" />} disabled={!file} loading={upload.isPending}>Upload</Button>
          </form>
        </Card>
      </div>

      <Card title="My documents">
        <DataTable
          rows={d.documents}
          rowKey={(r) => r.id}
          empty="No documents uploaded yet"
          columns={[
            { header: 'Type', cell: (r) => humanize(r.type) },
            { header: 'File', cell: (r) => <button className="text-brand-700 hover:underline" onClick={() => openPrivateFile(`/drivers/documents/${r.id}/file`).catch((e) => toast.error(e))}>{r.originalName}</button> },
            { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { header: 'Note', cell: (r) => r.reviewNote ?? '—' },
            { header: 'Uploaded', cell: (r) => date(r.createdAt) },
          ]}
        />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Community membership">
          <ul className="mb-4 space-y-2">
            {d.memberships.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{m.community.name}</span>
                <StatusBadge status={m.status} />
                {m.decisionNote && <span className="text-stone-500">— {m.decisionNote}</span>}
                {['APPLIED', 'APPROVED'].includes(m.status) && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => leave.mutate(m.id)}>Leave</Button>}
              </li>
            ))}
            {d.memberships.length === 0 && <li className="text-sm text-stone-600">You have not applied to a community yet.</li>}
          </ul>
          <form className="space-y-3 border-t border-stone-200 pt-3" onSubmit={(e) => { e.preventDefault(); apply.mutate(); }}>
            <Select label="Apply to" value={applyTo} onChange={(e) => setApplyTo(e.target.value)} options={[{ value: '', label: 'Choose a community…' }, ...(communities.data ?? []).filter((c) => !memberCommunities.some((m) => m.communityId === c.id)).map((c) => ({ value: c.id, label: c.name }))]} />
            <Textarea label="Note to the community (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Driving at Forum stand since 2018" />
            <Button type="submit" disabled={!applyTo} loading={apply.isPending}>Apply</Button>
          </form>
        </Card>

        <Card title="Vehicles">
          <ul className="mb-4 space-y-2">
            {d.vehicleAssignments.map(({ vehicle: v }) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{v.registrationNumber}</span> {v.make} {v.model} <StatusBadge status={v.status} />
                {v.status === 'APPROVED' && <span className="text-stone-500">{v.seatCapacity} seats (set by community)</span>}
                {v.reviewNote && <span className="text-stone-500">— {v.reviewNote}</span>}
              </li>
            ))}
          </ul>
          <form className="grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2" onSubmit={vForm.handleSubmit((v) => addVehicle.mutate(v))} noValidate>
            <Select label="Community" className="sm:col-span-2" {...vForm.register('communityId')} error={vForm.formState.errors.communityId?.message} options={[{ value: '', label: 'Choose…' }, ...memberCommunities.map((m) => ({ value: m.communityId, label: m.community.name }))]} />
            <Input label="Registration no." placeholder="AP05TA1234" {...vForm.register('registrationNumber')} error={vForm.formState.errors.registrationNumber?.message} />
            <Select label="Fuel" {...vForm.register('fuelType')} options={['CNG', 'LPG', 'PETROL', 'DIESEL', 'ELECTRIC'].map((f) => ({ value: f, label: f }))} />
            <Input label="Make" placeholder="Bajaj" {...vForm.register('make')} error={vForm.formState.errors.make?.message} />
            <Input label="Model" placeholder="RE Compact" {...vForm.register('model')} error={vForm.formState.errors.model?.message} />
            <Input label="Colour" {...vForm.register('color')} />
            <Input label="Permit number" {...vForm.register('permitNumber')} />
            <Input label="Permit expiry" type="date" {...vForm.register('permitExpiry')} />
            <Input label="Insurance expiry" type="date" {...vForm.register('insuranceExpiry')} />
            <div className="sm:col-span-2">
              <Button type="submit" loading={addVehicle.isPending}>Submit vehicle</Button>
              <p className="mt-1 text-xs text-stone-500">The community sets your permitted seat capacity when approving.</p>
            </div>
          </form>
        </Card>
      </div>

      {d.eligibility.length > 0 && (
        <Card title="Ready to drive?">
          <ul className="space-y-2 text-sm">
            {d.eligibility.map((e) => (
              <li key={e.communityId}>
                <span className="font-medium">{e.communityName}:</span> {e.eligible ? <StatusBadge status="APPROVED" label="Eligible" /> : e.reasons.join('; ')}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

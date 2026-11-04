import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, Button, Card, Input, PageHeader, Textarea } from '@/components/ui';
import { UnionMark } from '@/features/union/UnionMark';
import { useAction } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Union master data: what passengers, drivers and the console show for this union. */
export default function UnionProfilePage() {
  const { id, community, can } = useCommunity();
  const editable = can('profile.edit');
  const [f, setF] = useState({
    name: community.name,
    shortName: text(community.shortName),
    tagline: text(community.tagline),
    description: text(community.description),
    registrationNumber: text(community.registrationNumber),
    foundedYear: text(community.foundedYear),
    contactPhone: text(community.contactPhone),
    contactEmail: text(community.contactEmail),
    address: text(community.address),
    pincode: text(community.pincode),
    brandColor: text(community.brandColor) || '#0F4D3A',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const inv = [['community', id], ['public-community'], ['public-communities']];
  const save = useAction(
    () =>
      api.patch(`/communities/${id}`, {
        name: f.name,
        shortName: f.shortName || null,
        tagline: f.tagline || null,
        description: f.description || null,
        registrationNumber: f.registrationNumber || null,
        foundedYear: f.foundedYear ? Number(f.foundedYear) : null,
        contactPhone: f.contactPhone || null,
        contactEmail: f.contactEmail || null,
        address: f.address || null,
        pincode: f.pincode || null,
        brandColor: f.brandColor,
      }),
    { invalidate: inv, success: 'Union details saved' },
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useAction(
    (file: File) => {
      const form = new FormData();
      form.append('logo', file);
      return api.upload(`/communities/${id}/logo`, form);
    },
    { invalidate: inv, success: 'Logo updated' },
  );
  const removeLogo = useAction(() => api.del(`/communities/${id}/logo`), { invalidate: inv, success: 'Logo removed' });

  return (
    <div className="space-y-5">
      <PageHeader title="Union profile" subtitle="Your union’s name, logo and contact details. These appear on the public fares page and in your drivers’ app." />
      {!editable && <Alert tone="info">You can view these details. Only local admins can change them.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <Card title="Logo and colour">
          <div className="flex items-center gap-4">
            <UnionMark name={f.name} shortName={f.shortName} logoUrl={community.logoUrl} brandColor={f.brandColor} className="size-20 text-xl" />
            <div className="min-w-0 text-sm">
              <p className="font-medium">{f.shortName || f.name}</p>
              {f.tagline && <p className="text-muted">{f.tagline}</p>}
            </div>
          </div>
          {editable && (
            <div className="mt-4 space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Union logo file"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = '';
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={<ImagePlus className="size-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>Upload logo</Button>
                {community.logoUrl && <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} loading={removeLogo.isPending} onClick={() => removeLogo.mutate()}>Remove</Button>}
              </div>
              <p className="text-xs text-muted">PNG or JPEG, up to 1 MB. A square image works best.</p>
              <label className="flex items-center gap-3 text-sm font-medium">
                <input type="color" value={f.brandColor} onChange={set('brandColor')} className="h-9 w-12 cursor-pointer rounded border border-line" />
                Union colour
              </label>
            </div>
          )}
        </Card>
        <Card title="Master data">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
              <Input className="sm:col-span-2" label="Union name" value={f.name} onChange={set('name')} required minLength={3} />
              <Input label="Short name" hint="Shown where space is tight" value={f.shortName} onChange={set('shortName')} maxLength={40} />
              <Input label="Registration number" value={f.registrationNumber} onChange={set('registrationNumber')} />
              <Input className="sm:col-span-2" label="Tagline" value={f.tagline} onChange={set('tagline')} maxLength={200} />
              <Textarea className="sm:col-span-2" label="About the union" value={f.description} onChange={set('description')} />
              <Input label="Founded (year)" type="number" min={1900} max={new Date().getFullYear()} value={f.foundedYear} onChange={set('foundedYear')} />
              <Input label="Pincode" inputMode="numeric" maxLength={6} value={f.pincode} onChange={set('pincode')} />
              <Input className="sm:col-span-2" label="Office address" value={f.address} onChange={set('address')} />
              <Input label="Public contact phone" value={f.contactPhone} onChange={set('contactPhone')} />
              <Input label="Public contact email" type="email" value={f.contactEmail} onChange={set('contactEmail')} />
            </fieldset>
            {editable && <Button type="submit" loading={save.isPending}>Save union details</Button>}
          </form>
        </Card>
      </div>
    </div>
  );
}

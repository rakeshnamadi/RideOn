import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '@/app/auth';
import { Button, Card, Input, PageHeader, Select } from '@/components/ui';
import { useAction } from '@/hooks/api';
import { LANGUAGES, useT } from '@/i18n';
import { api } from '@/services/api';

const ProfileSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email().or(z.literal('')),
  preferredLanguage: z.string(),
  trustedContactName: z.string().trim().max(120),
  trustedContactPhone: z.string().trim().regex(/^((\+91)?[6-9]\d{9})?$/, 'Enter a valid mobile number'),
});
const PasswordForm = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(10, 'At least 10 characters').refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Use letters and numbers'),
});

export default function ProfilePage() {
  const { me, reload, logout } = useAuth();
  const { setLang } = useT();
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof ProfileSchema>>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      name: me?.name ?? '',
      email: me?.email ?? '',
      preferredLanguage: me?.preferredLanguage ?? 'en',
      trustedContactName: me?.trustedContactName ?? '',
      trustedContactPhone: me?.trustedContactPhone?.replace('+91', '') ?? '',
    },
  });
  const save = useAction(
    (v: z.infer<typeof ProfileSchema>) =>
      api.patch('/users/me', { ...v, email: v.email || null, trustedContactName: v.trustedContactName || null, trustedContactPhone: v.trustedContactPhone || null }),
    {
      success: 'Profile saved',
      onSuccess: () => {
        setLang(form.getValues('preferredLanguage'));
        void reload();
      },
    },
  );
  const pwForm = useForm<z.infer<typeof PasswordForm>>({ resolver: zodResolver(PasswordForm) });
  const changePw = useAction((v: z.infer<typeof PasswordForm>) => api.post('/users/me/password', v), {
    success: 'Password changed. Please sign in again.',
    onSuccess: async () => {
      await logout();
      navigate('/login');
    },
  });
  const logoutAll = useAction(() => api.post('/auth/logout-all'), {
    success: 'Signed out on all devices',
    onSuccess: async () => {
      await logout();
      navigate('/login');
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" subtitle={me?.phone} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Your details">
          <form className="space-y-3" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
            <Input label="Name" {...form.register('name')} error={form.formState.errors.name?.message} />
            <Input label="Email" type="email" {...form.register('email')} error={form.formState.errors.email?.message} />
            <Select label="Language" {...form.register('preferredLanguage')} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
            <h3 className="pt-2 text-sm font-semibold">Trusted contact</h3>
            <p className="text-xs text-stone-500">Someone you can quickly share a live trip link with.</p>
            <Input label="Contact name" {...form.register('trustedContactName')} />
            <Input label="Contact mobile" inputMode="tel" {...form.register('trustedContactPhone')} error={form.formState.errors.trustedContactPhone?.message} />
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </form>
        </Card>
        <Card title="Security">
          <form className="space-y-3" onSubmit={pwForm.handleSubmit((v) => changePw.mutate(v))} noValidate>
            <Input label="Current password" type="password" autoComplete="current-password" {...pwForm.register('currentPassword')} error={pwForm.formState.errors.currentPassword?.message} />
            <Input label="New password" type="password" autoComplete="new-password" {...pwForm.register('newPassword')} error={pwForm.formState.errors.newPassword?.message} />
            <Button type="submit" loading={changePw.isPending}>
              Change password
            </Button>
          </form>
          <div className="mt-6 border-t border-stone-200 pt-4">
            <Button variant="secondary" loading={logoutAll.isPending} onClick={() => logoutAll.mutate()}>
              Sign out on all devices
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

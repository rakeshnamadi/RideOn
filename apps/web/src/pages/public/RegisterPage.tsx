import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { homeFor, useAuth } from '@/app/auth';
import { Alert, Button, Card, Checkbox, errorMessage, Input, Tabs } from '@/components/ui';
import { useT } from '@/i18n';
import { AuthShell } from '@/features/brand/AuthShell';

const Schema = z.object({
  name: z.string().trim().min(2, 'Enter your name'),
  phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
  password: z
    .string()
    .min(10, 'At least 10 characters')
    .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Use letters and numbers'),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Please accept to continue' }) }),
});
type Values = z.infer<typeof Schema>;

export default function RegisterPage() {
  const { register: signUp } = useAuth();
  const { lang } = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [type, setType] = useState<'PASSENGER' | 'DRIVER'>(params.get('type') === 'driver' ? 'DRIVER' : 'PASSENGER');
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await signUp({ ...v, accountType: type, preferredLanguage: lang });
      navigate(type === 'DRIVER' ? '/driver/profile' : homeFor(me), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthShell audience={type === 'DRIVER' ? 'driver' : 'passenger'}>
      <Card>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Create your account</h1>
        <div className="mt-4">
          <Tabs value={type} onChange={setType} options={[{ value: 'PASSENGER', label: 'I want to ride' }, { value: 'DRIVER', label: 'I drive an auto' }]} />
        </div>
        {type === 'DRIVER' && <Alert tone="info">After signing up you’ll add your licence and documents, then apply to your local auto community.</Alert>}
        <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Input label="Full name" autoComplete="name" {...register('name')} error={formState.errors.name?.message} />
          <Input label="Mobile number" inputMode="tel" autoComplete="tel-national" placeholder="98xxxxxxxx" {...register('phone')} error={formState.errors.phone?.message} />
          <Input label="Email (optional)" type="email" autoComplete="email" {...register('email')} error={formState.errors.email?.message} />
          <Input label="Password" type="password" autoComplete="new-password" hint="At least 10 characters, with letters and numbers." {...register('password')} error={formState.errors.password?.message} />
          <div>
            <Checkbox label="I agree to the Terms of Service and Privacy Policy." {...register('acceptTerms')} />
            {formState.errors.acceptTerms && <p className="mt-1 text-sm text-red-700">{formState.errors.acceptTerms.message}</p>}
          </div>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm">
          Already registered?{' '}
          <Link to="/login" className="text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </AuthShell>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { homeFor, useAuth } from '@/app/auth';
import { Alert, Button, Card, errorMessage, Input } from '@/components/ui';
import { useState } from 'react';
import { AuthShell } from '@/features/brand/AuthShell';

const Schema = z.object({
  identifier: z.string().trim().min(3, 'Enter your mobile number or email'),
  password: z.string().min(1, 'Enter your password'),
});
type Values = z.infer<typeof Schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await login(v.identifier, v.password);
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(me), { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthShell>
      <Card>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-stone-600">Passengers, drivers and community administrators all sign in here.</p>
        <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Input label="Mobile number or email" autoComplete="username" inputMode="email" {...register('identifier')} error={formState.errors.identifier?.message} />
          <Input label="Password" type="password" autoComplete="current-password" {...register('password')} error={formState.errors.password?.message} />
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>
            Sign in
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <Link to="/forgot-password" className="text-brand-700 hover:underline">
            Forgot password?
          </Link>
          <Link to="/register" className="text-brand-700 hover:underline">
            Create an account
          </Link>
        </div>
      </Card>
      {import.meta.env.DEV && (
        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
          <strong>Development seed accounts</strong> (password <code>Demo@12345</code>): super admin 9000000001 · local admin 9000000002, 9000000003 · approver 9000000004 · other union’s local admin 9000000005 · reporter 9000000006 · drivers 9000000010–14 · passengers 9000000020, 9000000021.
        </div>
      )}
    </AuthShell>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Input, MockLabel } from '@/components/ui';
import { useAction } from '@/hooks/api';
import { api } from '@/services/api';

/** Two-step recovery: request a reset, then set a new password with the token. */
export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);

  const request = useAction(() => api.post<{ message: string; devResetToken?: string }>('/auth/password/forgot', { identifier }), {
    onSuccess: (r) => {
      setSent(true);
      if (r.devResetToken) {
        setDevToken(r.devResetToken);
        setToken(r.devResetToken);
      }
    },
  });
  const reset = useAction(() => api.post('/auth/password/reset', { token, newPassword: password }), { onSuccess: () => setDone(true) });

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card>
        <h1 className="text-xl font-semibold">Reset your password</h1>
        {done ? (
          <div className="mt-4 space-y-3">
            <Alert tone="success">Password updated. All your other sessions were signed out.</Alert>
            <Link to="/login" className="font-medium text-brand-700 hover:underline">
              Sign in
            </Link>
          </div>
        ) : !sent ? (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              request.mutate();
            }}
          >
            <Input label="Mobile number or email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
            <Button type="submit" loading={request.isPending} className="w-full">
              Send reset instructions
            </Button>
          </form>
        ) : (
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              reset.mutate();
            }}
          >
            <Alert tone="info">If an account exists, reset instructions have been sent.</Alert>
            {devToken && (
              <Alert tone="warn">
                <MockLabel /> No SMS/email provider is configured, so the reset code is shown here in development only.
              </Alert>
            )}
            <Input label="Reset code" value={token} onChange={(e) => setToken(e.target.value)} required />
            <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters, with letters and numbers." value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Button type="submit" loading={reset.isPending} className="w-full">
              Set new password
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

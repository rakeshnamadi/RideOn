import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { homeFor, useAuth } from '@/app/auth';

export default function ForbiddenPage({ message = 'Your account does not have access to this area.' }: { message?: string }) {
  const { me } = useAuth();
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <ShieldAlert className="mx-auto size-10 text-stone-400" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold">Not authorised</h1>
      <p className="mt-2 text-sm text-stone-600">{message}</p>
      <Link to={me ? homeFor(me) : '/'} className="mt-4 inline-block font-medium text-brand-700 hover:underline">
        Back to your dashboard
      </Link>
    </div>
  );
}

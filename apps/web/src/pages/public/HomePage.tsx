import { IndianRupee, Scale, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

const POINTS = [
  { icon: Users, title: 'Run by local auto communities', body: 'Driver associations manage their members, stands, routes and fare proposals — not a distant head office.' },
  { icon: IndianRupee, title: 'Transparent fares', body: 'Every fare is published, versioned and approved through the community’s governance process. Drivers see every deduction.' },
  { icon: Scale, title: 'Accountable decisions', body: 'Fare changes, suspensions and admin actions are recorded in an append-only audit history.' },
  { icon: ShieldCheck, title: 'Safety first', body: 'Start PINs, trip sharing with a trusted contact, an emergency button and verified drivers.' },
];

export default function HomePage() {
  return (
    <div>
      <section className="bg-gradient-to-b from-brand-900 to-brand-800 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-2 md:items-center md:py-20">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Autos booked through your local driver community.</h1>
            <p className="mt-4 text-lg text-brand-100">Book a regular auto or a seat on a scheduled shared auto at the community-approved fare.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/register" className="rounded-lg bg-accent-400 px-5 py-3 font-semibold text-stone-900 hover:bg-accent-500">
                Book a ride
              </Link>
              <Link to="/fares" className="rounded-lg px-5 py-3 font-semibold text-white ring-1 ring-white/40 hover:bg-white/10">
                See published fares
              </Link>
            </div>
            <p className="mt-4 text-sm text-brand-100">
              Drive an auto? <Link to="/register?type=driver" className="font-semibold underline">Join your community on RideOn</Link>.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 p-6 ring-1 ring-white/20">
            <p className="text-sm uppercase tracking-wide text-brand-100">How a fare is set</p>
            <ol className="mt-3 space-y-3 text-sm">
              {['A community representative proposes a fare.', 'The platform checks it against permitted limits.', 'Authorised community approvers vote.', 'Once approved, it takes effect on the published date — confirmed bookings keep their fare.'].map((s, i) => (
                <li key={s} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-400 text-xs font-bold text-stone-900">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        {POINTS.map((p) => (
          <div key={p.title} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
            <p.icon className="size-6 text-brand-700" aria-hidden />
            <h2 className="mt-3 font-semibold">{p.title}</h2>
            <p className="mt-1 text-sm text-stone-600">{p.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

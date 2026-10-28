import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Bus, Coins, Languages, ListOrdered, Megaphone, Scale, ShieldCheck, Users } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '@/hooks/api';
import { useT, type MessageKey } from '@/i18n';
import { api } from '@/services/api';
import type { PickupPoint } from '@/types';
import { inr, km, minutes } from '@/utils/format';

interface CommunityListItem {
  id: string;
  name: string;
}
interface PublicCommunity {
  id: string;
  name: string;
  policy: { communityFeeBps: number } | null;
  pickupPoints: PickupPoint[];
}
interface PublicConfig {
  platformFees: Record<'REGULAR' | 'SHARED', { feeBps: number; flatFeePaise: number; maxFeePaise: number | null }>;
}
interface Estimate {
  distanceMeters: number;
  durationSeconds: number;
  fare: { totalPaise: number };
}

/** A real example trip: the published fare between two stops of a participating community. */
function useExampleTrip() {
  const communities = useApi<CommunityListItem[]>(['public-communities'], '/communities');
  const first = communities.data?.[0]?.id ?? null;
  const community = useApi<PublicCommunity>(['public-community', first], first ? `/communities/${first}/public` : null);
  const points = community.data?.pickupPoints ?? [];
  const from = points[0];
  const to = points[points.length - 1];
  const estimate = useQuery({
    queryKey: ['home-estimate', from?.id, to?.id],
    enabled: !!from && !!to && from.id !== to.id,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => (await api.post<Estimate>('/fares/estimate', { pickup: { lat: from!.lat, lng: from!.lng }, drop: { lat: to!.lat, lng: to!.lng }, communityId: first })).data,
  });
  const config = useApi<PublicConfig>(['config'], '/config');
  return { community: community.data, from, to, estimate: estimate.data, fees: config.data?.platformFees.REGULAR };
}

function pct(bps: number) {
  return `${bps / 100}%`;
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-4xl font-extrabold tracking-tight text-accent-400">{title}</p>
      <p className="text-lg leading-relaxed text-brand-200">{body}</p>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, body }: { icon: ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line">
      <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700">
        <Icon className="size-5" />
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-muted">{body}</p>
    </div>
  );
}

function DriverPoint({ icon: Icon, title, body }: { icon: ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-1 size-5 shrink-0 text-accent-400" />
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold text-paper">{title}</h3>
        <p className="text-brand-200">{body}</p>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, children, dark }: { eyebrow: string; title: string; children?: ReactNode; dark?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <p className={`text-sm font-bold uppercase tracking-[0.12em] ${dark ? 'text-accent-400' : 'text-accent-700'}`}>{eyebrow}</p>
      <h2 className={`font-display text-4xl font-extrabold leading-[1.02] tracking-tight text-balance sm:text-5xl lg:text-6xl ${dark ? 'text-paper' : ''}`}>{title}</h2>
      {children}
    </div>
  );
}

export default function HomePage() {
  const { t, lang } = useT();
  // Devanagari matras need more line height than Latin display type.
  const tight = lang === 'hi' ? 'leading-[1.2]' : 'leading-[0.95]';
  const { community, from, to, estimate, fees } = useExampleTrip();
  const fare = estimate?.fare.totalPaise;
  const communityName = community?.name ?? '…';
  const communityBps = community?.policy?.communityFeeBps ?? 0;
  const platformFee = fare !== undefined && fees ? Math.min(Math.round((fare * fees.feeBps) / 10_000) + fees.flatFeePaise, fees.maxFeePaise ?? Infinity) : undefined;
  const communityFee = fare !== undefined ? Math.round((fare * communityBps) / 10_000) : undefined;
  const keep = fare !== undefined && platformFee !== undefined && communityFee !== undefined ? fare - platformFee - communityFee : undefined;

  const steps: [MessageKey, MessageKey][] = [
    ['home.s1Title', 'home.s1Body'],
    ['home.s2Title', 'home.s2Body'],
    ['home.s3Title', 'home.s3Body'],
    ['home.s4Title', 'home.s4Body'],
  ];

  return (
    <div className="overflow-x-clip">
      {/* Hero — the positioning */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-16">
        <div className="flex flex-col gap-7">
          <p className="inline-flex items-center gap-2 self-start rounded-full bg-sand px-3.5 py-1.5 text-sm font-semibold text-ink/85">
            <span className="size-2 rounded-full bg-accent-500" aria-hidden />
            {t('home.eyebrow')}
          </p>
          <h1 className={`font-display text-[clamp(3rem,8vw,5.75rem)] font-extrabold tracking-[-0.035em] ${tight}`}>
            <span className="block">{t('brand.city')}</span>
            <span className="block">{t('brand.people')}</span>
            <span className="block text-brand-700">{t('brand.ride')}</span>
          </h1>
          <p className="max-w-[36ch] text-xl leading-relaxed text-muted text-pretty">{t('home.lead')}</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/register" className="rounded-full bg-accent-400 px-7 py-4 text-lg font-bold text-ink hover:bg-accent-500">
              {t('home.ctaBook')}
            </Link>
            <Link to="/register?type=driver" className="rounded-full px-6 py-4 text-lg font-semibold text-ink ring-[1.5px] ring-inset ring-ink hover:bg-sand/70">
              {t('home.ctaDrive')}
            </Link>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -right-6 -top-6 hidden size-40 rounded-full bg-accent-400/30 lg:block" aria-hidden />
          <figure className="relative flex flex-col gap-4 rounded-[2rem] bg-brand-700 p-6 text-paper shadow-[0_30px_60px_-30px_rgba(16,35,28,0.6)] sm:p-8" aria-label={t('home.cardTrip')}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-200">{t('home.cardTrip')}</span>
              <span className="rounded-full bg-brand-600 px-3 py-1 text-xs">{t('home.cardExample')}</span>
            </div>
            <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 gap-y-1.5 rounded-2xl bg-paper px-5 py-4 text-ink">
              <span className="size-3.5 rounded-full bg-brand-700" aria-hidden />
              <span className="font-semibold">{from?.name ?? '…'}</span>
              <span className="mx-auto h-7 border-l-2 border-dashed border-ink/25" aria-hidden />
              <span className="text-sm text-muted">{estimate ? `${km(estimate.distanceMeters)} · ~${minutes(estimate.durationSeconds)}` : '…'}</span>
              <span className="size-3.5 rounded-[4px] bg-orange-700" aria-hidden />
              <span className="font-semibold">{to?.name ?? '…'}</span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-brand-200">{t('home.cardFare')}</p>
                <p className="font-display text-6xl font-extrabold leading-none tabular-nums">{fare !== undefined ? inr(fare) : '—'}</p>
              </div>
              <p className="max-w-[24ch] text-right text-sm text-brand-200">{t('home.cardLocked', { community: communityName })}</p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-brand-600 p-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-400 text-ink">
                <BadgeCheck className="size-5" />
              </span>
              <div className="flex flex-col">
                <span className="font-semibold">{t('home.cardMember')}</span>
                <span className="text-sm text-brand-200">{t('home.cardVerified')}</span>
              </div>
            </div>
          </figure>
        </div>
      </section>

      {/* The three pillars */}
      <section aria-label={t('brand.tagline')} className="bg-ink">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
          <Pillar title={t('brand.city')} body={t('home.cityBody')} />
          <Pillar title={t('brand.people')} body={t('home.peopleBody')} />
          <Pillar title={t('brand.ride')} body={t('home.rideBody')} />
        </div>
      </section>

      {/* Passengers */}
      <section id="passengers" className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
        <SectionHeading eyebrow={t('home.passengerEyebrow')} title={t('brand.passengerPromise')}>
          <p className="max-w-[40ch] text-lg leading-relaxed text-muted">{t('home.passengerLead')}</p>
          <Link to="/fares" className="self-start font-semibold text-brand-700 underline decoration-2 underline-offset-4 hover:text-brand-800">
            {t('home.seeFares')} →
          </Link>
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <FeatureCard icon={Bus} title={t('home.p1Title')} body={t('home.p1Body')} />
          <FeatureCard icon={Coins} title={t('home.p2Title')} body={t('home.p2Body')} />
          <FeatureCard icon={ShieldCheck} title={t('home.p3Title')} body={t('home.p3Body')} />
          <FeatureCard icon={Languages} title={t('home.p4Title')} body={t('home.p4Body')} />
        </div>
      </section>

      {/* Drivers */}
      <section id="drivers" className="bg-brand-700">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
          <figure className="order-2 flex flex-col gap-5 rounded-[1.75rem] bg-paper p-7 text-ink lg:order-1" aria-label={t('home.earnSub')}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{t('home.earnTitle', { fare: fare !== undefined ? inr(fare) : '—' })}</p>
              <p className="text-sm text-muted">{t('home.earnSub')}</p>
            </div>
            <dl className="flex flex-col gap-3">
              <div className="flex justify-between gap-3">
                <dt>{t('home.earnPaid')}</dt>
                <dd className="font-semibold tabular-nums">{inr(fare)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-muted">
                <dt>{t('home.earnPlatform', { pct: fees ? pct(fees.feeBps) : '—' })}</dt>
                <dd className="tabular-nums">− {inr(platformFee)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-muted">
                <dt>{t('home.earnCommunity', { pct: pct(communityBps) })}</dt>
                <dd className="tabular-nums">− {inr(communityFee)}</dd>
              </div>
              <div className="h-px bg-line" />
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-semibold">{t('home.earnKeep')}</dt>
                <dd className="font-display text-4xl font-extrabold tabular-nums text-brand-700">{inr(keep)}</dd>
              </div>
            </dl>
            <p className="text-sm text-muted">{t('home.earnNote', { community: communityName })}</p>
          </figure>
          <div className="order-1 flex flex-col gap-8 lg:order-2">
            <SectionHeading dark eyebrow={t('home.driverEyebrow')} title={t('brand.driverPromise')} />
            <div className="grid gap-6 sm:grid-cols-2">
              <DriverPoint icon={Scale} title={t('home.d1Title')} body={t('home.d1Body')} />
              <DriverPoint icon={Coins} title={t('home.d2Title')} body={t('home.d2Body')} />
              <DriverPoint icon={ListOrdered} title={t('home.d3Title')} body={t('home.d3Body')} />
              <DriverPoint icon={Megaphone} title={t('home.d4Title')} body={t('home.d4Body')} />
            </div>
            <Link to="/register?type=driver" className="self-start rounded-full bg-accent-400 px-6 py-3.5 font-bold text-ink hover:bg-accent-500">
              {t('home.driverCta')}
            </Link>
          </div>
        </div>
      </section>

      {/* Governance */}
      <section className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-24 sm:px-6">
        <div className="max-w-3xl">
          <SectionHeading eyebrow={t('home.faresEyebrow')} title={t('home.faresTitle')} />
        </div>
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, body], i) => (
            <li key={title} className="flex flex-col gap-3 border-t-2 border-ink pt-5">
              <span className="font-display text-3xl font-extrabold text-brand-700">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="text-lg font-semibold">{t(title)}</h3>
              <p className="text-muted">{t(body)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Closing call to action */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 rounded-[2.25rem] bg-accent-400 px-6 py-16 text-center sm:px-12">
          <Users className="size-9 text-ink" aria-hidden />
          <h2 className={`font-display text-[clamp(2.5rem,6vw,5rem)] font-extrabold tracking-[-0.035em] text-ink text-balance ${tight}`}>{t('brand.tagline')}</h2>
          <p className="max-w-[46ch] text-lg text-ink/80">{t('home.finalLead')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/register" className="rounded-full bg-ink px-7 py-4 text-lg font-bold text-paper hover:bg-brand-800">
              {t('home.ctaBook')}
            </Link>
            <Link to="/register?type=driver" className="rounded-full px-6 py-4 text-lg font-semibold text-ink ring-[1.5px] ring-inset ring-ink hover:bg-accent-500">
              {t('home.iDrive')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

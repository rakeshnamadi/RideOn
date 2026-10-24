import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useParams, type RouteObject } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { AdminLayout } from '@/layouts/AdminLayout';
import { CommunityLayout } from '@/layouts/CommunityLayout';
import { DriverLayout } from '@/layouts/DriverLayout';
import { PassengerLayout, PublicLayout } from '@/layouts/PublicLayout';
import type { SystemRole } from '@/types';
import { homeFor, useAuth } from './auth';
import ForbiddenPage from '@/pages/public/ForbiddenPage';
import NotFoundPage from '@/pages/public/NotFoundPage';

const page = (loader: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(loader);
  return (
    <Suspense fallback={<Spinner />}>
      <C />
    </Suspense>
  );
};

/** Route guard: requires a session and at least one of the given roles. The API enforces the same rules. */
function RequireRole({ roles, children }: { roles: SystemRole[]; children?: ReactNode }) {
  const { status, me } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner label="Restoring your session…" />;
  if (status === 'anonymous' || !me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!roles.some((r) => me.roles.includes(r))) return <ForbiddenPage />;
  return <>{children ?? <Outlet />}</>;
}

/** Community console guard: the user must administer *this* community (or be a super admin for oversight). */
function RequireCommunity() {
  const { me } = useAuth();
  const { communityId } = useParams();
  if (!me) return null;
  const allowed = me.roles.includes('SUPER_ADMIN') || me.communities.some((c) => c.id === communityId);
  return allowed ? <Outlet /> : <ForbiddenPage message="You are not an administrator of this community." />;
}

const homePage = page(() => import('@/pages/public/HomePage'));

function AuthHome() {
  const { status, me } = useAuth();
  if (status === 'loading') return <Spinner />;
  if (me) return <Navigate to={homeFor(me)} replace />;
  return homePage;
}

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <AuthHome /> },
      { path: '/fares', element: page(() => import('@/pages/public/FaresPage')) },
      { path: '/login', element: page(() => import('@/pages/public/LoginPage')) },
      { path: '/register', element: page(() => import('@/pages/public/RegisterPage')) },
      { path: '/forgot-password', element: page(() => import('@/pages/public/ForgotPasswordPage')) },
      { path: '/track/:token', element: page(() => import('@/pages/public/TrackPage')) },
    ],
  },
  {
    path: '/app',
    element: (
      <RequireRole roles={['PASSENGER', 'SUPER_ADMIN']}>
        <PassengerLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import('@/pages/passenger/BookRidePage')) },
      { path: 'shared', element: page(() => import('@/pages/passenger/SharedPage')) },
      { path: 'bookings', element: page(() => import('@/pages/passenger/TripsPage')) },
      { path: 'bookings/:id', element: page(() => import('@/pages/passenger/TripDetailPage')) },
      { path: 'support', element: page(() => import('@/pages/passenger/SupportPage')) },
      { path: 'profile', element: page(() => import('@/pages/passenger/ProfilePage')) },
      { path: 'notifications', element: page(() => import('@/pages/shared/NotificationsPage')) },
    ],
  },
  {
    path: '/driver',
    element: (
      <RequireRole roles={['DRIVER']}>
        <DriverLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import('@/pages/driver/DriverHomePage')) },
      { path: 'shared', element: page(() => import('@/pages/driver/DriverSharedPage')) },
      { path: 'earnings', element: page(() => import('@/pages/driver/DriverEarningsPage')) },
      { path: 'history', element: page(() => import('@/pages/driver/DriverHistoryPage')) },
      { path: 'profile', element: page(() => import('@/pages/driver/DriverProfilePage')) },
      { path: 'support', element: page(() => import('@/pages/passenger/SupportPage')) },
      { path: 'notifications', element: page(() => import('@/pages/shared/NotificationsPage')) },
    ],
  },
  {
    path: '/community/:communityId',
    element: <RequireRole roles={['COMMUNITY_ADMIN', 'SUPER_ADMIN']} />,
    children: [
      {
        element: <RequireCommunity />,
        children: [
          {
            element: <CommunityLayout />,
            children: [
              { index: true, element: page(() => import('@/pages/community/CommunityDashboard')) },
              { path: 'members', element: page(() => import('@/pages/community/MembersPage')) },
              { path: 'drivers', element: page(() => import('@/pages/community/DriversPage')) },
              { path: 'vehicles', element: page(() => import('@/pages/community/VehiclesPage')) },
              { path: 'areas', element: page(() => import('@/pages/community/ServiceAreasPage')) },
              { path: 'pickup-points', element: page(() => import('@/pages/community/PickupPointsPage')) },
              { path: 'routes', element: page(() => import('@/pages/community/RoutesPage')) },
              { path: 'departures', element: page(() => import('@/pages/community/DeparturesPage')) },
              { path: 'fares', element: page(() => import('@/pages/community/CommunityFaresPage')) },
              { path: 'queue', element: page(() => import('@/pages/community/QueuePage')) },
              { path: 'bookings', element: page(() => import('@/pages/community/CommunityBookingsPage')) },
              { path: 'complaints', element: page(() => import('@/pages/community/CommunityComplaintsPage')) },
              { path: 'announcements', element: page(() => import('@/pages/community/AnnouncementsPage')) },
              { path: 'statements', element: page(() => import('@/pages/community/StatementsPage')) },
              { path: 'audit', element: page(() => import('@/pages/community/CommunityAuditPage')) },
              { path: 'settings', element: page(() => import('@/pages/community/CommunitySettingsPage')) },
              { path: 'notifications', element: page(() => import('@/pages/shared/NotificationsPage')) },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '/admin',
    element: (
      <RequireRole roles={['SUPER_ADMIN']}>
        <AdminLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import('@/pages/admin/AdminDashboard')) },
      { path: 'communities', element: page(() => import('@/pages/admin/AdminCommunitiesPage')) },
      { path: 'cities', element: page(() => import('@/pages/admin/AdminCitiesPage')) },
      { path: 'drivers', element: page(() => import('@/pages/admin/AdminDriversPage')) },
      { path: 'fare-reviews', element: page(() => import('@/pages/admin/AdminFareReviewsPage')) },
      { path: 'bookings', element: page(() => import('@/pages/admin/AdminBookingsPage')) },
      { path: 'complaints', element: page(() => import('@/pages/admin/AdminComplaintsPage')) },
      { path: 'support', element: page(() => import('@/pages/admin/AdminSupportPage')) },
      { path: 'users', element: page(() => import('@/pages/admin/AdminUsersPage')) },
      { path: 'settings', element: page(() => import('@/pages/admin/AdminSettingsPage')) },
      { path: 'audit', element: page(() => import('@/pages/admin/AdminAuditPage')) },
      { path: 'reports', element: page(() => import('@/pages/admin/AdminReportsPage')) },
      { path: 'notifications', element: page(() => import('@/pages/shared/NotificationsPage')) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);

export { homeFor };

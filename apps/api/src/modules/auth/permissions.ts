import type { CommunityRole } from '@prisma/client';

export const SYSTEM_ROLES = ['SUPER_ADMIN', 'COMMUNITY_ADMIN', 'DRIVER', 'PASSENGER'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Global permissions, granted through system roles (seeded into roles/permissions tables). */
export const GLOBAL_PERMISSIONS = {
  'platform.communities.manage': 'Create, approve, suspend and deactivate communities',
  'platform.users.manage': 'Suspend and reinstate user accounts',
  'platform.drivers.verify': 'Review driver identity verification',
  'platform.fees.manage': 'Configure platform service fees',
  'platform.fares.review': 'Review fare proposals that require platform review',
  'platform.bookings.view': 'View all bookings platform-wide',
  'platform.support.manage': 'Manage support tickets, incidents and complaints',
  'platform.audit.view': 'View the platform audit log',
  'platform.reports.export': 'Export platform reports',
  'platform.settings.manage': 'Manage cities, feature flags and platform settings',
  'community.console': 'Access the community admin console',
  'driver.operate': 'Operate as a driver',
  'booking.create': 'Create bookings as a passenger',
} as const;
export type GlobalPermission = keyof typeof GLOBAL_PERMISSIONS;

export const ROLE_PERMISSIONS: Record<SystemRole, GlobalPermission[]> = {
  SUPER_ADMIN: [
    'platform.communities.manage',
    'platform.users.manage',
    'platform.drivers.verify',
    'platform.fees.manage',
    'platform.fares.review',
    'platform.bookings.view',
    'platform.support.manage',
    'platform.audit.view',
    'platform.reports.export',
    'platform.settings.manage',
  ],
  COMMUNITY_ADMIN: ['community.console'],
  DRIVER: ['driver.operate'],
  PASSENGER: ['booking.create'],
};

/** Permissions scoped to one community (union), granted through community_admins. */
export const COMMUNITY_PERMISSIONS = [
  'community.view',
  'community.profile.edit',
  'community.policy.edit',
  'community.admins.manage',
  'community.members.manage',
  'community.drivers.manage',
  'community.vehicles.manage',
  'community.areas.manage',
  'community.routes.manage',
  'community.fares.propose',
  'community.fares.approve',
  'community.feedback.manage',
  'community.queue.manage',
  'community.bookings.view',
  'community.complaints.manage',
  'community.announcements.manage',
  'community.reports.manage',
  'community.statements.view',
  'community.audit.view',
] as const;
export type CommunityPermission = (typeof COMMUNITY_PERMISSIONS)[number];

/** What each permission lets someone do — shown when a local admin customises a delegate. */
export const COMMUNITY_PERMISSION_LABELS: Record<CommunityPermission, string> = {
  'community.view': 'Open the union console',
  'community.profile.edit': 'Edit union profile, logo and master data',
  'community.policy.edit': 'Change operational settings',
  'community.admins.manage': 'Assign roles and permissions to the team',
  'community.members.manage': 'Approve, reject or suspend drivers',
  'community.drivers.manage': 'Review driver documents',
  'community.vehicles.manage': 'Approve vehicles and set seat capacity',
  'community.areas.manage': 'Set service-area geolocation',
  'community.routes.manage': 'Add or delete pickup/drop points, routes and schedules',
  'community.fares.propose': 'Propose fares and rule changes',
  'community.fares.approve': 'Approve or reject fare and rule proposals',
  'community.feedback.manage': 'Read and answer drivers’ fare feedback',
  'community.queue.manage': 'Manage the live stand queue and departures',
  'community.bookings.view': 'View bookings and statistics',
  'community.complaints.manage': 'Handle complaints and appeals',
  'community.announcements.manage': 'Publish announcements',
  'community.reports.manage': 'Prepare, view and edit reports',
  'community.statements.view': 'View revenue statements and export data',
  'community.audit.view': 'View the decision history',
};

/**
 * Union role hierarchy. LOCAL_ADMIN runs the union for its dedicated area and delegates
 * every role below it; the platform super admin assigns local admins.
 */
export const COMMUNITY_ROLE_PERMISSIONS: Record<CommunityRole, readonly CommunityPermission[]> = {
  LOCAL_ADMIN: COMMUNITY_PERMISSIONS,
  REPORTER: [
    'community.view',
    'community.reports.manage',
    'community.statements.view',
    'community.bookings.view',
    'community.members.manage',
    'community.drivers.manage',
    'community.areas.manage',
    'community.audit.view',
  ],
  APPROVER: [
    'community.view',
    'community.fares.approve',
    'community.feedback.manage',
    'community.bookings.view',
    'community.statements.view',
    'community.audit.view',
  ],
  OPERATOR: [
    'community.view',
    'community.queue.manage',
    'community.bookings.view',
    'community.complaints.manage',
  ],
};

/** Roles a local admin may give to people under them (local admins are assigned by the platform). */
export const DELEGABLE_ROLES = ['REPORTER', 'APPROVER', 'OPERATOR'] as const satisfies readonly CommunityRole[];

/** Permissions that stay with local admins: a delegate can never be granted these. */
export const LOCAL_ADMIN_ONLY_PERMISSIONS: readonly CommunityPermission[] = ['community.admins.manage', 'community.policy.edit'];

/** Permissions a local admin may switch on or off for an individual delegate. */
export const DELEGABLE_PERMISSIONS: readonly CommunityPermission[] = COMMUNITY_PERMISSIONS.filter(
  (p) => !LOCAL_ADMIN_ONLY_PERMISSIONS.includes(p),
);

/** Effective permissions of one assignment: a delegate's custom list, or the role's defaults. */
export function assignmentPermissions(role: CommunityRole, custom: unknown): readonly CommunityPermission[] {
  if (role === 'LOCAL_ADMIN' || !Array.isArray(custom)) return COMMUNITY_ROLE_PERMISSIONS[role];
  const allowed = new Set<string>(DELEGABLE_PERMISSIONS);
  const list = custom.filter((p): p is CommunityPermission => typeof p === 'string' && allowed.has(p));
  // Everyone with a role can at least open the console.
  return list.includes('community.view') ? list : ['community.view', ...list];
}

/** The platform super admin controls everything, in every union. */
export const SUPER_ADMIN_COMMUNITY_PERMISSIONS: readonly CommunityPermission[] = COMMUNITY_PERMISSIONS;

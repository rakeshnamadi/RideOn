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

/** Permissions scoped to one community, granted through community_admins.role. */
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
  'community.queue.manage',
  'community.bookings.view',
  'community.complaints.manage',
  'community.announcements.manage',
  'community.statements.view',
  'community.audit.view',
] as const;
export type CommunityPermission = (typeof COMMUNITY_PERMISSIONS)[number];

export const COMMUNITY_ROLE_PERMISSIONS: Record<CommunityRole, readonly CommunityPermission[]> = {
  HEAD: COMMUNITY_PERMISSIONS,
  ADMIN: [
    'community.view',
    'community.profile.edit',
    'community.members.manage',
    'community.drivers.manage',
    'community.vehicles.manage',
    'community.areas.manage',
    'community.routes.manage',
    'community.fares.propose',
    'community.queue.manage',
    'community.bookings.view',
    'community.complaints.manage',
    'community.announcements.manage',
    'community.statements.view',
    'community.audit.view',
  ],
  APPROVER: [
    'community.view',
    'community.fares.approve',
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

/**
 * Community permissions a super admin holds on any community for oversight.
 * Deliberately excludes governance actions (proposing/approving fares, policy
 * changes) — those belong to the community; the platform reviews via its own flow.
 */
export const SUPER_ADMIN_COMMUNITY_PERMISSIONS: readonly CommunityPermission[] = [
  'community.view',
  'community.profile.edit',
  'community.admins.manage',
  'community.members.manage',
  'community.drivers.manage',
  'community.vehicles.manage',
  'community.bookings.view',
  'community.complaints.manage',
  'community.statements.view',
  'community.audit.view',
];

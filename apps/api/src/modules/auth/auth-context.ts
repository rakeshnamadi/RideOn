import type { CommunityRole } from '@prisma/client';
import { prisma } from '../../db.js';
import { forbidden, unauthorized } from '../../utils/errors.js';
import {
  COMMUNITY_ROLE_PERMISSIONS,
  SUPER_ADMIN_COMMUNITY_PERMISSIONS,
  type CommunityPermission,
  type GlobalPermission,
  type SystemRole,
} from './permissions.js';

export interface AuthContext {
  userId: string;
  name: string;
  roles: SystemRole[];
  permissions: Set<string>;
  communityRoles: { communityId: string; role: CommunityRole }[];
  driverId: string | null;
}

/**
 * Load the caller's roles from the database on every request, so suspensions and
 * role revocations take effect immediately rather than at token expiry.
 */
export async function loadAuthContext(userId: string): Promise<AuthContext> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      status: true,
      roles: { select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } } },
      communityAdminRoles: {
        where: { active: true, community: { status: { in: ['ACTIVE', 'PENDING', 'SUSPENDED'] } } },
        select: { communityId: true, role: true },
      },
      driver: { select: { id: true } },
    },
  });
  if (!user) throw unauthorized('Account not found');
  if (user.status !== 'ACTIVE') throw forbidden('This account is suspended or deactivated');

  const permissions = new Set<string>();
  for (const ur of user.roles) for (const rp of ur.role.permissions) permissions.add(rp.permission.key);

  return {
    userId: user.id,
    name: user.name,
    roles: user.roles.map((r) => r.role.key as SystemRole),
    permissions,
    communityRoles: user.communityAdminRoles,
    driverId: user.driver?.id ?? null,
  };
}

export function hasRole(ctx: AuthContext, role: SystemRole) {
  return ctx.roles.includes(role);
}

export function hasPermission(ctx: AuthContext, perm: GlobalPermission) {
  return ctx.permissions.has(perm);
}

export function isSuperAdmin(ctx: AuthContext) {
  return hasRole(ctx, 'SUPER_ADMIN');
}

/** Community-scoped permission check. This is the core of community data isolation. */
export function hasCommunityPermission(ctx: AuthContext, communityId: string, perm: CommunityPermission): boolean {
  if (isSuperAdmin(ctx) && SUPER_ADMIN_COMMUNITY_PERMISSIONS.includes(perm)) return true;
  if (!ctx.permissions.has('community.console')) return false;
  return ctx.communityRoles.some(
    (r) => r.communityId === communityId && COMMUNITY_ROLE_PERMISSIONS[r.role].includes(perm),
  );
}

export function assertCommunityPermission(ctx: AuthContext, communityId: string, perm: CommunityPermission) {
  if (!hasCommunityPermission(ctx, communityId, perm)) {
    throw forbidden('You are not authorised for this community');
  }
}

export function communityPermissionsFor(ctx: AuthContext, communityId: string): CommunityPermission[] {
  const perms = new Set<CommunityPermission>();
  if (isSuperAdmin(ctx)) SUPER_ADMIN_COMMUNITY_PERMISSIONS.forEach((p) => perms.add(p));
  if (ctx.permissions.has('community.console')) {
    for (const r of ctx.communityRoles) {
      if (r.communityId === communityId) COMMUNITY_ROLE_PERMISSIONS[r.role].forEach((p) => perms.add(p));
    }
  }
  return [...perms];
}

/** Community IDs where the caller holds the given permission (super admins: undefined = all). */
export function communitiesWithPermission(ctx: AuthContext, perm: CommunityPermission): string[] | undefined {
  if (isSuperAdmin(ctx) && SUPER_ADMIN_COMMUNITY_PERMISSIONS.includes(perm)) return undefined;
  if (!ctx.permissions.has('community.console')) return [];
  return ctx.communityRoles
    .filter((r) => COMMUNITY_ROLE_PERMISSIONS[r.role].includes(perm))
    .map((r) => r.communityId);
}

import type { CommunityRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  communitiesWithPermission,
  hasCommunityPermission,
  type AuthContext,
} from '../../src/modules/auth/auth-context.js';
import {
  assignmentPermissions,
  COMMUNITY_PERMISSIONS,
  DELEGABLE_PERMISSIONS,
  DELEGABLE_ROLES,
  ROLE_PERMISSIONS,
} from '../../src/modules/auth/permissions.js';

function ctx(partial: Omit<Partial<AuthContext>, 'communityRoles'> & { communityRoles?: { communityId: string; role: CommunityRole; custom?: string[] }[] }): AuthContext {
  const roles = partial.roles ?? [];
  return {
    userId: 'u1',
    name: 'Test',
    roles,
    permissions: new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r])),
    driverId: null,
    ...partial,
    communityRoles: (partial.communityRoles ?? []).map((r) => ({ communityId: r.communityId, role: r.role, permissions: assignmentPermissions(r.role, r.custom ?? null) })),
  };
}

describe('union roles and isolation', () => {
  const localAdminOfA = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'LOCAL_ADMIN' }] });

  it('gives a local admin every permission in their own union', () => {
    for (const p of COMMUNITY_PERMISSIONS) expect(hasCommunityPermission(localAdminOfA, 'A', p)).toBe(true);
  });

  it('grants nothing in any other union', () => {
    expect(hasCommunityPermission(localAdminOfA, 'B', 'community.view')).toBe(false);
    expect(hasCommunityPermission(localAdminOfA, 'B', 'community.bookings.view')).toBe(false);
  });

  it('gives reporters reports, driver approval and area geolocation — but not prices or the team', () => {
    const reporter = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'REPORTER' }] });
    expect(hasCommunityPermission(reporter, 'A', 'community.reports.manage')).toBe(true);
    expect(hasCommunityPermission(reporter, 'A', 'community.members.manage')).toBe(true);
    expect(hasCommunityPermission(reporter, 'A', 'community.areas.manage')).toBe(true);
    expect(hasCommunityPermission(reporter, 'A', 'community.fares.propose')).toBe(false);
    expect(hasCommunityPermission(reporter, 'A', 'community.admins.manage')).toBe(false);
    expect(hasCommunityPermission(reporter, 'A', 'community.routes.manage')).toBe(false);
  });

  it('limits approvers and operators to their roles', () => {
    const approver = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'APPROVER' }] });
    expect(hasCommunityPermission(approver, 'A', 'community.fares.approve')).toBe(true);
    expect(hasCommunityPermission(approver, 'A', 'community.feedback.manage')).toBe(true);
    expect(hasCommunityPermission(approver, 'A', 'community.fares.propose')).toBe(false);
    const operator = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'OPERATOR' }] });
    expect(hasCommunityPermission(operator, 'A', 'community.queue.manage')).toBe(true);
    expect(hasCommunityPermission(operator, 'A', 'community.routes.manage')).toBe(false);
  });

  it('applies a delegate’s custom permission list instead of the role defaults', () => {
    const custom = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'OPERATOR', custom: ['community.routes.manage'] }] });
    expect(hasCommunityPermission(custom, 'A', 'community.routes.manage')).toBe(true);
    expect(hasCommunityPermission(custom, 'A', 'community.queue.manage')).toBe(false); // not in the custom list
    expect(hasCommunityPermission(custom, 'A', 'community.view')).toBe(true); // always kept
  });

  it('never lets a delegate hold local-admin-only permissions, even if stored', () => {
    const sneaky = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'REPORTER', custom: ['community.admins.manage', 'community.policy.edit', 'not.a.permission'] }] });
    expect(hasCommunityPermission(sneaky, 'A', 'community.admins.manage')).toBe(false);
    expect(hasCommunityPermission(sneaky, 'A', 'community.policy.edit')).toBe(false);
    expect(DELEGABLE_PERMISSIONS).not.toContain('community.admins.manage');
    expect(DELEGABLE_ROLES).not.toContain('LOCAL_ADMIN');
  });

  it('ignores union roles if the COMMUNITY_ADMIN system role was revoked', () => {
    const revoked = ctx({ roles: ['PASSENGER'], communityRoles: [{ communityId: 'A', role: 'LOCAL_ADMIN' }] });
    expect(hasCommunityPermission(revoked, 'A', 'community.view')).toBe(false);
  });

  it('gives the super admin control over everything in every union', () => {
    const sa = ctx({ roles: ['SUPER_ADMIN'] });
    for (const p of COMMUNITY_PERMISSIONS) expect(hasCommunityPermission(sa, 'any-union', p)).toBe(true);
    expect(communitiesWithPermission(sa, 'community.fares.approve')).toBeUndefined();
  });

  it('lists only the unions where a permission is held', () => {
    const multi = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'OPERATOR' }, { communityId: 'B', role: 'LOCAL_ADMIN' }] });
    expect(communitiesWithPermission(multi, 'community.routes.manage')).toEqual(['B']);
    expect(communitiesWithPermission(ctx({ roles: ['PASSENGER'] }), 'community.view')).toEqual([]);
  });
});

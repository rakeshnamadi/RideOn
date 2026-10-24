import { describe, expect, it } from 'vitest';
import {
  communitiesWithPermission,
  hasCommunityPermission,
  type AuthContext,
} from '../../src/modules/auth/auth-context.js';
import { ROLE_PERMISSIONS } from '../../src/modules/auth/permissions.js';

function ctx(partial: Partial<AuthContext>): AuthContext {
  const roles = partial.roles ?? [];
  return {
    userId: 'u1',
    name: 'Test',
    roles,
    permissions: new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r])),
    communityRoles: [],
    driverId: null,
    ...partial,
  };
}

describe('community isolation', () => {
  const headOfA = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'HEAD' }] });

  it('grants a community head every permission in their own community', () => {
    expect(hasCommunityPermission(headOfA, 'A', 'community.drivers.manage')).toBe(true);
    expect(hasCommunityPermission(headOfA, 'A', 'community.fares.approve')).toBe(true);
  });

  it('grants nothing in any other community', () => {
    expect(hasCommunityPermission(headOfA, 'B', 'community.view')).toBe(false);
    expect(hasCommunityPermission(headOfA, 'B', 'community.bookings.view')).toBe(false);
  });

  it('limits approvers and operators to their roles', () => {
    const approver = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'APPROVER' }] });
    expect(hasCommunityPermission(approver, 'A', 'community.fares.approve')).toBe(true);
    expect(hasCommunityPermission(approver, 'A', 'community.fares.propose')).toBe(false);
    expect(hasCommunityPermission(approver, 'A', 'community.drivers.manage')).toBe(false);
    const operator = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'OPERATOR' }] });
    expect(hasCommunityPermission(operator, 'A', 'community.queue.manage')).toBe(true);
    expect(hasCommunityPermission(operator, 'A', 'community.routes.manage')).toBe(false);
  });

  it('ignores community roles if the COMMUNITY_ADMIN system role was revoked', () => {
    const revoked = ctx({ roles: ['PASSENGER'], communityRoles: [{ communityId: 'A', role: 'HEAD' }] });
    expect(hasCommunityPermission(revoked, 'A', 'community.view')).toBe(false);
  });

  it('gives super admins oversight but not community governance powers', () => {
    const sa = ctx({ roles: ['SUPER_ADMIN'] });
    expect(hasCommunityPermission(sa, 'A', 'community.bookings.view')).toBe(true);
    expect(hasCommunityPermission(sa, 'A', 'community.fares.propose')).toBe(false);
    expect(hasCommunityPermission(sa, 'A', 'community.fares.approve')).toBe(false);
    expect(communitiesWithPermission(sa, 'community.bookings.view')).toBeUndefined();
  });

  it('lists only the communities where a permission is held', () => {
    const multi = ctx({ roles: ['COMMUNITY_ADMIN'], communityRoles: [{ communityId: 'A', role: 'OPERATOR' }, { communityId: 'B', role: 'ADMIN' }] });
    expect(communitiesWithPermission(multi, 'community.routes.manage')).toEqual(['B']);
    expect(communitiesWithPermission(ctx({ roles: ['PASSENGER'] }), 'community.view')).toEqual([]);
  });
});

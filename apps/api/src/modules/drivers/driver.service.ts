import { prisma, type Db } from '../../db.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { hasCommunityPermission, isSuperAdmin, type AuthContext } from '../auth/auth-context.js';

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  vehicle: { id: string; registrationNumber: string; seatCapacity: number } | null;
}

/**
 * A driver may go online / accept trips for a community only when every check passes.
 * Checked on the server each time the driver goes online and again when accepting a trip.
 */
export async function getEligibility(driverId: string, communityId: string, db: Db = prisma): Promise<Eligibility> {
  const driver = await db.driver.findUnique({
    where: { id: driverId },
    include: {
      user: { select: { status: true } },
      memberships: { where: { communityId } },
      vehicleAssignments: {
        where: { active: true, vehicle: { communityId } },
        include: { vehicle: true },
      },
    },
  });
  if (!driver) throw notFound('Driver');
  const reasons: string[] = [];
  if (driver.user.status !== 'ACTIVE') reasons.push('Account is not active');
  if (driver.status !== 'ACTIVE') reasons.push('Driver is suspended');
  if (driver.verificationStatus !== 'VERIFIED') reasons.push('Identity and licence verification is not complete');
  if (driver.licenseExpiry < new Date()) reasons.push('Driving licence has expired');
  const membership = driver.memberships[0];
  if (!membership || membership.status !== 'APPROVED') reasons.push('Community membership is not approved');
  const vehicle = driver.vehicleAssignments.map((a) => a.vehicle).find((v) => v.status === 'APPROVED');
  if (!vehicle) reasons.push('No approved vehicle registered with this community');
  else {
    if (vehicle.permitExpiry && vehicle.permitExpiry < new Date()) reasons.push('Vehicle permit has expired');
    if (vehicle.insuranceExpiry && vehicle.insuranceExpiry < new Date()) reasons.push('Vehicle insurance has expired');
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    vehicle: vehicle ? { id: vehicle.id, registrationNumber: vehicle.registrationNumber, seatCapacity: vehicle.seatCapacity } : null,
  };
}

/**
 * May the caller see this driver's private records (documents, licence)?
 * The driver themself, a super admin, or a community admin with drivers.manage in a
 * community the driver has applied to or belongs to — never any other community.
 */
export async function assertCanViewDriverPrivate(ctx: AuthContext, driverId: string) {
  if (ctx.driverId === driverId || isSuperAdmin(ctx)) return;
  const memberships = await prisma.communityMembership.findMany({ where: { driverId }, select: { communityId: true } });
  if (!memberships.some((m) => hasCommunityPermission(ctx, m.communityId, 'community.drivers.manage'))) {
    throw forbidden('You are not authorised to view this driver');
  }
}

export function requireDriver(ctx: AuthContext): string {
  if (!ctx.driverId) throw forbidden('Complete your driver registration first');
  return ctx.driverId;
}

export function publicDriverView(d: {
  id: string;
  ratingSum: number;
  ratingCount: number;
  user: { name: string };
}) {
  // Only the first name is shared with passengers; phone numbers are never exposed.
  return {
    id: d.id,
    firstName: d.user.name.split(' ')[0],
    rating: d.ratingCount ? Math.round((d.ratingSum / d.ratingCount) * 10) / 10 : null,
    ratingCount: d.ratingCount,
  };
}

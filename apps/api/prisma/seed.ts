/**
 * DEVELOPMENT SEED DATA — never run against production.
 *
 * Creates demo cities, communities, fares, routes and one account per role. All demo
 * accounts share the password below; it is documented in README.md and must never be
 * used outside local development. Locations are real Bengaluru landmarks used as
 * sample data; no live driver positions are created.
 */
import { PrismaClient, type CommunityRole } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashPassword } from '../src/modules/auth/password.js';
import { GLOBAL_PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES } from '../src/modules/auth/permissions.js';
import { calculateRegularFare } from '../src/modules/fares/fare-engine.js';
import { calculateFeeSplit } from '../src/modules/payments/fees.js';

export const DEMO_PASSWORD = 'Demo@12345';
let prisma: PrismaClient;
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

async function seedRoles() {
  for (const [key, description] of Object.entries(GLOBAL_PERMISSIONS)) {
    await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
  }
  for (const key of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({ where: { key }, create: { key, name: key.replace('_', ' ').toLowerCase() }, update: {} });
    for (const permKey of ROLE_PERMISSIONS[key]) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
  }
}

async function user(name: string, phone: string, roles: string[], passwordHash: string, email?: string) {
  const roleRows = await prisma.role.findMany({ where: { key: { in: roles } } });
  return prisma.user.create({
    data: {
      name,
      phone,
      email,
      passwordHash,
      roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
      consents: { create: [{ consentType: 'TERMS_OF_SERVICE', version: '2026-10' }, { consentType: 'PRIVACY_POLICY', version: '2026-10' }] },
    },
  });
}

/** Placeholder document files so the review UI has something to open. Clearly marked as samples. */
async function sampleDocument(label: string) {
  const dir = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
  await mkdir(dir, { recursive: true });
  const storageKey = `${randomBytes(18).toString('base64url')}.bin`;
  const text = `SAMPLE DOCUMENT - DEVELOPMENT SEED DATA - ${label}`;
  const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 420 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${text.length + 40}>>stream\nBT /F1 10 Tf 10 60 Td (${text}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  await writeFile(path.join(dir, storageKey), pdf);
  return { storageKey, sizeBytes: pdf.length };
}

async function driver(
  name: string,
  phone: string,
  passwordHash: string,
  opts: { licenseNumber: string; communityId: string; registration: string; verified: boolean; membership: 'APPROVED' | 'APPLIED' },
) {
  const u = await user(name, phone, ['DRIVER'], passwordHash);
  const d = await prisma.driver.create({
    data: {
      userId: u.id,
      licenseNumber: opts.licenseNumber,
      licenseExpiry: days(900),
      verificationStatus: opts.verified ? 'VERIFIED' : 'UNDER_REVIEW',
      verifiedAt: opts.verified ? new Date() : null,
      availability: { create: {} },
    },
  });
  for (const type of ['DRIVING_LICENSE', 'ID_PROOF', 'VEHICLE_RC'] as const) {
    const file = await sampleDocument(`${type} for ${name}`);
    await prisma.driverDocument.create({
      data: { driverId: d.id, type, ...file, originalName: `${type.toLowerCase()}-sample.pdf`, mimeType: 'application/pdf', status: opts.verified ? 'APPROVED' : 'PENDING' },
    });
  }
  await prisma.communityMembership.create({
    data: { communityId: opts.communityId, driverId: d.id, status: opts.membership, decidedAt: opts.membership === 'APPROVED' ? new Date() : null, applicationNote: 'Seeded demo membership' },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      communityId: opts.communityId,
      registrationNumber: opts.registration,
      make: 'Bajaj',
      model: 'RE Compact',
      color: 'Green & Yellow',
      year: 2022,
      fuelType: 'CNG',
      seatCapacity: 3,
      permitNumber: `PERMIT-${opts.registration}`,
      permitExpiry: days(400),
      insuranceExpiry: days(300),
      status: opts.membership === 'APPROVED' ? 'APPROVED' : 'PENDING',
    },
  });
  await prisma.driverVehicleAssignment.create({ data: { driverId: d.id, vehicleId: vehicle.id } });
  return { user: u, driver: d, vehicle };
}

export async function seedDatabase(client: PrismaClient) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  prisma = client;
  if (await prisma.user.findFirst({ where: { phone: '+919000000001' } })) {
    console.log('Database already seeded — run `npm run db:reset` to start fresh.');
    return;
  }
  await seedRoles();
  const pw = await hashPassword(DEMO_PASSWORD);

  // ── Platform configuration ──
  await prisma.featureFlag.createMany({
    data: [
      { key: 'shared_autos', enabled: true, description: 'Shared-auto seat booking' },
      { key: 'online_payments', enabled: true, description: 'Online payment checkout (mock provider in development)' },
      { key: 'trip_sharing', enabled: true, description: 'Share live trip with a trusted contact' },
    ],
  });
  await prisma.platformFeeConfig.createMany({
    data: [
      { serviceType: 'REGULAR', feeBps: 500, flatFeePaise: 0, maxFeePaise: 2000, effectiveFrom: days(-60) },
      { serviceType: 'SHARED', feeBps: 300, flatFeePaise: 0, maxFeePaise: 500, effectiveFrom: days(-60) },
    ],
  });

  const blr = await prisma.city.create({ data: { name: 'Bengaluru', state: 'Karnataka', centerLat: 12.9716, centerLng: 77.5946 } });
  await prisma.city.create({ data: { name: 'Mysuru', state: 'Karnataka', centerLat: 12.2958, centerLng: 76.6394 } });

  // ── People ──
  const superAdmin = await user('Asha Platform', '+919000000001', ['SUPER_ADMIN', 'PASSENGER'], pw, 'admin@rideon.dev');
  const kmHead = await user('Ravi Kumar', '+919000000002', ['COMMUNITY_ADMIN'], pw);
  const kmAdmin = await user('Meena Shetty', '+919000000003', ['COMMUNITY_ADMIN'], pw);
  const kmApprover = await user('Joseph D\'Souza', '+919000000004', ['COMMUNITY_ADMIN'], pw);
  const inHead = await user('Farooq Ahmed', '+919000000005', ['COMMUNITY_ADMIN'], pw);
  const passenger = await user('Priya Nair', '+919000000020', ['PASSENGER'], pw, 'priya@example.com');
  await user('Arjun Rao', '+919000000021', ['PASSENGER'], pw);

  // ── Communities ──
  const koramangala = await prisma.community.create({
    data: {
      cityId: blr.id,
      name: 'Koramangala Auto Drivers Association',
      slug: 'koramangala-autos',
      registrationNumber: 'KA-SOC-2019-0412 (sample)',
      description: 'Community-run autos serving Koramangala, Madiwala and Silk Board.',
      contactPhone: '+918000000100',
      centerLat: 12.9352,
      centerLng: 77.6245,
      status: 'ACTIVE',
      policy: { create: { fareApprovalMode: 'SINGLE_APPROVER', requiredApprovals: 1, communityFeeBps: 200, maxFareIncreasePercent: 20 } },
      serviceAreas: {
        create: {
          name: 'Koramangala & Madiwala',
          polygon: [[12.9475, 77.6050], [12.9475, 77.6420], [12.9100, 77.6420], [12.9100, 77.6050]],
        },
      },
    },
  });
  const indiranagar = await prisma.community.create({
    data: {
      cityId: blr.id,
      name: 'Indiranagar Auto Union',
      slug: 'indiranagar-autos',
      description: 'Autos around Indiranagar, Domlur and HAL.',
      centerLat: 12.9719,
      centerLng: 77.6412,
      status: 'ACTIVE',
      policy: { create: { fareApprovalMode: 'MULTI_APPROVER', requiredApprovals: 2, communityFeeBps: 100 } },
      serviceAreas: {
        create: { name: 'Indiranagar & Domlur', polygon: [[12.9900, 77.6250], [12.9900, 77.6600], [12.9550, 77.6600], [12.9550, 77.6250]] },
      },
    },
  });
  await prisma.community.create({
    data: { cityId: blr.id, name: 'Jayanagar Auto Collective', slug: 'jayanagar-autos', description: 'Pending onboarding.', centerLat: 12.925, centerLng: 77.5838, status: 'PENDING', policy: { create: {} } },
  });

  const admin = (communityId: string, userId: string, role: CommunityRole) =>
    prisma.communityAdmin.create({ data: { communityId, userId, role, assignedById: superAdmin.id } });
  await admin(koramangala.id, kmHead.id, 'HEAD');
  await admin(koramangala.id, kmAdmin.id, 'ADMIN');
  await admin(koramangala.id, kmApprover.id, 'APPROVER');
  await admin(indiranagar.id, inHead.id, 'HEAD');

  // ── Places ──
  const pp = (communityId: string, name: string, lat: number, lng: number, isStand = false) =>
    prisma.pickupPoint.create({ data: { communityId, name, lat, lng, isStand } });
  const sonyWorld = await pp(koramangala.id, 'Sony World Junction', 12.9370, 77.6267, true);
  const forum = await pp(koramangala.id, 'Forum Mall Stand', 12.9346, 77.6112, true);
  const bda = await pp(koramangala.id, 'BDA Complex', 12.9312, 77.6214);
  const madiwala = await pp(koramangala.id, 'Madiwala Market', 12.9226, 77.6174);
  const silkBoard = await pp(koramangala.id, 'Silk Board Junction', 12.9177, 77.6233, true);
  const inMetro = await pp(indiranagar.id, 'Indiranagar Metro Stand', 12.9784, 77.6386, true);
  const domlur = await pp(indiranagar.id, 'Domlur Flyover', 12.9610, 77.6387);
  const hal = await pp(indiranagar.id, 'HAL 2nd Stage', 12.9700, 77.6480);

  // ── Shared routes ──
  const km1 = await prisma.sharedRoute.create({
    data: {
      communityId: koramangala.id,
      code: 'KM-1',
      name: 'Sony World → Silk Board',
      description: 'Scheduled shared auto via Forum, BDA Complex and Madiwala.',
      status: 'ACTIVE',
      maxSeats: 3,
      bookingCutoffMinutes: 5,
      cancellationCutoffMinutes: 15,
      boardingRules: 'Show your 4-digit boarding PIN to the driver. The auto waits up to 2 minutes per stop.',
      stops: {
        create: [
          { pickupPointId: sonyWorld.id, sequence: 1, offsetMinutes: 0 },
          { pickupPointId: forum.id, sequence: 2, offsetMinutes: 6 },
          { pickupPointId: bda.id, sequence: 3, offsetMinutes: 11 },
          { pickupPointId: madiwala.id, sequence: 4, offsetMinutes: 17 },
          { pickupPointId: silkBoard.id, sequence: 5, offsetMinutes: 24 },
        ],
      },
    },
  });
  const in1 = await prisma.sharedRoute.create({
    data: {
      communityId: indiranagar.id,
      code: 'IN-1',
      name: 'Metro → HAL via Domlur',
      status: 'ACTIVE',
      maxSeats: 3,
      stops: {
        create: [
          { pickupPointId: inMetro.id, sequence: 1, offsetMinutes: 0 },
          { pickupPointId: domlur.id, sequence: 2, offsetMinutes: 8 },
          { pickupPointId: hal.id, sequence: 3, offsetMinutes: 15 },
        ],
      },
    },
  });
  const times: string[] = [];
  for (let h = 7; h <= 21; h++) for (const m of ['00', '30']) times.push(`${String(h).padStart(2, '0')}:${m}`);
  await prisma.routeSchedule.createMany({ data: times.map((departureTime) => ({ routeId: km1.id, departureTime, seatCapacity: 3, validFrom: days(-1) })) });
  await prisma.routeSchedule.createMany({ data: ['08:00', '09:00', '13:00', '18:00', '19:00'].map((departureTime) => ({ routeId: in1.id, departureTime, seatCapacity: 3, validFrom: days(-1) })) });

  // ── Approved fares (as if adopted through governance) ──
  const regularFare = {
    baseFarePaise: 3000, baseDistanceMeters: 2000, perKmPaise: 1500, minimumFarePaise: 3000,
    waitingPerMinutePaise: 50, freeWaitingMinutes: 5, nightSurchargeBps: 5000, nightStartHour: 22, nightEndHour: 5,
  };
  const kmRegular = await prisma.fareRule.create({ data: { communityId: koramangala.id, serviceType: 'REGULAR', version: 1, effectiveFrom: days(-30), ...regularFare } });
  await prisma.fareRule.create({ data: { communityId: indiranagar.id, serviceType: 'REGULAR', version: 1, effectiveFrom: days(-30), ...regularFare, baseFarePaise: 3500 } });
  await prisma.fareRule.create({ data: { communityId: koramangala.id, serviceType: 'SHARED', sharedRouteId: km1.id, version: 1, effectiveFrom: days(-30), perSeatPaise: 2000, perStopPaise: 500, minimumFarePaise: 1500 } });
  await prisma.fareRule.create({ data: { communityId: indiranagar.id, serviceType: 'SHARED', sharedRouteId: in1.id, version: 1, effectiveFrom: days(-30), perSeatPaise: 2500, perStopPaise: 500 } });
  for (const c of [koramangala, indiranagar]) {
    await prisma.fareHistory.create({
      data: { communityId: c.id, serviceType: 'REGULAR', fareRuleId: (await prisma.fareRule.findFirstOrThrow({ where: { communityId: c.id, serviceType: 'REGULAR' } })).id, summary: { note: 'Initial fare table (seed data)' }, effectiveFrom: days(-30) },
    });
  }

  // ── Drivers ──
  const d1 = await driver('Suresh Gowda', '+919000000010', pw, { licenseNumber: 'KA0120190012345', communityId: koramangala.id, registration: 'KA01AB1234', verified: true, membership: 'APPROVED' });
  await driver('Manjunath B', '+919000000011', pw, { licenseNumber: 'KA0520180067890', communityId: koramangala.id, registration: 'KA05CD5678', verified: true, membership: 'APPROVED' });
  await driver('Lakshmi Devi', '+919000000012', pw, { licenseNumber: 'KA0320210054321', communityId: koramangala.id, registration: 'KA03EF9012', verified: true, membership: 'APPROVED' });
  await driver('Kiran Naik', '+919000000013', pw, { licenseNumber: 'KA5120220011111', communityId: koramangala.id, registration: 'KA51GH3456', verified: false, membership: 'APPLIED' });
  await driver('Imran Pasha', '+919000000014', pw, { licenseNumber: 'KA0420200022222', communityId: indiranagar.id, registration: 'KA04JK7890', verified: true, membership: 'APPROVED' });

  await prisma.announcement.create({
    data: { communityId: koramangala.id, title: 'Welcome to RideOn', body: 'Koramangala autos are now bookable on RideOn. Fares follow the community-approved table.', publishedById: kmHead.id },
  });

  // ── Historical completed trips (sample data) so dashboards and statements have content ──
  const rule = kmRegular;
  for (let i = 0; i < 12; i++) {
    const created = new Date(Date.now() - (i + 1) * 20 * 3_600_000);
    const distance = 2500 + i * 650;
    const fare = calculateRegularFare(rule, { distanceMeters: distance, at: created });
    const split = calculateFeeSplit(fare.totalPaise, { platformFeeBps: 500, platformFlatFeePaise: 0, platformMaxFeePaise: 2000, communityFeeBps: 200 });
    const quote = await prisma.fareQuote.create({
      data: { passengerId: passenger.id, communityId: koramangala.id, serviceType: 'REGULAR', fareRuleId: rule.id, pickupLat: sonyWorld.lat, pickupLng: sonyWorld.lng, dropLat: silkBoard.lat, dropLng: silkBoard.lng, distanceMeters: distance, durationSeconds: Math.round(distance / 5.5), distanceSource: 'estimate', farePaise: fare.totalPaise, breakdown: fare.lines as object, expiresAt: created, usedAt: created, createdAt: created },
    });
    const b = await prisma.booking.create({
      data: {
        reference: `RO-SEED${String(i).padStart(3, '0')}`,
        type: 'REGULAR', status: 'COMPLETED', passengerId: passenger.id, communityId: koramangala.id, driverId: d1.driver.id, vehicleId: d1.vehicle.id,
        fareRuleId: rule.id, quoteId: quote.id, idempotencyKey: `seed-${i}`,
        pickupLat: sonyWorld.lat, pickupLng: sonyWorld.lng, pickupAddress: 'Sony World Junction (sample)', dropLat: silkBoard.lat, dropLng: silkBoard.lng, dropAddress: 'Silk Board Junction (sample)',
        distanceMeters: distance, durationSeconds: quote.durationSeconds, quotedFarePaise: fare.totalPaise, finalFarePaise: fare.totalPaise,
        platformFeePaise: split.platformFeePaise, communityFeePaise: split.communityFeePaise, driverEarningsPaise: split.driverNetPaise,
        paymentMethod: 'CASH', paymentStatus: 'PAID', startPin: '0000', acceptedAt: created, startedAt: created, completedAt: created, createdAt: created,
        statusHistory: { create: [{ toStatus: 'COMPLETED', actorType: 'SYSTEM', reason: 'Seeded sample trip', createdAt: created }] },
        payments: { create: { amountPaise: fare.totalPaise, method: 'CASH', provider: 'cash', status: 'SUCCEEDED', successKey: `seed-${i}`, idempotencyKey: `seed-cash-${i}`, verifiedVia: 'DRIVER_CASH_CONFIRMATION' } },
      },
    });
    await prisma.platformFeeRecord.create({
      data: { bookingId: b.id, communityId: koramangala.id, ...split, platformFeeBps: 500, communityFeeBps: 200, createdAt: created },
    });
  }

  console.log(`Seed complete. Demo password for every account: ${DEMO_PASSWORD} (development only)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new PrismaClient();
  seedDatabase(client)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => client.$disconnect());
}

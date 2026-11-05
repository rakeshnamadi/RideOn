/**
 * DEVELOPMENT SEED DATA — never run against production.
 *
 * Creates demo cities, communities, fares, routes and one account per role. All demo
 * accounts share the password below; it is documented in README.md and must never be
 * used outside local development. Locations are real places around pincode 533211
 * (Ainavilli mandal, Konaseema, Andhra Pradesh) used as sample data; union details are
 * illustrative and no live driver positions are created.
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

/**
 * Spare accounts for manual debugging: two drivers ready to go online in Ainavilli and two
 * passengers with no history. Adds only the ones missing, so it is safe on a seeded database.
 */
async function seedDebugAccounts(passwordHash: string) {
  const community = await prisma.community.findUniqueOrThrow({ where: { slug: 'ainavilli-autos' } });
  const drivers = [
    { name: 'Anil Varma', phone: '+919000000015', licenseNumber: 'AP0520190033333', registration: 'AP05TF1111' },
    { name: 'Babu Rao', phone: '+919000000016', licenseNumber: 'AP0520180044444', registration: 'AP05TG2222' },
  ];
  for (const { name, phone, ...opts } of drivers) {
    if (await prisma.user.findUnique({ where: { phone } })) continue;
    await driver(name, phone, passwordHash, { ...opts, communityId: community.id, verified: true, membership: 'APPROVED' });
  }
  const passengers = [
    { name: 'Anjali Nadimpalli', phone: '+919000000022' },
    { name: 'Ravi Chowdary', phone: '+919000000023' },
  ];
  for (const { name, phone } of passengers) {
    if (await prisma.user.findUnique({ where: { phone } })) continue;
    await user(name, phone, ['PASSENGER'], passwordHash);
  }
}

export async function seedDatabase(client: PrismaClient) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  prisma = client;
  if (await prisma.user.findFirst({ where: { phone: '+919000000001' } })) {
    await seedDebugAccounts(await hashPassword(DEMO_PASSWORD));
    console.log('Database already seeded (added any missing debug accounts) — run `npm run db:reset` to start fresh.');
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

  // Primary focus: pincode 533211 — Ainavilli mandal, Dr. B.R. Ambedkar Konaseema district, Andhra Pradesh.
  // Coordinates are real places (from OpenStreetMap); union details are sample data.
  const konaseema = await prisma.city.create({ data: { name: 'Konaseema', state: 'Andhra Pradesh', centerLat: 16.6338, centerLng: 82.02 } });
  await prisma.city.create({ data: { name: 'Rajamahendravaram', state: 'Andhra Pradesh', centerLat: 17.0005, centerLng: 81.804 } });

  // ── People ──
  const superAdmin = await user('Asha Rao', '+919000000001', ['SUPER_ADMIN', 'PASSENGER'], pw, 'admin@rideon.dev');
  const avLocalAdmin = await user('Satyanarayana Murthy', '+919000000002', ['COMMUNITY_ADMIN'], pw);
  const avLocalAdmin2 = await user('Lakshmi Prasanna', '+919000000003', ['COMMUNITY_ADMIN'], pw);
  const avApprover = await user('Venkata Rao', '+919000000004', ['COMMUNITY_ADMIN'], pw);
  const amLocalAdmin = await user('Srinivas Reddy', '+919000000005', ['COMMUNITY_ADMIN'], pw);
  const avReporter = await user('Padmavathi', '+919000000006', ['COMMUNITY_ADMIN'], pw);
  const passenger = await user('Sravani Kotipalli', '+919000000020', ['PASSENGER'], pw, 'sravani@example.com');
  await user('Teja Varma', '+919000000021', ['PASSENGER'], pw);

  // ── Unions ──
  const ainavilli = await prisma.community.create({
    data: {
      cityId: konaseema.id,
      name: 'Ainavilli Auto Drivers Union',
      slug: 'ainavilli-autos',
      shortName: 'AADU',
      tagline: 'Ainavilli autos, run by Ainavilli drivers',
      registrationNumber: 'AP-KSM-AU-0211 (sample)',
      description: 'Community-run autos serving Ainavilli, Muktheswaram, Veeravallipalem, Sanapalli Lanka and Kondukuduru.',
      address: 'Ainavilli Centre, Ainavilli Mandal, Dr. B.R. Ambedkar Konaseema District, Andhra Pradesh',
      pincode: '533211',
      foundedYear: 2016,
      brandColor: '#0F4D3A',
      contactPhone: '+918000000100',
      centerLat: 16.6638,
      centerLng: 82.031,
      status: 'ACTIVE',
      policy: { create: { fareApprovalMode: 'SINGLE_APPROVER', requiredApprovals: 1, communityFeeBps: 200, maxFareIncreasePercent: 20 } },
      serviceAreas: {
        create: {
          name: 'Ainavilli mandal (533211)',
          polygon: [[16.705, 81.975], [16.705, 82.095], [16.62, 82.095], [16.62, 81.975]],
        },
      },
    },
  });
  const amalapuram = await prisma.community.create({
    data: {
      cityId: konaseema.id,
      name: 'Amalapuram Town Auto Union',
      slug: 'amalapuram-autos',
      shortName: 'ATAU',
      tagline: 'Autos around Amalapuram town',
      description: 'Autos around Amalapuram bus station, town centre and Vilasavilli.',
      address: 'APSRTC Bus Station, Amalapuram',
      pincode: '533201',
      brandColor: '#1B4F8A',
      centerLat: 16.5798,
      centerLng: 81.9978,
      status: 'ACTIVE',
      policy: { create: { fareApprovalMode: 'MULTI_APPROVER', requiredApprovals: 2, communityFeeBps: 100 } },
      serviceAreas: {
        create: { name: 'Amalapuram town', polygon: [[16.605, 81.97], [16.605, 82.075], [16.555, 82.075], [16.555, 81.97]] },
      },
    },
  });
  await prisma.community.create({
    data: { cityId: konaseema.id, name: 'Kothapeta Auto Union', slug: 'kothapeta-autos', pincode: '533223', description: 'Pending onboarding.', centerLat: 16.7168, centerLng: 81.8966, status: 'PENDING', policy: { create: {} } },
  });

  const admin = (communityId: string, userId: string, role: CommunityRole) =>
    prisma.communityAdmin.create({ data: { communityId, userId, role, assignedById: superAdmin.id } });
  await admin(ainavilli.id, avLocalAdmin.id, 'LOCAL_ADMIN');
  await admin(ainavilli.id, avLocalAdmin2.id, 'LOCAL_ADMIN');
  await admin(ainavilli.id, avApprover.id, 'APPROVER');
  await admin(ainavilli.id, avReporter.id, 'REPORTER');
  await admin(amalapuram.id, amLocalAdmin.id, 'LOCAL_ADMIN');

  // ── Places ──
  const pp = (communityId: string, name: string, lat: number, lng: number, isStand = false) =>
    prisma.pickupPoint.create({ data: { communityId, name, lat, lng, isStand } });
  const centre = await pp(ainavilli.id, 'Ainavilli Centre Stand', 16.6638, 82.031, true);
  const muktheswaram = await pp(ainavilli.id, 'Muktheswaram Stand', 16.6601, 82.0201, true);
  const veeravallipalem = await pp(ainavilli.id, 'Veeravallipalem', 16.6881, 82.0009);
  const sanapalliLanka = await pp(ainavilli.id, 'Sanapalli Lanka', 16.6571, 82.0521);
  const kondukuduru = await pp(ainavilli.id, 'Kondukuduru', 16.66, 82.0777, true);
  await pp(ainavilli.id, 'Nedunuru', 16.6406, 81.985);
  await pp(ainavilli.id, 'Pothukurru', 16.6333, 82.0697);
  await pp(ainavilli.id, 'Siripalli', 16.6296, 82.0462);
  const busStation = await pp(amalapuram.id, 'APSRTC Bus Station Stand', 16.5798, 81.9978, true);
  const townCentre = await pp(amalapuram.id, 'Amalapuram Centre', 16.5777, 82.0033);
  const vilasavilli = await pp(amalapuram.id, 'Vilasavilli', 16.5803, 82.0567);

  // ── Shared routes ──
  const av1 = await prisma.sharedRoute.create({
    data: {
      communityId: ainavilli.id,
      code: 'AV-1',
      name: 'Veeravallipalem → Kondukuduru',
      description: 'Scheduled shared auto via Muktheswaram, Ainavilli Centre and Sanapalli Lanka.',
      status: 'ACTIVE',
      maxSeats: 3,
      bookingCutoffMinutes: 5,
      cancellationCutoffMinutes: 15,
      boardingRules: 'Show your 4-digit boarding PIN to the driver. The auto waits up to 2 minutes per stop.',
      stops: {
        create: [
          { pickupPointId: veeravallipalem.id, sequence: 1, offsetMinutes: 0 },
          { pickupPointId: muktheswaram.id, sequence: 2, offsetMinutes: 6 },
          { pickupPointId: centre.id, sequence: 3, offsetMinutes: 10 },
          { pickupPointId: sanapalliLanka.id, sequence: 4, offsetMinutes: 15 },
          { pickupPointId: kondukuduru.id, sequence: 5, offsetMinutes: 22 },
        ],
      },
    },
  });
  const am1 = await prisma.sharedRoute.create({
    data: {
      communityId: amalapuram.id,
      code: 'AM-1',
      name: 'Bus Station → Vilasavilli',
      status: 'ACTIVE',
      maxSeats: 3,
      stops: {
        create: [
          { pickupPointId: busStation.id, sequence: 1, offsetMinutes: 0 },
          { pickupPointId: townCentre.id, sequence: 2, offsetMinutes: 6 },
          { pickupPointId: vilasavilli.id, sequence: 3, offsetMinutes: 14 },
        ],
      },
    },
  });
  const times: string[] = [];
  for (let h = 7; h <= 21; h++) for (const m of ['00', '30']) times.push(`${String(h).padStart(2, '0')}:${m}`);
  await prisma.routeSchedule.createMany({ data: times.map((departureTime) => ({ routeId: av1.id, departureTime, seatCapacity: 3, validFrom: days(-1) })) });
  await prisma.routeSchedule.createMany({ data: ['08:00', '09:00', '13:00', '18:00', '19:00'].map((departureTime) => ({ routeId: am1.id, departureTime, seatCapacity: 3, validFrom: days(-1) })) });

  // ── Approved fares (as if adopted through governance; sample values) ──
  const regularFare = {
    baseFarePaise: 3000, baseDistanceMeters: 2000, perKmPaise: 1500, minimumFarePaise: 3000,
    waitingPerMinutePaise: 50, freeWaitingMinutes: 5, nightSurchargeBps: 5000, nightStartHour: 22, nightEndHour: 5,
  };
  const avRegular = await prisma.fareRule.create({ data: { communityId: ainavilli.id, serviceType: 'REGULAR', version: 1, effectiveFrom: days(-30), ...regularFare } });
  await prisma.fareRule.create({ data: { communityId: amalapuram.id, serviceType: 'REGULAR', version: 1, effectiveFrom: days(-30), ...regularFare, baseFarePaise: 3500 } });
  await prisma.fareRule.create({ data: { communityId: ainavilli.id, serviceType: 'SHARED', sharedRouteId: av1.id, version: 1, effectiveFrom: days(-30), perSeatPaise: 2000, perStopPaise: 500, minimumFarePaise: 1500 } });
  await prisma.fareRule.create({ data: { communityId: amalapuram.id, serviceType: 'SHARED', sharedRouteId: am1.id, version: 1, effectiveFrom: days(-30), perSeatPaise: 2500, perStopPaise: 500 } });
  for (const c of [ainavilli, amalapuram]) {
    await prisma.fareHistory.create({
      data: { communityId: c.id, serviceType: 'REGULAR', fareRuleId: (await prisma.fareRule.findFirstOrThrow({ where: { communityId: c.id, serviceType: 'REGULAR' } })).id, summary: { note: 'Initial fare table (seed data)' }, effectiveFrom: days(-30) },
    });
  }

  // ── Drivers (AP registration numbers; sample) ──
  const d1 = await driver('Suresh Babu', '+919000000010', pw, { licenseNumber: 'AP0520190012345', communityId: ainavilli.id, registration: 'AP05TA1234', verified: true, membership: 'APPROVED' });
  const d2 = await driver('Nagaraju Pinnamaraju', '+919000000011', pw, { licenseNumber: 'AP0520180067890', communityId: ainavilli.id, registration: 'AP05TB5678', verified: true, membership: 'APPROVED' });
  await driver('Durga Prasad', '+919000000012', pw, { licenseNumber: 'AP0520210054321', communityId: ainavilli.id, registration: 'AP05TC9012', verified: true, membership: 'APPROVED' });
  await driver('Kiran Kumar', '+919000000013', pw, { licenseNumber: 'AP0520220011111', communityId: ainavilli.id, registration: 'AP05TD3456', verified: false, membership: 'APPLIED' });
  await seedDebugAccounts(pw);
  await driver('Ramesh Gollapalli', '+919000000014', pw, { licenseNumber: 'AP0520200022222', communityId: amalapuram.id, registration: 'AP05TE7890', verified: true, membership: 'APPROVED' });

  await prisma.announcement.create({
    data: { communityId: ainavilli.id, title: 'Welcome to RideOn', body: 'Ainavilli autos are now bookable on RideOn. Fares follow the union-approved table.', publishedById: avLocalAdmin.id },
  });

  // One example of driver fare feedback so the union's feedback screen has content.
  await prisma.fareFeedback.create({
    data: {
      communityId: ainavilli.id,
      driverId: d2.driver.id,
      serviceType: 'REGULAR',
      fareRuleId: avRegular.id,
      sentiment: 'TOO_LOW',
      suggestedPerKmPaise: 1700,
      comment: 'Sample feedback: CNG prices went up; the per-km rate on the Kondukuduru side does not cover the empty return trip.',
    },
  });

  // ── Historical completed trips (sample data) so dashboards, reports and statements have content ──
  const rule = avRegular;
  for (let i = 0; i < 12; i++) {
    const created = new Date(Date.now() - (i + 1) * 20 * 3_600_000);
    const distance = 2500 + i * 650;
    const fare = calculateRegularFare(rule, { distanceMeters: distance, at: created });
    const split = calculateFeeSplit(fare.totalPaise, { platformFeeBps: 500, platformFlatFeePaise: 0, platformMaxFeePaise: 2000, communityFeeBps: 200 });
    const quote = await prisma.fareQuote.create({
      data: { passengerId: passenger.id, communityId: ainavilli.id, serviceType: 'REGULAR', fareRuleId: rule.id, pickupLat: centre.lat, pickupLng: centre.lng, dropLat: kondukuduru.lat, dropLng: kondukuduru.lng, distanceMeters: distance, durationSeconds: Math.round(distance / 5.5), distanceSource: 'estimate', farePaise: fare.totalPaise, breakdown: fare.lines as object, expiresAt: created, usedAt: created, createdAt: created },
    });
    const b = await prisma.booking.create({
      data: {
        reference: `RO-SEED${String(i).padStart(3, '0')}`,
        type: 'REGULAR', status: 'COMPLETED', passengerId: passenger.id, communityId: ainavilli.id, driverId: d1.driver.id, vehicleId: d1.vehicle.id,
        fareRuleId: rule.id, quoteId: quote.id, idempotencyKey: `seed-${i}`,
        pickupLat: centre.lat, pickupLng: centre.lng, pickupAddress: 'Ainavilli Centre Stand (sample)', dropLat: kondukuduru.lat, dropLng: kondukuduru.lng, dropAddress: 'Kondukuduru (sample)',
        distanceMeters: distance, durationSeconds: quote.durationSeconds, quotedFarePaise: fare.totalPaise, finalFarePaise: fare.totalPaise,
        platformFeePaise: split.platformFeePaise, communityFeePaise: split.communityFeePaise, driverEarningsPaise: split.driverNetPaise,
        paymentMethod: 'CASH', paymentStatus: 'PAID', startPin: '0000', acceptedAt: created, startedAt: created, completedAt: created, createdAt: created,
        statusHistory: { create: [{ toStatus: 'COMPLETED', actorType: 'SYSTEM', reason: 'Seeded sample trip', createdAt: created }] },
        payments: { create: { amountPaise: fare.totalPaise, method: 'CASH', provider: 'cash', status: 'SUCCEEDED', successKey: `seed-${i}`, idempotencyKey: `seed-cash-${i}`, verifiedVia: 'DRIVER_CASH_CONFIRMATION' } },
      },
    });
    await prisma.platformFeeRecord.create({
      data: { bookingId: b.id, communityId: ainavilli.id, ...split, platformFeeBps: 500, communityFeeBps: 200, createdAt: created },
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

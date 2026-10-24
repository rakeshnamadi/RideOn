import type { Booking, ServiceType } from '@prisma/client';
import { prisma, withTransaction, type Db, type Tx } from '../../db.js';
import { logger } from '../../config/logger.js';
import { conflict, forbidden, notFound, serviceUnavailable, unauthorized, unprocessable } from '../../utils/errors.js';
import { audit } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { notify } from '../notifications/notification.service.js';
import { emitToUser } from '../../sockets/index.js';
import { calculateFeeSplit, type FeeSplit } from './fees.js';
import { onlineProvider, type WebhookEvent } from './providers.js';

export const DEFAULT_PLATFORM_FEE_BPS = 500;

export async function getFeeConfig(serviceType: ServiceType, communityId: string, db: Db = prisma) {
  const [platform, policy] = await Promise.all([
    db.platformFeeConfig.findFirst({ where: { serviceType, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } }),
    db.communityPolicy.findUnique({ where: { communityId }, select: { communityFeeBps: true } }),
  ]);
  return {
    platformFeeBps: platform?.feeBps ?? DEFAULT_PLATFORM_FEE_BPS,
    platformFlatFeePaise: platform?.flatFeePaise ?? 0,
    platformMaxFeePaise: platform?.maxFeePaise ?? null,
    communityFeeBps: policy?.communityFeeBps ?? 0,
  };
}

/** Record the revenue split for a completed booking (once — bookingId is unique on fee records). */
export async function recordFeeSplit(tx: Tx, booking: Pick<Booking, 'id' | 'type' | 'communityId'>, farePaise: number): Promise<FeeSplit> {
  const cfg = await getFeeConfig(booking.type, booking.communityId, tx);
  const split = calculateFeeSplit(farePaise, cfg);
  await tx.platformFeeRecord.create({
    data: {
      bookingId: booking.id,
      communityId: booking.communityId,
      farePaise: split.farePaise,
      platformFeePaise: split.platformFeePaise,
      communityFeePaise: split.communityFeePaise,
      processingFeePaise: split.processingFeePaise,
      driverNetPaise: split.driverNetPaise,
      platformFeeBps: cfg.platformFeeBps,
      communityFeeBps: cfg.communityFeeBps,
    },
  });
  return split;
}

function amountDue(b: Booking) {
  return b.finalFarePaise ?? b.quotedFarePaise;
}

/** Driver confirms the passenger paid cash. Only the assigned driver can do this, once. */
export async function confirmCashPayment(ctx: AuthContext, bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw notFound('Booking');
  if (!ctx.driverId || booking.driverId !== ctx.driverId) throw forbidden('Only the assigned driver can confirm cash');
  if (booking.paymentMethod !== 'CASH') throw unprocessable('This booking is not a cash booking', 'NOT_CASH');
  if (booking.status !== 'COMPLETED') throw unprocessable('Cash can be confirmed after the trip is completed', 'NOT_COMPLETED');
  if (booking.paymentStatus === 'PAID') return { alreadyPaid: true };
  await withTransaction(async (tx) => {
    await tx.payment.create({
      data: {
        bookingId,
        amountPaise: amountDue(booking),
        method: 'CASH',
        provider: 'cash',
        status: 'SUCCEEDED',
        successKey: bookingId,
        idempotencyKey: `cash:${bookingId}`,
        verifiedVia: 'DRIVER_CASH_CONFIRMATION',
      },
    });
    await tx.booking.update({ where: { id: bookingId }, data: { paymentStatus: 'PAID' } });
    await audit({ action: 'payment.cash_confirmed', entityType: 'Booking', entityId: bookingId, communityId: booking.communityId, after: { amountPaise: amountDue(booking) } }, { ctx }, tx);
  });
  emitToUser(booking.passengerId, 'booking:updated', { bookingId });
  return { alreadyPaid: false };
}

/** Start a hosted online checkout. The payment becomes SUCCEEDED only via a verified webhook. */
export async function createCheckout(ctx: AuthContext, bookingId: string) {
  const provider = onlineProvider();
  if (!provider) throw serviceUnavailable('Online payments are not configured. Please pay in cash.');
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw notFound('Booking');
  if (booking.passengerId !== ctx.userId) throw forbidden();
  if (booking.paymentMethod === 'CASH') throw unprocessable('This booking is set to cash payment', 'CASH_BOOKING');
  if (booking.paymentStatus === 'PAID') throw conflict('This booking is already paid', 'ALREADY_PAID');
  const payable =
    booking.type === 'REGULAR' ? booking.status === 'COMPLETED' : ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status);
  if (!payable) throw unprocessable('This booking cannot be paid in its current state', 'NOT_PAYABLE');

  const pending = await prisma.payment.findFirst({ where: { bookingId, status: 'PENDING', provider: provider.name } });
  if (pending?.providerRef) {
    return { paymentId: pending.id, checkoutUrl: `/api/v1/payments/mock-gateway/${pending.providerRef}?p=${pending.id}` };
  }
  const attempt = await prisma.payment.count({ where: { bookingId } });
  const payment = await prisma.payment.create({
    data: { bookingId, amountPaise: amountDue(booking), method: booking.paymentMethod, provider: provider.name, status: 'CREATED', idempotencyKey: `online:${bookingId}:${attempt + 1}` },
  });
  const session = await provider.createCheckout({ paymentId: payment.id, amountPaise: payment.amountPaise, bookingReference: booking.reference });
  await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: session.providerRef, status: 'PENDING' } });
  await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: 'PAYMENT_PENDING' } });
  return { paymentId: payment.id, checkoutUrl: session.checkoutUrl };
}

/** Process a provider webhook. Idempotent: replays of an already-applied event are no-ops. */
export async function handleWebhook(rawBody: string, signature: string | undefined) {
  const provider = onlineProvider();
  if (!provider) throw serviceUnavailable('Online payments are not configured');
  let event: WebhookEvent;
  try {
    event = provider.verifyWebhook(rawBody, signature);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Rejected payment webhook');
    throw unauthorized('Invalid webhook signature');
  }
  const payment = await prisma.payment.findUnique({ where: { providerRef: event.providerRef }, include: { booking: true } });
  if (!payment) throw notFound('Payment');
  if (event.type === 'refund.succeeded') return { ignored: true };
  if (payment.status === 'SUCCEEDED' || payment.status === 'FAILED') return { duplicate: true };
  if (event.amountPaise !== payment.amountPaise) {
    logger.error({ paymentId: payment.id }, 'Webhook amount mismatch');
    throw unprocessable('Amount mismatch', 'AMOUNT_MISMATCH');
  }

  const succeeded = event.type === 'payment.succeeded';
  await withTransaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: succeeded
        ? { status: 'SUCCEEDED', successKey: payment.bookingId, verifiedVia: 'WEBHOOK', processingFeePaise: event.processingFeePaise ?? 0 }
        : { status: 'FAILED', failureReason: event.failureReason?.slice(0, 255) ?? 'Declined', verifiedVia: 'WEBHOOK' },
    });
    if (updated.count === 0) return;
    await tx.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus: succeeded ? 'PAID' : 'PAYMENT_FAILED' } });
    if (succeeded && event.processingFeePaise) {
      // Processing fees reduce the driver's net, recorded transparently on the fee record.
      const rec = await tx.platformFeeRecord.findUnique({ where: { bookingId: payment.bookingId } });
      if (rec) {
        await tx.platformFeeRecord.update({
          where: { id: rec.id },
          data: { processingFeePaise: event.processingFeePaise, driverNetPaise: rec.driverNetPaise + rec.processingFeePaise - event.processingFeePaise },
        });
      }
    }
    await audit({ action: succeeded ? 'payment.succeeded' : 'payment.failed', entityType: 'Payment', entityId: payment.id, communityId: payment.booking.communityId, after: { providerRef: event.providerRef, amountPaise: event.amountPaise } }, {}, tx);
  });
  await notify(payment.booking.passengerId, {
    type: succeeded ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_FAILED',
    title: succeeded ? 'Payment received' : 'Payment failed',
    body: `Booking ${payment.booking.reference}`,
    link: `/app/bookings/${payment.bookingId}`,
  });
  emitToUser(payment.booking.passengerId, 'booking:updated', { bookingId: payment.bookingId });
  return { applied: true };
}

/** Refund an online payment (full or partial). Cash refunds are recorded as manual settlements. */
export async function refundPayment(paymentId: string, amountPaise: number, reason: string, actorId: string, db?: Tx) {
  const run = async (tx: Tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
    if (!payment) throw notFound('Payment');
    if (payment.status !== 'SUCCEEDED') throw unprocessable('Only successful payments can be refunded', 'NOT_REFUNDABLE');
    const refunded = payment.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + r.amountPaise, 0);
    if (amountPaise <= 0 || refunded + amountPaise > payment.amountPaise) throw unprocessable('Refund exceeds the refundable amount', 'REFUND_TOO_LARGE');
    let status: 'SUCCEEDED' | 'PENDING' = 'PENDING';
    if (payment.method !== 'CASH') {
      const provider = onlineProvider();
      if (!provider || !payment.providerRef) throw serviceUnavailable('Payment provider unavailable for refunds');
      status = (await provider.refund({ providerRef: payment.providerRef, amountPaise })).status;
    }
    const refund = await tx.refund.create({ data: { paymentId, amountPaise, reason, status, createdById: actorId } });
    const fully = refunded + amountPaise === payment.amountPaise;
    await tx.booking.update({ where: { id: payment.bookingId }, data: { paymentStatus: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    return refund;
  };
  return db ? run(db) : withTransaction(run);
}

import express, { Router } from 'express';
import { z } from 'zod';
import { isProd } from '../../config/env.js';
import { prisma } from '../../db.js';
import { auth, authenticate, requirePermission } from '../../middleware/auth.js';
import { notFound } from '../../utils/errors.js';
import { IdParam, created, ok, parse, param } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { confirmCashPayment, createCheckout, handleWebhook, refundPayment } from './payment.service.js';
import { signPayload } from './providers.js';

export const paymentRoutes = Router();

/** Provider webhooks need the raw body to verify the signature. */
paymentRoutes.post('/webhooks/:provider', express.text({ type: '*/*', limit: '64kb' }), async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : '';
  ok(res, await handleWebhook(raw, req.header('x-signature') ?? undefined));
});

// ─────────── DEVELOPMENT-ONLY mock hosted checkout ───────────

paymentRoutes.get('/mock-gateway/:ref', async (req, res) => {
  if (isProd) throw notFound();
  const payment = await prisma.payment.findUnique({ where: { providerRef: param(req, 'ref') }, include: { booking: { select: { reference: true } } } });
  if (!payment) throw notFound('Payment');
  const amount = (payment.amountPaise / 100).toFixed(2);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock payment gateway</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#1f2937}.warn{background:#fef3c7;border:1px solid #f59e0b;padding:12px;border-radius:8px}button{font-size:16px;padding:12px 16px;border-radius:8px;border:0;margin:8px 8px 0 0;cursor:pointer}.ok{background:#047857;color:#fff}.fail{background:#b91c1c;color:#fff}</style></head>
<body><div class="warn"><strong>MOCK PAYMENT — DEVELOPMENT ONLY.</strong> No real money moves. This page simulates a payment provider's hosted checkout.</div>
<h1>Pay ₹${amount}</h1><p>Booking ${payment.booking.reference}</p><p>Status: ${payment.status}</p>
${payment.status === 'PENDING' ? `<form method="post" action="/api/v1/payments/mock-gateway/${payment.providerRef}/complete"><button class="ok" name="outcome" value="success">Simulate success</button><button class="fail" name="outcome" value="failure">Simulate failure</button></form>` : '<p>This checkout is closed. You can return to the app.</p>'}
</body></html>`);
});

paymentRoutes.post('/mock-gateway/:ref/complete', express.urlencoded({ extended: false }), async (req, res) => {
  if (isProd) throw notFound();
  const payment = await prisma.payment.findUnique({ where: { providerRef: param(req, 'ref') } });
  if (!payment) throw notFound('Payment');
  const outcome = req.body?.outcome === 'success' ? 'payment.succeeded' : 'payment.failed';
  // Simulate the provider calling our webhook: the event is signed and goes through full verification.
  const raw = JSON.stringify({ type: outcome, providerRef: payment.providerRef, amountPaise: payment.amountPaise, failureReason: outcome === 'payment.failed' ? 'Simulated decline' : undefined });
  await handleWebhook(raw, signPayload(raw));
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Mock payment</title><body style="font-family:system-ui;max-width:420px;margin:40px auto"><p><strong>MOCK PAYMENT — DEVELOPMENT ONLY.</strong></p><p>Simulated ${outcome === 'payment.succeeded' ? 'success' : 'failure'}. You can close this tab and return to RideOn.</p></body>`);
});

// ─────────── Authenticated ───────────

paymentRoutes.use(authenticate);

paymentRoutes.post('/bookings/:id/checkout', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  created(res, await createCheckout(auth(req), id));
});

paymentRoutes.post('/bookings/:id/cash-confirm', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  ok(res, await confirmCashPayment(auth(req), id));
});

paymentRoutes.post('/:id/refunds', requirePermission('platform.support.manage'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ amountPaise: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }), req.body);
  const refund = await refundPayment(id, body.amountPaise, body.reason, auth(req).userId);
  await audit({ action: 'payment.refund_issued', entityType: 'Payment', entityId: id, after: body }, { ctx: req.auth, req });
  created(res, refund);
});

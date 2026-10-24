import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { randomToken } from '../../utils/ids.js';

export interface CheckoutSession {
  providerRef: string;
  checkoutUrl: string;
}

export interface WebhookEvent {
  type: 'payment.succeeded' | 'payment.failed' | 'refund.succeeded';
  providerRef: string;
  amountPaise: number;
  processingFeePaise?: number;
  failureReason?: string;
}

/**
 * Payment provider abstraction. A real provider (e.g. a hosted-checkout gateway) implements
 * the same interface: create a hosted checkout, verify signed webhooks, issue refunds.
 * Card data never touches this application.
 */
export interface PaymentProvider {
  name: string;
  createCheckout(input: { paymentId: string; amountPaise: number; bookingReference: string }): Promise<CheckoutSession>;
  verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent;
  refund(input: { providerRef: string; amountPaise: number }): Promise<{ refundRef: string; status: 'SUCCEEDED' | 'PENDING' }>;
}

export function signPayload(rawBody: string): string {
  return createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

/**
 * DEVELOPMENT-ONLY mock provider. Its "hosted checkout" is a page served by this API that is
 * clearly labelled as a simulation. Completing it sends an HMAC-signed webhook through the same
 * verification path a real provider would use — the client can never mark a payment as paid.
 */
export const mockProvider: PaymentProvider = {
  name: 'mock',
  async createCheckout({ paymentId }) {
    const providerRef = `mock_${randomToken(18)}`;
    return { providerRef, checkoutUrl: `/api/v1/payments/mock-gateway/${providerRef}?p=${paymentId}` };
  },
  verifyWebhook(rawBody, signature) {
    if (!signature) throw new Error('Missing signature');
    const expected = Buffer.from(signPayload(rawBody), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error('Invalid signature');
    return JSON.parse(rawBody) as WebhookEvent;
  },
  async refund() {
    return { refundRef: `mock_refund_${randomToken(12)}`, status: 'SUCCEEDED' };
  },
};

export function onlineProvider(): PaymentProvider | null {
  return env.PAYMENT_PROVIDER === 'mock' ? mockProvider : null;
}

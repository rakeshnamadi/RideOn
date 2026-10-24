import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/**
 * Run work in a transaction, retrying on MySQL deadlocks / lock-wait timeouts,
 * which are expected under contention (e.g. concurrent seat reservations).
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  opts: { retries?: number; isolationLevel?: Prisma.TransactionIsolationLevel } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: opts.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15_000,
        maxWait: 10_000,
      });
    } catch (err) {
      if (attempt < retries && isRetryableTxError(err)) {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1) + Math.random() * 50));
        continue;
      }
      throw err;
    }
  }
}

function isRetryableTxError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: write conflict or deadlock
    if (err.code === 'P2034') return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /deadlock|lock wait timeout|1213|1205/i.test(msg);
}

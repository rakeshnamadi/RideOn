import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

// Argon2id (algorithm 2) with OWASP-recommended minimums: 19 MiB memory, 2 iterations.
const ARGON_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used to equalise timing when the account does not exist.
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string) {
  dummyHash ??= hashPassword('dummy-password-for-timing-1');
  return dummyHash.then((h) => verifyPassword(h, password));
}

import { createHash, randomBytes, randomInt } from 'node:crypto';

// Unambiguous alphabet (no 0/O, 1/I/L) for references people read aloud.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function reference(prefix: string, length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${out}`;
}

export function pin4(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

import multer from 'multer';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';
import { randomToken } from '../utils/ids.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Files stay in memory until their content is verified, then go to private storage outside any web root. */
export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
});

/** Union logos: one small image. */
export const MAX_LOGO_BYTES = 1024 * 1024;
export const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 2 },
});

const SIGNATURES: { mime: string; bytes: number[] }[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** Identify the file type from its content (magic bytes), never from the client-supplied name or MIME type. */
export function detectMime(buffer: Buffer): string | null {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => buffer[i] === b))?.mime ?? null;
}

const uploadRoot = () => path.resolve(env.UPLOAD_DIR);

export async function storePrivateFile(buffer: Buffer): Promise<{ storageKey: string; mimeType: string }> {
  const mimeType = detectMime(buffer);
  if (!mimeType) throw badRequest('Only PDF, JPEG or PNG files are accepted');
  await mkdir(uploadRoot(), { recursive: true });
  const storageKey = `${randomToken(24)}.bin`;
  await writeFile(path.join(uploadRoot(), storageKey), buffer, { flag: 'wx' });
  return { storageKey, mimeType };
}

export async function readPrivateFile(storageKey: string): Promise<Buffer> {
  if (!/^[\w-]+\.bin$/.test(storageKey)) throw badRequest('Invalid storage key');
  return readFile(path.join(uploadRoot(), storageKey));
}

export function safeFilename(name: string) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';
}

export async function deletePrivateFile(storageKey: string | null | undefined) {
  if (!storageKey || !/^[\w-]+\.bin$/.test(storageKey)) return;
  await rm(path.join(uploadRoot(), storageKey), { force: true });
}

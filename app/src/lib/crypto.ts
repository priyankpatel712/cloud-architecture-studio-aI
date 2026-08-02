import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for stored connection session material (Constitution III:
 * secrets encrypted at rest). AES-256-GCM; the wire format is `iv.tag.ciphertext`,
 * each part base64url.
 *
 * Key: ENCRYPTION_KEY (base64, 32 bytes). In non-production a key is derived from
 * AUTH_SECRET so the dev loop works before ENCRYPTION_KEY is provisioned; production
 * refuses to start encrypting without a real key.
 */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    return k;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY is required in production');
  }
  const seed = process.env.AUTH_SECRET;
  if (!seed) throw new Error('Set ENCRYPTION_KEY or AUTH_SECRET');
  return createHash('sha256').update(`encryption:${seed}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

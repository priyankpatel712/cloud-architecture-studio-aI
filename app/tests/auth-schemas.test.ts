import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  registerSchema,
  forgotSchema,
  resetSchema,
  verifyConfirmSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@/lib/schemas';

describe('auth/user schemas', () => {
  it('login normalizes email and requires a password', () => {
    const ok = loginSchema.safeParse({ email: '  ME@X.CO ', password: 'x' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.email).toBe('me@x.co');
    expect(loginSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });

  it('register enforces email format, name, and password length', () => {
    expect(registerSchema.safeParse({ name: 'A', email: 'notanemail', password: 'abcdefgh' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: '', email: 'a@b.co', password: 'abcdefgh' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'A', email: 'A@B.CO', password: 'abcdefgh' }).success).toBe(true);
  });

  it('rejects NoSQL-operator objects instead of strings', () => {
    expect(loginSchema.safeParse({ email: { $gt: '' }, password: { $gt: '' } }).success).toBe(false);
    expect(resetSchema.safeParse({ email: { $ne: null }, token: 'x', password: 'abcdefgh' }).success).toBe(false);
  });

  it('caps oversized input', () => {
    const huge = 'a'.repeat(100_000);
    expect(registerSchema.safeParse({ name: 'A', email: 'a@b.co', password: huge }).success).toBe(false);
    expect(loginSchema.safeParse({ email: huge + '@b.co', password: 'x' }).success).toBe(false);
  });

  it('forgot is lenient (empty allowed) but caps length', () => {
    expect(forgotSchema.safeParse({}).success).toBe(true);
    expect(forgotSchema.safeParse({ email: 'a'.repeat(400) }).success).toBe(false);
  });

  it('userCreate validates role enum and defaults', () => {
    const ok = userCreateSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'abcdefgh' });
    expect(ok.success && ok.data.role).toBe('user');
    expect(userCreateSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'abcdefgh', role: 'root' }).success).toBe(false);
  });

  it('userUpdate rejects bad status/role and accepts partials', () => {
    expect(userUpdateSchema.safeParse({ status: 'banned' }).success).toBe(false);
    expect(userUpdateSchema.safeParse({ name: 'New Name' }).success).toBe(true);
    expect(userUpdateSchema.safeParse({ password: 'short' }).success).toBe(false);
  });

  it('verifyConfirm requires email + token', () => {
    expect(verifyConfirmSchema.safeParse({ email: 'a@b.co', token: 't' }).success).toBe(true);
    expect(verifyConfirmSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });
});

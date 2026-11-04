import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'laba_session';
export const SESSION_SECONDS = 60 * 60 * 12;

function secret() {
  const value = process.env.SESSION_SECRET;
  return value && value.length >= 32 ? value : null;
}

function signature(payload: string, key: string) {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function createSession() {
  const key = secret();
  if (!key) return null;
  const payload = Buffer.from(String(Date.now() + SESSION_SECONDS * 1000)).toString('base64url');
  return `${payload}.${signature(payload, key)}`;
}

export function isValidSession(value?: string) {
  const key = secret();
  if (!key || !value) return false;
  const [payload, supplied, extra] = value.split('.');
  if (!payload || !supplied || extra) return false;
  const expected = Buffer.from(signature(payload, key));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  const expiresAt = Number(Buffer.from(payload, 'base64url').toString());
  return Number.isSafeInteger(expiresAt) && expiresAt > Date.now();
}

export function authConfigured() {
  return Boolean(process.env.CHAT_PASSWORD?.length && secret());
}

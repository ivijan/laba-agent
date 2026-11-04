import { timingSafeEqual } from 'node:crypto';
import { authConfigured, createSession, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/auth';
import { checkLoginLimit } from '@/lib/login-rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!authConfigured()) return Response.json({ error: 'Logowanie jest niedostępne: brak konfiguracji.' }, { status: 503 });
  let password: unknown;
  try { password = (await request.json()).password; }
  catch { return Response.json({ error: 'Nieprawidłowe żądanie.' }, { status: 400 }); }
  if (typeof password !== 'string') return Response.json({ error: 'Nieprawidłowe żądanie.' }, { status: 400 });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = await checkLoginLimit(ip);
  if (!limit.allowed) return Response.json({ error: 'Za dużo prób. Spróbuj później.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });

  const expected = process.env.CHAT_PASSWORD!;
  const suppliedBytes = Buffer.from(password);
  const expectedBytes = Buffer.from(expected);
  const valid = suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
  if (!valid) return Response.json({ error: 'Nieprawidłowe hasło.' }, { status: 401 });
  const token = createSession();
  if (!token) return Response.json({ error: 'Logowanie jest niedostępne: brak konfiguracji.' }, { status: 503 });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Lax${secure}` } });
}

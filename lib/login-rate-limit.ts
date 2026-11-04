import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const directory = path.join(process.cwd(), '.data');

// Persistent local storage avoids a per-process counter. Multi-instance deployments
// must enforce a shared limit at the hosting edge or provide shared durable storage.
export async function checkLoginLimit(ip: string) {
  await mkdir(directory, { recursive: true });
  const id = createHash('sha256').update(ip).digest('hex');
  const file = path.join(directory, `login-${id}.json`);
  const lock = `${file}.lock`;
  let lockHandle;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { lockHandle = await open(lock, 'wx'); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
  }
  if (!lockHandle) return { allowed: false, retryAfter: 60 };
  try {
    let state: { started: number; count: number } = { started: Date.now(), count: 0 };
    try { state = JSON.parse(await readFile(file, 'utf8')); } catch { /* first attempt */ }
    const now = Date.now();
    if (now - state.started >= WINDOW_MS || now < state.started) state = { started: now, count: 0 };
    if (state.count >= MAX_ATTEMPTS) return { allowed: false, retryAfter: Math.max(1, Math.ceil((state.started + WINDOW_MS - now) / 1000)) };
    state.count++;
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, file);
    return { allowed: true, retryAfter: 0 };
  } finally {
    await lockHandle.close();
    await unlink(lock).catch(() => undefined);
  }
}

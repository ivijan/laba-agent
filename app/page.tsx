import { cookies } from 'next/headers';
import Chat from './chat';
import Login from './login';
import { authConfigured, isValidSession, SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const store = await cookies();
  if (authConfigured() && isValidSession(store.get(SESSION_COOKIE)?.value)) return <Chat />;
  return <Login configured={authConfigured()} />;
}

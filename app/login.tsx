'use client';
import { useState, type FormEvent } from 'react';

export default function Login({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || 'Nie udało się zalogować.'); return; }
      window.location.reload();
    } catch { setError('Nie udało się połączyć z serwerem.'); }
    finally { setBusy(false); }
  }
  return <main className="login-shell"><form className="login-card" onSubmit={submit}><div className="brand-mark" aria-hidden="true">L</div><p className="eyebrow">LABA &#183; ASYSTENT AI</p><h1>Wpisz hasło</h1>{configured ? <><label className="sr-only" htmlFor="workshop-password">Hasło warsztatowe</label><input id="workshop-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Hasło warsztatowe"/><button type="submit" disabled={busy || !password}>{busy ? 'Sprawdzanie…' : 'Wejdź'}</button></> : <p className="login-error">Dostęp jest zablokowany. Administrator musi ustawić CHAT_PASSWORD i SESSION_SECRET.</p>}{error && <p className="login-error" role="alert">{error}</p>}</form></main>;
}

'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { type FormEvent, useState } from 'react';

function readableError(message: string): string {
  try { const parsed: unknown = JSON.parse(message); if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') return parsed.error; }
  catch { /* SDK can return plain text */ }
  return message;
}

export default function Chat() {
  const { messages, sendMessage, status, error } = useChat({ transport: new DefaultChatTransport({ api: '/api/chat' }) });
  const [input, setInput] = useState('');
  const isBusy = status === 'submitted' || status === 'streaming';
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = input.trim(); if (!text || isBusy) return; sendMessage({ text }); setInput('');
  }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); window.location.reload(); }
  return (
    <main className="chat-shell">
      <header className="chat-header"><div className="brand-mark" aria-hidden="true">L</div><div><p className="eyebrow">LABA &#183; ASYSTENT AI</p><h1>M&#243;j chatbot</h1></div><span className="connection-status"><span /> Chat AI</span><button className="logout-button" onClick={logout}>Wyjdź</button></header>
      <section className="conversation" aria-label="Rozmowa" aria-live="polite">
        {messages.length === 0 ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">&#10035;</div><h2>W czym mog&#281; pom&#243;c?</h2><p>Napisz wiadomo&#347;&#263;, aby rozpocz&#261;&#263; rozmow&#281;.</p></div> : <div className="message-list">{messages.map((message) => <article className={`message ${message.role === 'user' ? 'message-user' : 'message-assistant'}`} key={message.id}><span className="message-author">{message.role === 'user' ? 'Ty' : 'Asystent'}</span><div className="message-bubble">{message.parts.map((part, index) => part.type === 'text' ? <p key={`${message.id}-${index}`}>{part.text}</p> : null)}</div></article>)}{isBusy && <div className="working-state" role="status"><span className="typing-dots"><i /><i /><i /></span>{status === 'submitted' ? 'Wysyłanie wiadomości...' : 'Asystent pisze...'}</div>}</div>}
      </section>
      {error && <p className="error-message" role="alert">{readableError(error.message)}</p>}
      <form className="message-form" onSubmit={handleSubmit}><label className="sr-only" htmlFor="chat-message">Wiadomo&#347;&#263;</label><input id="chat-message" autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} disabled={isBusy} placeholder="Napisz wiadomość..."/><button type="submit" disabled={isBusy || !input.trim()} aria-label="Wyślij wiadomość">{isBusy ? <span className="send-spinner" aria-hidden="true" /> : <span aria-hidden="true">&#8593;</span>}</button></form>
      <p className="privacy-note">Odpowiedzi s&#261; generowane przez AI i mog&#261; zawiera&#263; b&#322;&#281;dy.</p>
    </main>
  );
}

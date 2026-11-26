"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "../components/ThemeProvider";

type Conversation = { id: string | number; title: string | null; created_at: string; messageCount: number };

export default function HistoryList({ botName }: { botName: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversations").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Nie udało się wczytać historii.");
      if (!cancelled) setConversations(data.conversations ?? []);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Nie udało się wczytać historii.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function newConversation() {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/conversations", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.conversation?.id) throw new Error(data?.error ?? "Nie udało się utworzyć rozmowy.");
      router.push(`/?id=${encodeURIComponent(String(data.conversation.id))}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się utworzyć rozmowy.");
      setCreating(false);
    }
  }

  return (
    <section className="card history-page">
      <header className="chat-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">SN</span><div className="brand-copy"><h1>{botName}</h1><p className="chat-intro">Historia rozmów</p></div></div>
        <div className="header-actions">
          <button type="button" onClick={newConversation} disabled={creating}>{creating ? "Tworzę…" : "Nowa rozmowa"}</button>
          <Link href="/" className="header-link">Czat</Link>
          <ThemeToggle />
        </div>
      </header>
      <div className="history-list">
        {loading && <p className="muted">Wczytuję historię…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && conversations.length === 0 && <p className="muted">Nie ma jeszcze zapisanych rozmów.</p>}
        {conversations.map((conversation) => (
          <Link className="history-item" href={`/?id=${encodeURIComponent(String(conversation.id))}`} key={conversation.id}>
            <strong>{conversation.title?.trim() || "Nowa rozmowa"}</strong>
            <span className="small">{new Date(conversation.created_at).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" })} · {conversation.messageCount} wiadomości</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

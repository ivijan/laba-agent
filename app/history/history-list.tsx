"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "../components/ThemeProvider";

type Conversation = { id: string | number; title: string | null; created_at: string; messageCount: number };

export default function HistoryList({ botName, emptyMessage }: { botName: string; emptyMessage: string }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

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

  async function deleteConversation(conversation: Conversation) {
    if (!window.confirm(`Usunąć rozmowę „${conversation.title || "Nowa rozmowa"}”? Tej czynności nie można cofnąć.`)) return;
    const id = String(conversation.id);
    setDeleting(id);
    setError("");
    try {
      const response = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Nie udało się usunąć rozmowy.");
      setConversations((previous) => previous.filter((item) => String(item.id) !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się usunąć rozmowy.");
    } finally {
      setDeleting(null);
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
        {!loading && !error && conversations.length === 0 && <p className="history-empty">{emptyMessage}</p>}
        {conversations.map((conversation) => (
          <div className="history-row" key={conversation.id}>
            <Link className="history-item" href={`/?id=${encodeURIComponent(String(conversation.id))}`}>
              <strong>{conversation.title?.trim() || "Nowa rozmowa"}</strong>
              <span className="small">{new Date(conversation.created_at).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" })} · {conversation.messageCount} wiadomości</span>
            </Link>
            <button type="button" className="ghost history-delete" onClick={() => deleteConversation(conversation)} disabled={deleting !== null}>
              {deleting === String(conversation.id) ? "Usuwam…" : "Usuń"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

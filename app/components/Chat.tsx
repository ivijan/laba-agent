"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type FileUIPart, type UIMessage } from "ai";
import type { AgentMetadata, ImageResult } from "@/lib/tools";
import { ThemeToggle } from "./ThemeProvider";

type Analysis = {
  category: string;
  priority: string;
  draft: string;
  needs_review: boolean;
};

type AgentMessage = UIMessage<AgentMetadata>;

// Obraz z przycisku „Wygeneruj obraz”. Pamiętamy, po której wiadomości go pokazać.
type GeneratedImage = ImageResult & { id: number; prompt: string; after: number };

// Etykiety narzędzi pokazywane nad odpowiedzią. Dodajesz narzędzie — dopisz je tutaj.
const TOOL_LABELS: Record<string, string> = {
  wyszukiwanie: "🔎 Wyszukiwanie",
  pogoda: "🌤️ Pogoda",
  mapa: "🗺️ Mapa Miami",
  waluty: "💱 Waluty",
  swieta: "📅 Święta",
  wikipedia: "📚 Wikipedia",
  kalkulator: "🧮 Kalkulator",
  czas: "🕒 Czas",
  notatki: "📝 Notatki",
  diagnostyka: "🩺 Diagnostyka",
  generujObraz: "🎨 Obraz",
};

const ALLOWED_IMAGES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PROMPT = 500;

// Lista użytych narzędzi, po kolei. Wyszukiwanie wykonuje OpenRouter,
// więc rozpoznajemy je po źródłach dołączonych do odpowiedzi.
function usedTools(message: AgentMessage): string[] {
  const names: string[] = [];
  for (const part of message.parts) {
    const name = isToolUIPart(part) ? getToolName(part) : part.type === "source-url" ? "wyszukiwanie" : "";
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function toolOutputText(toolName: string, output: unknown): string {
  if (toolName === "generujObraz" && output && typeof output === "object") {
    const imageResult = output as ImageResult;
    return imageResult.error ?? `Obraz został wygenerowany${imageResult.model ? ` (model: ${imageResult.model})` : ""}.`;
  }
  if (typeof output === "string") return output.slice(0, 1200);
  if (output && typeof output === "object") {
    const fields = Object.entries(output).filter(([key]) => key !== "image" && key !== "base64");
    return fields
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join("\n")
      .slice(0, 1200);
  }
  return String(output).slice(0, 1200);
}

function Picture({ result }: { result: ImageResult }) {
  if (result.error) return <p className="error">{result.error}</p>;
  if (!result.image) return null;
  return (
    <figure className="picture">
      <img src={result.image} alt="Wygenerowany obraz" />
      <figcaption>
        <span className="small">model: {result.model ?? "nieznany"}</span>
        <a className="download" href={result.image} download="obraz.png">
          Pobierz
        </a>
      </figcaption>
    </figure>
  );
}

function Message({ message, stoppedByUser }: { message: AgentMessage; stoppedByUser?: boolean }) {
  const isAssistant = message.role === "assistant";
  const tools = isAssistant ? usedTools(message) : [];
  const steps = (isAssistant ? message.metadata?.steps ?? [] : [])
    .filter((step) => step.tools.length > 0)
    .map((step) => `${step.number}. ${step.tools.join(" + ")}`);
  const stopped = message.metadata?.stoppedAtLimit || message.metadata?.stoppedAtToolLimit || message.metadata?.timedOut;
  const partialResults = stopped
    ? message.parts.flatMap((part) => {
        if (!isToolUIPart(part)) return [];
        const name = getToolName(part);
        if (part.state === "output-error") {
          return [{ name, text: "Źródło nie odpowiada. Nie udało się sprawdzić tych danych." }];
        }
        if (part.state !== "output-available") return [];
        return [{ name, text: toolOutputText(name, part.output) }];
      })
    : [];
  const sources = message.parts.filter((part) => part.type === "source-url");
  const hasContent = message.parts.some(
    (part) => (part.type === "text" && part.text.trim()) || part.type === "tool-generujObraz",
  );

  return (
    <div className={`message ${message.role}`}>
      {steps.length > 0 && (
        <div className="agent-steps" aria-label="Kroki agenta">
          Kroki: {steps.join(" → ")}
        </div>
      )}
      {tools.length > 0 && (
        <div className="labels">
          {tools.map((name) => (
            <span key={name} className="label">
              {TOOL_LABELS[name] ?? `🛠️ ${name}`}
            </span>
          ))}
        </div>
      )}

      {message.parts.map((part, index) => {
        if (part.type === "text") return <span key={index}>{part.text}</span>;
        if (part.type === "file" && part.mediaType.startsWith("image/")) {
          return <img key={index} className="thumb" src={part.url} alt={part.filename ?? "Wysłane zdjęcie"} />;
        }
        if (part.type === "tool-generujObraz") {
          if (part.state === "output-available") {
            return <Picture key={index} result={part.output as ImageResult} />;
          }
          if (part.state === "output-error") {
            return (
              <p key={index} className="error">
                Nie udało się wygenerować obrazu.
              </p>
            );
          }
          return (
            <p key={index} className="muted">
              Generuję obraz…
            </p>
          );
        }
        return null;
      })}

      {stopped && (
        <section className="partial-results">
          <strong>
            {message.metadata?.timedOut
              ? "Zatrzymałem się po 60 sekundach"
              : message.metadata?.stoppedAtToolLimit
                ? "Zatrzymałem się po 16 wywołaniach narzędzi"
                : "Zatrzymałem się po 6 krokach"}
          </strong>
          {partialResults.length > 0 ? partialResults.map((result, index) => (
            <p key={`${result.name}-${index}`}>
              <b>{result.name}:</b> {result.text || "Narzędzie nie zwróciło dodatkowych danych."}
            </p>
          )) : <p>Nie udało się uzyskać dodatkowych danych z narzędzi.</p>}
        </section>
      )}
      {stoppedByUser && <p className="muted interrupted">Przerwane przez użytkownika</p>}
      {isAssistant && !hasContent && message.metadata?.fetchedAt && !stopped && (
        <p className="muted">Nie mam odpowiedzi. Spróbuj zapytać inaczej.</p>
      )}

      {sources.length > 0 && (
        <div className="sources">
          <strong>Źródła</strong>
          <ul>
            {sources.map((source) => (
              <li key={source.sourceId}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title || source.url}
                </a>
              </li>
            ))}
          </ul>
          {message.metadata?.fetchedAt && <span className="small">pobrano: {message.metadata.fetchedAt}</span>}
        </div>
      )}

      {isAssistant && message.metadata?.model && <div className="small">model: {message.metadata.model}</div>}
      {isAssistant && message.metadata?.elapsedMs !== undefined && (
        <div className="small agent-metrics">
          {message.metadata.steps?.length ?? 0} kroków · {message.metadata.toolCallCount ?? 0} wywołań narzędzi · {(message.metadata.elapsedMs / 1000).toFixed(1)} s
        </div>
      )}
    </div>
  );
}

export default function Chat({
  botName,
  intro,
  imageSuggestions,
}: {
  botName: string;
  intro: string;
  imageSuggestions: string[];
}) {
  const router = useRouter();
  const conversationId = useRef<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationError, setConversationError] = useState("");
  const stopRequestedByUser = useRef(false);
  const [interruptedMessages, setInterruptedMessages] = useState<Set<string>>(() => new Set());
  const transport = useMemo(() => new DefaultChatTransport<AgentMessage>({
    api: "/api/agent",
    prepareSendMessagesRequest: ({ messages }) => ({
      body: {
        mode: "chat",
        conversationId: conversationId.current,
        messages: messages.map((message) => ({
          ...message,
          parts: message.parts.map((part) =>
            part.type === "tool-generujObraz" && part.state === "output-available"
              ? { ...part, output: { model: (part.output as ImageResult).model } }
              : part,
          ),
        })),
      },
    }),
  }), []);
  const { messages, sendMessage, status, error, stop, setMessages } = useChat<AgentMessage>({
    transport,
    onFinish: ({ message, isAbort }) => {
      if (isAbort && stopRequestedByUser.current) {
        setInterruptedMessages((previous) => new Set(previous).add(message.id));
      }
      stopRequestedByUser.current = false;
    },
  });
  const [input, setInput] = useState("");
  const [photo, setPhoto] = useState<FileUIPart | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversations")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error ?? "Nie udało się wczytać rozmowy.");
        if (cancelled) return;
        conversationId.current = data.conversation?.id ?? null;
        setMessages((data.messages ?? []) as AgentMessage[]);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setConversationError(loadError instanceof Error ? loadError.message : "Nie udało się wczytać rozmowy.");
      })
      .finally(() => {
        if (!cancelled) setConversationLoading(false);
      });
    return () => { cancelled = true; };
  }, [setMessages]);

  // Gdy coś trwa, blokujemy przyciski, żeby nie wysłać zlecenia dwa razy.
  const busy = status === "submitted" || status === "streaming" || generating || conversationLoading;
  const text = input.trim();

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (busy || (!text && !photo)) return;
    setConversationError("");
    if (!conversationId.current) {
      setConversationLoading(true);
      try {
        const response = await fetch("/api/conversations", { method: "POST" });
        const data = await response.json();
        if (!response.ok || !data.conversation?.id) throw new Error(data?.error ?? "Nie udało się utworzyć rozmowy.");
        conversationId.current = data.conversation.id;
      } catch (createError) {
        setConversationError(createError instanceof Error ? createError.message : "Nie udało się utworzyć rozmowy.");
        setConversationLoading(false);
        return;
      }
      setConversationLoading(false);
    }
    sendMessage({ text: text || "Opisz to zdjęcie.", files: photo ? [photo] : undefined });
    setInput("");
    setPhoto(null);
  }

  async function newConversation() {
    if (busy) return;
    setConversationError("");
    setConversationLoading(true);
    try {
      const response = await fetch("/api/conversations", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.conversation?.id) throw new Error(data?.error ?? "Nie udało się utworzyć rozmowy.");
      conversationId.current = data.conversation.id;
      setMessages([]);
      setImages([]);
      setAnalysis(null);
      setAnalysisError("");
      setInterruptedMessages(new Set());
    } catch (createError) {
      setConversationError(createError instanceof Error ? createError.message : "Nie udało się utworzyć rozmowy.");
    } finally {
      setConversationLoading(false);
    }
  }

  function stopAgent() {
    stopRequestedByUser.current = true;
    const activeMessage = messages.at(-1);
    if (activeMessage?.role === "assistant") {
      setInterruptedMessages((previous) => new Set(previous).add(activeMessage.id));
    }
    stop();
  }

  // Vision: sprawdzamy plik od razu w przeglądarce i zamieniamy go na adres "data:".
  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoError("");
    if (!ALLOWED_IMAGES.includes(file.type)) {
      setPhotoError("Ten plik nie jest zdjęciem. Dodaj plik jpg, png albo webp.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPhotoError("Zdjęcie jest za duże. Limit to 4 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setPhoto({ type: "file", mediaType: file.type, filename: file.name, url: String(reader.result) });
    reader.onerror = () => setPhotoError("Nie udało się wczytać zdjęcia.");
    reader.readAsDataURL(file);
  }

  async function generateImage() {
    if (!text || busy) return;
    setGenerating(true);
    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    const result: ImageResult = response?.ok && data ? data : { error: data?.error ?? "Nie udało się wygenerować obrazu." };
    setImages((list) => [...list, { ...result, id: list.length, prompt: text, after: messages.length }]);
    setGenerating(false);
    if (response?.ok) setInput("");
  }

  async function analyze() {
    if (!text) return;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisError("");
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "analyze", text }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setAnalyzing(false);
    if (response?.ok && data) setAnalysis(data);
    else setAnalysisError(data?.error ?? "Analiza się nie udała.");
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.refresh();
  }

  // Obrazy z przycisku pokazujemy w rozmowie — w miejscu, w którym zostały zamówione.
  function imagesAfter(count: number) {
    return images
      .filter((image) => image.after === count)
      .map((image) => (
        <div key={`image-${image.id}`} className="message assistant">
          <span className="small">Obraz: {image.prompt}</span>
          <Picture result={image} />
        </div>
      ));
  }

  return (
    <div className="card chat">
      <header className="chat-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">SN</span>
          <div className="brand-copy">
            <h1>{botName}</h1>
            <p className="chat-intro">{intro}</p>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="ghost" onClick={newConversation} disabled={busy}>
            Nowa rozmowa
          </button>
          <Link href="/dashboard" className="header-link">Podróż</Link>
          <ThemeToggle />
          <button type="button" className="ghost" onClick={logout}>
            Wyjdź
          </button>
        </div>
      </header>

      <div className="messages">
        {conversationLoading && <p className="muted">Wczytuję rozmowę…</p>}
        {conversationError && <p className="error">{conversationError}</p>}
        {imagesAfter(0)}
        {messages.map((message, index) => (
          <div key={message.id} className="turn">
            <Message message={message} stoppedByUser={interruptedMessages.has(message.id)} />
            {imagesAfter(index + 1)}
          </div>
        ))}
        {status === "submitted" && <div className="message assistant muted">Piszę…</div>}
        {generating && <div className="message assistant muted">Generuję obraz…</div>}
        {error && <p className="error">Coś poszło nie tak. Spróbuj ponownie.</p>}
      </div>

      {photo && (
        <div className="attachment">
          <img className="thumb" src={photo.url} alt="Wybrane zdjęcie" />
          <span className="small">{photo.filename}</span>
          <button type="button" className="ghost" onClick={() => setPhoto(null)}>
            Usuń
          </button>
        </div>
      )}
      {photoError && <p className="error">{photoError}</p>}

      <form onSubmit={send} className="composer">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Napisz wiadomość albo opis obrazu…"
          aria-label="Wiadomość"
        />
        <button type="submit" disabled={busy || (!text && !photo)}>
          Wyślij
        </button>
        {(status === "submitted" || status === "streaming") && (
          <button type="button" className="stop-button" onClick={stopAgent}>
            Stop
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={choosePhoto}
          hidden
          aria-label="Zdjęcie"
        />
        <button type="button" className="ghost" onClick={() => fileInput.current?.click()} disabled={busy}>
          Dodaj zdjęcie
        </button>
        <button
          type="button"
          className="ghost"
          onClick={generateImage}
          disabled={busy || !text || text.length > MAX_IMAGE_PROMPT}
        >
          {generating ? "Generuję obraz…" : "Wygeneruj obraz"}
        </button>
        <button type="button" className="ghost" onClick={analyze} disabled={analyzing || !text}>
          {analyzing ? "Analizuję…" : "Analiza JSON"}
        </button>
      </form>

      <div className="suggestions">
        <span className="small">Pomysły na obraz:</span>
        {imageSuggestions.map((suggestion) => (
          <button key={suggestion} type="button" className="chip" onClick={() => setInput(suggestion)} disabled={busy}>
            {suggestion}
          </button>
        ))}
      </div>

      {analysisError && <p className="error">{analysisError}</p>}
      {analysis && (
        <section className="analysis">
          <h2>Analiza wiadomości</h2>
          <dl>
            <dt>Kategoria</dt>
            <dd>{analysis.category}</dd>
            <dt>Priorytet</dt>
            <dd>{analysis.priority}</dd>
            <dt>Do sprawdzenia przez człowieka</dt>
            <dd>{analysis.needs_review ? "tak" : "nie"}</dd>
            <dt>Szkic odpowiedzi</dt>
            <dd>{analysis.draft}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}

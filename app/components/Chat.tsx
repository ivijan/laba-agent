"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";

type ChatMessage = UIMessage<{
  sourceFetchedAt?: string;
  modelId?: string;
  generatedImage?: boolean;
}>;

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_PROMPT_SUGGESTIONS = [
  "Nowoczesna strona internetowa dla małej pracowni ceramicznej, jasne kolory i naturalne światło",
  "Minimalistyczne logo dla studia jogi, spokojne barwy i elegancka typografia",
  "Projekt identyfikacji wizualnej dla lokalnej kawiarni, ciepłe kolory i prosty styl",
];

type Analysis = {
  category: string;
  priority: string;
  draft: string;
  needs_review: boolean;
};

export default function Chat({ botName, intro }: { botName: string; intro: string }) {
  const router = useRouter();
  const { messages, sendMessage, setMessages, status, error } = useChat<ChatMessage>();
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const generationLockRef = useRef(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const busy = status === "submitted" || status === "streaming";

  function send(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if ((!text && !selectedImage) || busy || generatingImage) return;
    sendMessage({
      text: text || "Co przedstawia to zdjęcie?",
      files: selectedImage ? imageInputRef.current?.files ?? undefined : undefined,
    });
    setInput("");
    setSelectedImage(null);
    setImageError("");
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setImageError("");
    if (!file) {
      setSelectedImage(null);
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setSelectedImage(null);
      setImageError("Wybierz zdjęcie w formacie JPG, PNG lub WebP.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setSelectedImage(null);
      setImageError("Zdjęcie może mieć najwyżej 4 MB.");
      event.target.value = "";
      return;
    }
    setSelectedImage(file);
  }

  async function generateImage() {
    const prompt = input.trim();
    if (!prompt || prompt.length > 500 || busy || generationLockRef.current) return;
    generationLockRef.current = true;
    setGeneratingImage(true);
    setImageError("");

    try {
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.image || !data?.mediaType || !data?.modelId) {
        setImageError(data?.error ?? "Nie udało się wygenerować obrazu. Spróbuj ponownie.");
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          metadata: { modelId: data.modelId, generatedImage: true },
          parts: [
            {
              type: "file",
              mediaType: data.mediaType,
              url: data.image,
              filename: "wygenerowany-obraz",
            },
          ],
        },
      ]);
      setInput("");
    } catch {
      setImageError("Nie udało się połączyć z usługą generowania obrazu. Spróbuj ponownie.");
    } finally {
      generationLockRef.current = false;
      setGeneratingImage(false);
    }
  }

  async function analyze() {
    const text = input.trim();
    if (!text) return;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisError("");
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await response.json().catch(() => null);
    setAnalyzing(false);
    if (response.ok && data) setAnalysis(data);
    else setAnalysisError(data?.error ?? "Analiza się nie udała.");
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.refresh();
  }

  return (
    <div className="card chat">
      <header>
        <h1>{botName}</h1>
        <button type="button" className="ghost" onClick={logout}>
          Wyjdź
        </button>
      </header>

      <div className="messages">
        <div className="message assistant">{intro}</div>
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            {message.role === "assistant" && (() => {
              const toolNames = [...new Set(message.parts.flatMap((part) => {
                if (part.type === "dynamic-tool") return [part.toolName];
                if (part.type.startsWith("tool-")) return [part.type.slice(5)];
                return [];
              }))];

              return toolNames.length > 0 ? (
                <div className="tool-labels" aria-label="Użyte narzędzia">
                  {toolNames.map((name) => (
                    <span className="tool-label" key={name}>
                      {name === "webSearch"
                        ? "wyszukiwanie"
                        : name === "disneyPlus"
                          ? "Disney+"
                          : name}
                    </span>
                  ))}
                </div>
              ) : null;
            })()}
            {message.parts.map((part, index) => {
              if (part.type === "text") return <span key={index}>{part.text}</span>;
              if (part.type === "file" && part.mediaType.startsWith("image/")) {
                return (
                  <figure className="chat-image" key={index}>
                    <img src={part.url} alt={part.filename ?? "Zdjęcie w rozmowie"} />
                    {message.metadata?.modelId && (
                      <figcaption>Model: {message.metadata.modelId}</figcaption>
                    )}
                    {message.metadata?.generatedImage && (
                      <a
                        className="download-button"
                        href={part.url}
                        download={`obraz.${part.mediaType === "image/jpeg" ? "jpg" : part.mediaType.split("/")[1]}`}
                      >
                        Pobierz
                      </a>
                    )}
                  </figure>
                );
              }
              return null;
            })}
            {message.role === "assistant" && message.metadata?.modelId && !message.metadata.generatedImage && (
              <small className="model-label">Model: {message.metadata.modelId}</small>
            )}
            {message.role === "assistant" &&
              message.parts.some((part) => part.type === "source-url") && (
                <section className="sources">
                  <h2>Źródła</h2>
                  <ul>
                    {message.parts
                      .filter((part) => part.type === "source-url")
                      .map((source) => (
                        <li key={source.sourceId}>
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title ?? source.url}
                          </a>
                        </li>
                      ))}
                  </ul>
                  {message.metadata?.sourceFetchedAt && (
                    <small>
                      pobrano: {new Intl.DateTimeFormat("pl-PL", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(message.metadata.sourceFetchedAt))}
                    </small>
                  )}
                </section>
              )}
          </div>
        ))}
        {status === "submitted" && <div className="message assistant muted">Piszę…</div>}
        {error && <p className="error">Coś poszło nie tak. Spróbuj ponownie.</p>}
      </div>

      {imageError && <p className="error">{imageError}</p>}
      {selectedImage && (
        <p className="muted selected-image">Wybrane zdjęcie: {selectedImage.name}</p>
      )}
      <form onSubmit={send} className="composer">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Napisz wiadomość…"
          aria-label="Wiadomość"
          disabled={generatingImage}
        />
        <button type="submit" disabled={busy || generatingImage || (!input.trim() && !selectedImage)}>
          Wyślij
        </button>
        <div className="prompt-suggestions">
          <span>Pomysły na obraz:</span>
          <div>
            {IMAGE_PROMPT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="suggestion-button"
                onClick={() => setInput(suggestion)}
                disabled={busy || generatingImage}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
        <label className="button ghost file-button">
          Dodaj zdjęcie
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={selectImage}
            disabled={busy || generatingImage}
            hidden
          />
        </label>
        <button
          type="button"
          className="ghost"
          onClick={generateImage}
          disabled={busy || generatingImage || !input.trim() || input.trim().length > 500}
        >
          {generatingImage ? "Generuję obraz…" : "Wygeneruj obraz"}
        </button>
        <button type="button" className="ghost" onClick={analyze} disabled={analyzing || busy || generatingImage || !input.trim()}>
          {analyzing ? "Analizuję…" : "Analiza JSON"}
        </button>
      </form>

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

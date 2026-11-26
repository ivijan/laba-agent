import { Suspense } from "react";
import { connection } from "next/server";
import { hasSession } from "@/lib/session";
import { BOT_INTRO, BOT_NAME, IMAGE_SUGGESTIONS } from "@/lib/persona";
import Chat from "./components/Chat";
import Login from "./components/Login";

// Serwer sprawdza ciasteczko sesji i decyduje, co pokazać: ekran hasła czy czat.
async function Gate({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  await connection(); // ta część strony powstaje przy każdym wejściu, nie podczas budowania
  const loggedIn = await hasSession();
  const params = await searchParams;
  return loggedIn ? (
    <Chat botName={BOT_NAME} intro={BOT_INTRO} imageSuggestions={IMAGE_SUGGESTIONS}
      requestedConversationId={typeof params.id === "string" ? params.id : undefined} />
  ) : (
    <Login botName={BOT_NAME} />
  );
}

export default function Home({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  return (
    <main className="app">
      <Suspense fallback={<p className="muted">Ładowanie…</p>}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

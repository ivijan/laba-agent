import { connection } from "next/server";
import { hasSession } from "@/lib/session";
import { BOT_NAME } from "@/lib/persona";
import Login from "../components/Login";
import HistoryList from "./history-list";

async function Gate() {
  await connection();
  const loggedIn = await hasSession();
  return loggedIn ? <HistoryList botName={BOT_NAME} /> : <Login botName={BOT_NAME} />;
}

export default function HistoryPage() {
  return <main className="app"><Suspense fallback={<p className="muted">Ładowanie…</p>}><Gate /></Suspense></main>;
}
import { Suspense } from "react";

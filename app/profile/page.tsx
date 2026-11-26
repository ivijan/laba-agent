import { Suspense } from "react";
import { connection } from "next/server";
import { hasSession } from "@/lib/session";
import { BOT_NAME } from "@/lib/persona";
import Login from "../components/Login";
import ProfileEditor from "./profile-editor";

async function Gate() {
  await connection();
  return await hasSession() ? <ProfileEditor botName={BOT_NAME} /> : <Login botName={BOT_NAME} />;
}

export default function ProfilePage() {
  return <main className="app"><Suspense fallback={<p className="muted">Ładowanie…</p>}><Gate /></Suspense></main>;
}

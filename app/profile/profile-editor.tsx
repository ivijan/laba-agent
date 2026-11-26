"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "../components/ThemeProvider";

type Profile = { name: string; preferences: Record<string, string> };

export default function ProfileEditor({ botName }: { botName: string }) {
  const [profile, setProfile] = useState<Profile>({ name: "", preferences: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Nie udało się wczytać profilu.");
      if (!cancelled) setProfile({ name: data.profile.name ?? "", preferences: data.profile.preferences ?? {} });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Nie udało się wczytać profilu.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function editPreference(oldKey: string, key: string, value: string) {
    setProfile((current) => {
      const preferences = { ...current.preferences };
      if (oldKey !== key) delete preferences[oldKey];
      if (key.trim()) preferences[key] = value;
      return { ...current, preferences };
    });
  }

  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profile.name.trim() || null, preferences: profile.preferences }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Nie udało się zapisać profilu.");
      setProfile({ name: data.profile.name ?? "", preferences: data.profile.preferences ?? {} });
      setNotice("Profil zapisany.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się zapisać profilu.");
    } finally { setSaving(false); }
  }

  async function clear() {
    if (!window.confirm("Wyczyścić imię i wszystkie preferencje?")) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Nie udało się wyczyścić profilu.");
      setProfile({ name: "", preferences: {} });
      setNotice("Profil wyczyszczony.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nie udało się wyczyścić profilu.");
    } finally { setSaving(false); }
  }

  return (
    <section className="card profile-page">
      <header className="chat-header">
        <div className="brand"><span className="brand-mark" aria-hidden="true">SN</span><div className="brand-copy"><h1>{botName}</h1><p className="chat-intro">Twój profil</p></div></div>
        <div className="header-actions"><Link href="/" className="header-link">Czat</Link><Link href="/history" className="header-link">Historia</Link><ThemeToggle /></div>
      </header>
      <div className="profile-content">
        {loading ? <p className="muted">Wczytuję profil…</p> : <>
          <label className="profile-name">Imię<input maxLength={100} value={profile.name} onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} placeholder="Nie podano" /></label>
          <h2>Preferencje</h2>
          {Object.entries(profile.preferences).map(([key, value], index) => (
            <div className="profile-preference" key={`${index}-${key}`}>
              <label>Nazwa<input maxLength={100} value={key} onChange={(event) => editPreference(key, event.target.value, value)} /></label>
              <label>Wartość<input maxLength={300} value={value} onChange={(event) => editPreference(key, key, event.target.value)} /></label>
              <button type="button" className="ghost profile-remove" onClick={() => setProfile((current) => {
                const preferences = { ...current.preferences }; delete preferences[key]; return { ...current, preferences };
              })} aria-label={`Usuń preferencję ${key}`}>Usuń</button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setProfile((current) => ({ ...current, preferences: { ...current.preferences, "": "" } }))}>Dodaj preferencję</button>
          {error && <p className="error">{error}</p>}
          {notice && <p className="profile-notice">{notice}</p>}
          <div className="profile-actions"><button type="button" onClick={save} disabled={saving}>{saving ? "Zapisuję…" : "Zapisz zmiany"}</button><button type="button" className="ghost" onClick={clear} disabled={saving}>Wyczyść profil</button></div>
        </>}
      </div>
    </section>
  );
}

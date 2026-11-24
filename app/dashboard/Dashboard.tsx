"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "@/app/components/ThemeProvider";

type DashboardCard = {
  id: string;
  nazwa: string;
  status: "OK" | "Ładuję…" | "Brak danych";
  wartosc?: string;
  zrodlo: string;
  pobrano?: string;
  link?: string;
};

type DashboardCityResult = {
  miasto: string;
  data: string;
  cards: DashboardCard[];
};

type DashboardResult = {
  data: string;
  podsumowanie: string;
  miasto?: string;
  cards?: DashboardCard[];
  porownanie?: boolean;
  miasta?: DashboardCityResult[];
};

const ZRODLA = [
  { id: "weather", nazwa: "Pogoda", zrodlo: "Open-Meteo" },
  { id: "currency", nazwa: "Waluty", zrodlo: "NBP" },
  { id: "holidays", nazwa: "Święta", zrodlo: "Nager.Date" },
  { id: "wikipedia", nazwa: "O mieście", zrodlo: "Wikipedia polska" },
  { id: "time", nazwa: "Czas na miejscu", zrodlo: "Zegar systemowy / IANA" },
];

function dzisiajWPolsce(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function Dashboard() {
  const [miasto, setMiasto] = useState("Miami, Florida");
  const [miasto2, setMiasto2] = useState("Fort Lauderdale, Florida");
  const [porownaj, setPorownaj] = useState(false);
  const [data, setData] = useState(dzisiajWPolsce);
  const [wynik, setWynik] = useState<DashboardResult | null>(null);
  const [blad, setBlad] = useState("");
  const [ladowanie, setLadowanie] = useState(false);

  async function pobierzDane() {
    if (ladowanie) return;
    setLadowanie(true);
    setBlad("");
    setWynik(null);
    const response = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ miasto, ...(porownaj ? { miasto2 } : {}), data }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setLadowanie(false);
    if (!response?.ok || !body) {
      const message = body?.error ?? "Nie udało się pobrać danych. Spróbuj ponownie.";
      setBlad(message);
      return;
    }
    setWynik(body as DashboardResult);
  }

  function sprawdz(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void pobierzDane();
  }

  function renderCard(card: DashboardCard) {
    return (
      <article className={`travel-card${card.status === "Brak danych" ? " has-error" : ""}`} key={card.id}>
        <div className="travel-card-heading">
          <h3>{card.nazwa}</h3>
          <span className={`card-status${card.status === "Brak danych" ? " is-missing" : ""}`}>{card.status}</span>
        </div>
        <p className="travel-value">{card.status === "Brak danych" ? "Brak danych — spróbuj odświeżyć" : card.wartosc}</p>
        {card.status === "OK" && card.link && (
          <a className="travel-wiki-link" href={card.link} target="_blank" rel="noreferrer">
            Czytaj w Wikipedii
          </a>
        )}
        <div className="travel-meta">
          <span>Źródło: {card.zrodlo}</span>
          <span>Pobrano: {card.pobrano ?? "—"}</span>
        </div>
      </article>
    );
  }

  return (
    <main className="dashboard-page">
      <div className="dashboard-shell">
        <header className="dashboard-header">
          <div>
            <span className="dashboard-kicker">PODRÓŻ • MIAMI • FLORYDA</span>
            <h1>Asystent podróży</h1>
            <p>Sprawdź prognozę, kursy, święta i czas na miejscu.</p>
          </div>
          <nav className="dashboard-nav" aria-label="Nawigacja">
            <ThemeToggle />
            <Link href="/" className="ghost dashboard-nav-link">Wróć do czatu</Link>
          </nav>
        </header>

        <form className={porownaj ? "trip-form is-comparing" : "trip-form"} onSubmit={sprawdz}>
          <label>
            Dokąd jedziesz?
            <input
              value={miasto}
              onChange={(event) => setMiasto(event.target.value)}
              placeholder="np. Miami, Florida"
              minLength={2}
              maxLength={100}
              required
              disabled={ladowanie}
            />
          </label>
          {porownaj && (
            <label>
              Drugie miasto
              <input
                value={miasto2}
                onChange={(event) => setMiasto2(event.target.value)}
                placeholder="np. Orlando, Florida"
                minLength={2}
                maxLength={100}
                required
                disabled={ladowanie}
              />
            </label>
          )}
          <label>
            Kiedy?
            <input
              type="date"
              value={data}
              onChange={(event) => setData(event.target.value)}
              required
              disabled={ladowanie}
            />
          </label>
          <label className="trip-mode">
            <input
              type="checkbox"
              checked={porownaj}
              onChange={(event) => setPorownaj(event.target.checked)}
              disabled={ladowanie}
            />
            <span>Porównaj dwa miasta</span>
          </label>
          <button type="submit" disabled={ladowanie || !miasto.trim() || (porownaj && (!miasto2.trim() || miasto2.trim().toLocaleLowerCase() === miasto.trim().toLocaleLowerCase())) || !data}>
            {ladowanie ? "Sprawdzam…" : "Sprawdź"}
          </button>
        </form>

        {blad && <p className="dashboard-error" role="alert">{blad}</p>}

        {ladowanie && (
          <section className="dashboard-results" aria-live="polite">
            <p className="dashboard-loading" role="status">Zbieram dane z pięciu źródeł i przygotowuję podsumowanie…</p>
            <div className={porownaj ? "comparison-grid" : "travel-cards"}>
              {Array.from({ length: porownaj ? 2 : 1 }, (_, index) => (
                <section className="comparison-city" key={index}>
                  {porownaj && <h2>{index === 0 ? miasto : miasto2}</h2>}
                  <div className={porownaj ? "travel-cards comparison-cards" : "travel-cards"}>
                    {ZRODLA.map((card) => (
                      <article className="travel-card is-loading" key={card.id}>
                        <div className="travel-card-heading"><h3>{card.nazwa}</h3><span className="card-status">Ładuję…</span></div>
                        <p className="travel-value">Ładuję…</p>
                        <div className="travel-meta"><span>Źródło: {card.zrodlo}</span><span>Pobrano: —</span></div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        )}

        {wynik && !ladowanie && (
          <section className="dashboard-results" aria-live="polite">
            <div className="results-heading">
              <div>
                <span className="dashboard-kicker">{wynik.porownanie ? "PORÓWNANIE WYJAZDÓW" : "PLAN WYJAZDU"}</span>
                {!wynik.porownanie && <h2>{wynik.miasto}</h2>}
                <p>{wynik.data}</p>
              </div>
              <button type="button" className="ghost refresh-button" onClick={() => void pobierzDane()}>
                Odśwież
              </button>
            </div>

            {wynik.porownanie && wynik.miasta ? (
              <div className="comparison-grid">
                {wynik.miasta.map((city) => (
                  <section className="comparison-city" key={city.miasto}>
                    <h2>{city.miasto}</h2>
                    <div className="travel-cards comparison-cards">
                      {city.cards.map((card) => renderCard(card))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="travel-cards">
                {(wynik.cards ?? []).map((card) => renderCard(card))}
              </div>
            )}

            <section className="travel-summary">
              <span className="dashboard-kicker">{wynik.porownanie ? "REKOMENDACJA AGENTA" : "PODSUMOWANIE AGENTA"}</span>
              <p>{wynik.podsumowanie}</p>
            </section>
          </section>
        )}
      </div>
    </main>
  );
}

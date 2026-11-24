import { generateImage, tool } from "ai";
import { z } from "zod";
import { IMAGE_MODEL_ID, MODEL_ID, imageModel, webSearchTool } from "@/lib/model";

// Narzędzia agenta. Opisy podpowiadają modelowi, kiedy warto ich użyć.
export const MAX_STEPS = 6;
export const MAX_TOOL_CALLS = 16;
export const MAX_TASK_DURATION_MS = 60_000;
export const MAX_TOOL_DURATION_MS = 10_000;
export const MAX_IMAGE_PROMPT = 500;

const TOOL_NAMES = [
  "wyszukiwanie",
  "pogoda",
  "mapa",
  "waluty",
  "swieta",
  "wikipedia",
  "kalkulator",
  "czas",
  "notatki",
  "diagnostyka",
  "generujObraz",
] as const;

export type ImageResult = {
  image?: string;
  model?: string;
  error?: string;
  pobrano?: string;
};

export type AgentMetadata = {
  model?: string;
  fetchedAt?: string;
  stoppedAtLimit?: boolean;
  stoppedAtToolLimit?: boolean;
  timedOut?: boolean;
  toolCallCount?: number;
  elapsedMs?: number;
  steps?: Array<{ number: number; tools: string[] }>;
};

function pobrano(): string {
  return new Date().toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    dateStyle: "short",
    timeStyle: "medium",
  });
}

type FetchResult<T> = { ok: true; data: T } | { ok: false; status?: number; timedOut?: boolean };

async function pobierzJson<T>(url: string, headers?: HeadersInit): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const data: unknown = await response.json();
    if (data === null || typeof data !== "object") return { ok: false, status: 502 };
    return { ok: true, data: data as T };
  } catch (error) {
    return { ok: false, timedOut: error instanceof Error && error.name === "TimeoutError" };
  }
}

function prawidlowaData(data: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const parsed = new Date(`${data}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === data;
}

// Wspólna funkcja: używa jej endpoint /api/image oraz narzędzie generujObraz.
export async function createImage(prompt: string): Promise<ImageResult> {
  try {
    const result = await generateImage({
      model: imageModel(),
      prompt,
      abortSignal: AbortSignal.timeout(9_000),
      maxRetries: 0,
    });
    return {
      image: `data:${result.image.mediaType};base64,${result.image.base64}`,
      model: result.calls[0]?.response.modelId,
      pobrano: pobrano(),
    };
  } catch {
    return {
      error: "Źródło nie odpowiada albo nie udało się wygenerować obrazu. Spróbuj ponownie później.",
      pobrano: pobrano(),
    };
  }
}

const pogoda = tool({
  description:
    "Sprawdza prognozę pogody w mieście dla konkretnego dnia. Użyj, gdy użytkownik pyta o pogodę lub planuje dzień. " +
    "Podaj miasto i datę w formacie RRRR-MM-DD; przy niejednoznacznym mieście dopisz region lub kraj. " +
    "Dla słów typu jutro najpierw ustal datę narzędziem czas. Prognoza Open-Meteo obejmuje maksymalnie 16 dni.",
  inputSchema: z.object({
    miasto: z.string().trim().min(2).max(100).describe("Miasto; dopisz region lub kraj, gdy nazwa jest niejednoznaczna"),
    dzien: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Dzień prognozy w formacie RRRR-MM-DD"),
  }),
  execute: async ({ miasto, dzien }) => {
    const pobranoO = pobrano();
    if (!prawidlowaData(dzien)) return { error: "Podaj prawidłową datę w formacie RRRR-MM-DD.", pobrano: pobranoO };

    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.search = new URLSearchParams({ name: miasto, count: "1", language: "pl", format: "json" }).toString();
    const geocode = await pobierzJson<{
      results?: Array<{
        name: string;
        country?: string;
        admin1?: string;
        latitude: number;
        longitude: number;
        timezone?: string;
      }>;
    }>(geocodeUrl.toString());
    if (!geocode.ok) {
      return { error: "Źródło nie odpowiada (Open-Meteo). Nie udało się sprawdzić miasta.", pobrano: pobranoO };
    }

    const miejsce = geocode.data.results?.[0];
    if (!miejsce) return { error: `Nie znalazłem miasta „${miasto}”. Podaj nazwę wraz z regionem lub krajem.`, pobrano: pobranoO };

    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.search = new URLSearchParams({
      latitude: String(miejsce.latitude),
      longitude: String(miejsce.longitude),
      daily: "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max",
      timezone: "auto",
      start_date: dzien,
      end_date: dzien,
    }).toString();
    const forecast = await pobierzJson<{
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_min?: number[];
        temperature_2m_max?: number[];
        precipitation_probability_max?: number[];
        wind_speed_10m_max?: number[];
      };
    }>(forecastUrl.toString());
    if (!forecast.ok) {
      const error = forecast.status === 400 || forecast.status === 404
        ? "Brak prognozy dla tego dnia. Open-Meteo udostępnia prognozę do 16 dni naprzód."
        : "Źródło nie odpowiada (Open-Meteo). Nie udało się sprawdzić prognozy.";
      return { error, pobrano: pobranoO };
    }

    const daily = forecast.data.daily;
    if (!daily || !Array.isArray(daily.time)) {
      return { error: "Serwis pogodowy zwrócił niepełną prognozę.", pobrano: pobranoO };
    }
    const index = daily.time.indexOf(dzien);
    if (!daily || index < 0 || daily.weather_code?.[index] === undefined) {
      return { error: "Nie ma prognozy dla tego miasta i dnia.", pobrano: pobranoO };
    }

    const opisyPogody: Record<number, string> = {
      0: "bezchmurnie",
      1: "przeważnie pogodnie",
      2: "częściowe zachmurzenie",
      3: "pochmurno",
      45: "mgła",
      48: "mgła osadzająca szadź",
      51: "lekka mżawka",
      53: "mżawka",
      55: "silna mżawka",
      56: "marznąca mżawka",
      57: "silna marznąca mżawka",
      61: "lekki deszcz",
      63: "deszcz",
      65: "silny deszcz",
      66: "marznący deszcz",
      67: "silny marznący deszcz",
      71: "lekki śnieg",
      73: "śnieg",
      75: "silny śnieg",
      77: "ziarna śniegu",
      80: "przelotny deszcz",
      81: "przelotny deszcz",
      82: "ulewne przelotne opady",
      85: "przelotny śnieg",
      86: "silny przelotny śnieg",
      95: "burza",
      96: "burza z gradem",
      99: "silna burza z gradem",
    };
    return {
      miasto: [miejsce.name, miejsce.admin1, miejsce.country].filter(Boolean).join(", "),
      dzien,
      opis: opisyPogody[daily.weather_code[index]] ?? "nieznane warunki pogodowe",
      temperaturaMinC: daily.temperature_2m_min?.[index],
      temperaturaMaxC: daily.temperature_2m_max?.[index],
      prawdopodobienstwoOpadowProc: daily.precipitation_probability_max?.[index],
      wiatrMaxKmh: daily.wind_speed_10m_max?.[index],
      strefa: miejsce.timezone,
      pobrano: pobranoO,
    };
  },
});

const MAP_CATEGORIES = {
  plaza: { label: "plaże", key: "natural", value: "beach" },
  park: { label: "parki", key: "leisure", value: "park" },
  marina: { label: "mariny", key: "leisure", value: "marina" },
  most: { label: "mosty", key: "man_made", value: "bridge" },
  lotnisko: { label: "lotniska", key: "aeroway", value: "aerodrome" },
  policja: { label: "posterunki policji", key: "amenity", value: "police" },
  restauracja: { label: "restauracje", key: "amenity", value: "restaurant" },
  atrakcja: { label: "atrakcje turystyczne", key: "tourism", value: "attraction" },
} as const;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const mapa = tool({
  description:
    "Wyszukuje prawdziwe miejsca z OpenStreetMap w promieniu 5 km od miasta, szczególnie w Miami i na Florydzie. " +
    "Użyj, gdy użytkownik pyta o lokalne plaże, parki, mariny, mosty, lotniska, posterunki policji, restauracje lub atrakcje. " +
    "Wybierz jedną kategorię z listy i podaj miasto, dopisując stan lub kraj przy niejednoznacznej nazwie. " +
    "Zwróć nazwę miejsca oraz link do OpenStreetMap. Dane nie opisują fikcyjnych lokacji z gry GTA.",
  inputSchema: z.object({
    miasto: z.string().trim().min(2).max(100).describe("Miasto; np. Miami, Florida, USA"),
    kategoria: z.enum(["plaza", "park", "marina", "most", "lotnisko", "policja", "restauracja", "atrakcja"])
      .describe("Rodzaj miejsca do znalezienia"),
  }),
  execute: async ({ miasto, kategoria }) => {
    const pobranoO = pobrano();
    const geocodeUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodeUrl.search = new URLSearchParams({ name: miasto, count: "1", language: "pl", format: "json" }).toString();
    const geocode = await pobierzJson<{
      results?: Array<{ name: string; country?: string; admin1?: string; latitude: number; longitude: number }>;
    }>(geocodeUrl.toString());
    if (!geocode.ok) {
      return { error: "Źródło nie odpowiada (Open-Meteo). Nie udało się sprawdzić miasta.", pobrano: pobranoO };
    }
    const miejsce = geocode.data.results?.[0];
    if (!miejsce || !Number.isFinite(miejsce.latitude) || !Number.isFinite(miejsce.longitude)) {
      return { error: `Nie znalazłem miasta „${miasto}”. Podaj nazwę wraz ze stanem lub krajem.`, pobrano: pobranoO };
    }

    const { label, key, value } = MAP_CATEGORIES[kategoria];
    const query = `[out:json][timeout:15];\n` +
      `nwr(around:5000,${miejsce.latitude},${miejsce.longitude})["${key}"="${value}"];\n` +
      `out center 15;`;
    let overpass: FetchResult<{ elements?: OverpassElement[] }>;
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
        body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(9_000),
      });
      if (!response.ok) overpass = { ok: false, status: response.status };
      else {
        const data: unknown = await response.json();
        overpass = data !== null && typeof data === "object"
          ? { ok: true, data: data as { elements?: OverpassElement[] } }
          : { ok: false, status: 502 };
      }
    } catch {
      overpass = { ok: false };
    }
    if (!overpass.ok) {
      const error = overpass.status === 429
        ? "Mapa jest chwilowo mocno obciążona. Spróbuj ponownie za około 30 sekund."
        : "Źródło nie odpowiada (OpenStreetMap). Nie udało się sprawdzić miejsc.";
      return { error, pobrano: pobranoO };
    }
    if (!Array.isArray(overpass.data.elements)) {
      return { error: "Serwis mapy zwrócił niepełne dane. Spróbuj ponownie za chwilę.", pobrano: pobranoO };
    }
    const miejsca = overpass.data.elements.slice(0, 15).map((element) => {
      const tags = element.tags ?? {};
      const nazwa = tags.name || tags["name:en"] || tags["name:es"];
      return {
        nazwa: nazwa || `Miejsce bez nazwy (${label})`,
        ...(tags["addr:street"] ? { ulica: tags["addr:street"] } : {}),
        ...(tags["addr:housenumber"] ? { numer: tags["addr:housenumber"] } : {}),
        ...(element.lat !== undefined || element.center ? { szerokosc: element.lat ?? element.center?.lat } : {}),
        ...(element.lon !== undefined || element.center ? { dlugosc: element.lon ?? element.center?.lon } : {}),
        link: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      };
    });
    if (miejsca.length === 0) {
      return { error: `Nie znalazłem kategorii „${label}” w promieniu 5 km od ${miejsce.name}. Spróbuj innej kategorii lub miasta.`, pobrano: pobranoO };
    }
    return {
      miasto: [miejsce.name, miejsce.admin1, miejsce.country].filter(Boolean).join(", "),
      kategoria: label,
      promienKm: 5,
      miejsca,
      zrodlo: "© OpenStreetMap contributors",
      pobrano: pobranoO,
    };
  },
});

const waluty = tool({
  description:
    "Sprawdza aktualny kurs średni waluty wobec polskiego złotego i przelicza kwotę w obie strony. " +
    "Użyj przy pytaniach o kurs lub przeliczenie pieniędzy. Podaj trzyliterowy kod ISO 4217, np. EUR albo USD, kwotę i kierunek. " +
    "Kurs pochodzi z aktualnej tabeli A NBP; podaj datę publikacji kursu.",
  inputSchema: z.object({
    waluta: z.string().trim().regex(/^[A-Za-z]{3}$/).describe("Trzyliterowy kod waluty ISO 4217, np. EUR, USD, GBP"),
    kwota: z.number().finite().min(0).max(1_000_000_000_000).describe("Kwota do przeliczenia; walutą wejściową jest waluta lub PLN zależnie od kierunku"),
    kierunek: z.enum(["waluta_na_pln", "pln_na_walute"]).optional().describe("Kierunek konwersji; domyślnie waluta_na_pln"),
  }),
  execute: async ({ waluta, kwota, kierunek }) => {
    const kod = waluta.toUpperCase();
    const pobranoO = pobrano();
    const kierunekKonwersji = kierunek ?? "waluta_na_pln";
    const walutaWejsciowa = kierunekKonwersji === "pln_na_walute" ? "PLN" : kod;
    const walutaWynikowa = kierunekKonwersji === "pln_na_walute" ? kod : "PLN";
    if (kod === "PLN") {
      return {
        walutaWejsciowa: "PLN",
        kwotaWejsciowa: kwota,
        walutaWynikowa: "PLN",
        kwotaWynikowa: Number(kwota.toFixed(2)),
        kursPLN: 1,
        dataKursu: pobranoO.slice(0, 10),
        pobrano: pobranoO,
      };
    }

    const url = `https://api.nbp.pl/api/exchangerates/rates/A/${encodeURIComponent(kod)}/?format=json`;
    const result = await pobierzJson<{ rates?: Array<{ mid?: number; effectiveDate?: string }> }>(url, { Accept: "application/json" });
    if (!result.ok) {
      const error = result.status === 404
        ? `NBP nie ma aktualnego kursu waluty ${kod}. Sprawdź kod albo wybierz walutę publikowaną w tabeli A.`
        : "Źródło nie odpowiada (NBP). Nie udało się sprawdzić kursu.";
      return { error, pobrano: pobranoO };
    }
    const kurs = result.data.rates?.[0];
    if (typeof kurs?.mid !== "number") return { error: `NBP nie zwrócił kursu waluty ${kod}.`, pobrano: pobranoO };
    const kwotaWynikowa = kierunekKonwersji === "pln_na_walute" ? kwota / kurs.mid : kwota * kurs.mid;
    return {
      walutaWejsciowa,
      kwotaWejsciowa: kwota,
      walutaWynikowa,
      kwotaWynikowa: Number(kwotaWynikowa.toFixed(2)),
      kursPLN: kurs.mid,
      dataKursu: kurs.effectiveDate,
      pobrano: pobranoO,
    };
  },
});

const swieta = tool({
  description:
    "Zwraca publiczne dni wolne od pracy w kraju i roku wskazanym przez użytkownika. " +
    "Użyj do pytań o święta i dni ustawowo wolne. Kraj podaj jako dwuliterowy kod ISO 3166-1 alpha-2, np. PL, US, GB; rok jako liczbę. " +
    "Wynik może zawierać święta regionalne — zaznacz, gdy nie obowiązują w całym kraju.",
  inputSchema: z.object({
    kraj: z.string().trim().regex(/^[A-Za-z]{2}$/).describe("Dwuliterowy kod kraju ISO 3166-1 alpha-2, np. PL, US, GB"),
    rok: z.number().int().min(1900).max(2100).describe("Rok, dla którego pobrać dni wolne"),
  }),
  execute: async ({ kraj, rok }) => {
    const kod = kraj.toUpperCase();
    const pobranoO = pobrano();
    const url = `https://date.nager.at/api/v3/PublicHolidays/${rok}/${encodeURIComponent(kod)}`;
    const result = await pobierzJson<Array<{
      date: string;
      localName?: string;
      name?: string;
      global?: boolean;
      counties?: string[] | null;
      types?: string[];
    }>>(url, { Accept: "application/json" });
    if (!result.ok) {
      const error = result.status === 404
        ? `Nie znaleziono danych świątecznych dla kraju ${kod} i roku ${rok}. Sprawdź kod kraju.`
        : "Źródło nie odpowiada (Nager.Date). Nie udało się sprawdzić dni wolnych.";
      return { error, pobrano: pobranoO };
    }
    if (!Array.isArray(result.data)) return { error: "Serwis Nager.Date zwrócił nieprawidłową listę świąt.", pobrano: pobranoO };
    return {
      kraj: kod,
      rok,
      dniWolne: result.data
        .filter((holiday) => !holiday.types || holiday.types.includes("Public"))
        .map((holiday) => ({
          data: holiday.date,
          nazwa: holiday.localName || holiday.name || "Święto",
          ...(holiday.global === false && holiday.counties?.length ? { regiony: holiday.counties } : {}),
        })),
      pobrano: pobranoO,
    };
  },
});

const wikipedia = tool({
  description:
    "Wyszukuje hasło w polskiej Wikipedii i zwraca krótkie streszczenie oraz link do artykułu. " +
    "Użyj, gdy użytkownik chce poznać definicję, tło lub podstawowe informacje o konkretnym temacie. " +
    "Nie zastępuj tym narzędziem aktualnego wyszukiwania wiadomości ani kursów.",
  inputSchema: z.object({
    haslo: z.string().trim().min(1).max(120).describe("Tytuł hasła do sprawdzenia w polskiej Wikipedii"),
  }),
  execute: async ({ haslo }) => {
    const pobranoO = pobrano();
    const tytul = haslo.trim().replace(/\s+/g, "_");
    const url = `https://pl.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(tytul)}`;
    const result = await pobierzJson<{
      title?: string;
      description?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    }>(url, { Accept: "application/json", "User-Agent": "laba-agent/1.0 (Wikipedia summary tool)" });
    if (!result.ok) {
      const error = result.status === 404
        ? `Nie znalazłem hasła „${haslo}” w polskiej Wikipedii.`
        : "Źródło nie odpowiada (Wikipedia). Nie udało się sprawdzić hasła.";
      return { error, pobrano: pobranoO };
    }
    const artykul = result.data;
    return {
      haslo: artykul.title ?? haslo,
      opis: artykul.description,
      streszczenie: artykul.extract?.slice(0, 1800) || "To hasło nie ma krótkiego streszczenia.",
      link: artykul.content_urls?.desktop?.page ?? `https://pl.wikipedia.org/wiki/${encodeURIComponent(tytul)}`,
      pobrano: pobranoO,
    };
  },
});

const kalkulator = tool({
  description:
    "Wykonuje proste, dokładne działania na dwóch podanych liczbach. Użyj do dodawania, odejmowania, mnożenia lub dzielenia. " +
    "Liczby i działanie przekaż jako osobne argumenty; nigdy nie wykonuje tekstu ani kodu podanego przez użytkownika.",
  inputSchema: z.object({
    a: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000).describe("Pierwsza liczba"),
    dzialanie: z.enum(["dodaj", "odejmij", "pomnoz", "podziel"]).describe("Rodzaj działania"),
    b: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000).describe("Druga liczba"),
  }),
  execute: async ({ a, dzialanie, b }) => {
    const pobranoO = pobrano();
    if (dzialanie === "podziel" && b === 0) return { error: "Nie można dzielić przez zero.", pobrano: pobranoO };
    const wynik = dzialanie === "dodaj" ? a + b : dzialanie === "odejmij" ? a - b : dzialanie === "pomnoz" ? a * b : a / b;
    if (!Number.isFinite(wynik)) return { error: "Wynik wykracza poza obsługiwany zakres liczb.", pobrano: pobranoO };
    return { a, dzialanie, b, wynik, pobrano: pobranoO };
  },
});

const czas = tool({
  description:
    "Zwraca aktualną datę, dzień tygodnia i godzinę w podanej strefie czasowej IANA, np. Europe/Warsaw lub America/New_York. " +
    "Używaj zawsze, gdy pytanie zależy od teraz, dziś, jutra, wczoraj, terminu lub różnicy stref czasowych. " +
    "Jeśli użytkownik nie poda strefy, przyjmij Europe/Warsaw. Nie zgaduj daty z pamięci.",
  inputSchema: z.object({
    strefa: z.string().trim().min(1).max(100).optional().describe("Strefa IANA, np. Europe/Warsaw; domyślnie Europe/Warsaw"),
  }),
  execute: async ({ strefa }) => {
    const zona = strefa?.trim() || "Europe/Warsaw";
    const now = new Date();
    try {
      const format = (options: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat("pl-PL", { timeZone: zona, ...options }).format(now);
      return {
        data: format({ year: "numeric", month: "long", day: "numeric" }),
        dzienTygodnia: format({ weekday: "long" }),
        godzina: format({ hour: "2-digit", minute: "2-digit" }),
        strefa: zona,
        pobrano: pobrano(),
      };
    } catch {
      return { error: `Nie rozpoznaję strefy „${zona}”. Podaj nazwę IANA, np. Europe/Warsaw.`, pobrano: pobrano() };
    }
  },
});

const noteGlobal = globalThis as typeof globalThis & { __labaAgentNotes?: string[] };
const zapisaneNotatki = (noteGlobal.__labaAgentNotes ??= []);

const notatki = tool({
  description:
    "Zapisuje notatkę w tymczasowej pamięci serwera albo pokazuje zapisane notatki. " +
    "Użyj tylko, gdy użytkownik prosi o zapamiętanie/zapisanie czegoś lub o pokazanie notatek. " +
    "Wybierz akcję zapisz lub pokaz. Notatki znikną po restarcie serwera i nie są trwałym archiwum.",
  inputSchema: z.object({
    akcja: z.enum(["zapisz", "pokaz"]).describe("Czy zapisać nową notatkę, czy pokazać zapisane"),
    tresc: z.string().trim().min(1).max(1000).optional().describe("Treść nowej notatki; wymagane dla akcji zapisz"),
  }),
  execute: async ({ akcja, tresc }) => {
    const pobranoO = pobrano();
    if (akcja === "pokaz") return { notatki: [...zapisaneNotatki], liczba: zapisaneNotatki.length, pobrano: pobranoO };
    const trescNotatki = tresc?.trim();
    if (!trescNotatki) return { error: "Podaj treść notatki do zapisania.", pobrano: pobranoO };
    if (zapisaneNotatki.length >= 100) return { error: "Osiągnięto limit 100 notatek w pamięci serwera.", pobrano: pobranoO };
    zapisaneNotatki.push(trescNotatki);
    return { zapisano: trescNotatki, liczba: zapisaneNotatki.length, pobrano: pobranoO };
  },
});

const generujObraz = tool({
  description:
    "Generuje obraz na podstawie opisu. Użyj, gdy użytkownik prosi o grafikę, plakat, logo, ilustrację lub zdjęcie. " +
    "Obraz zobaczy użytkownik w rozmowie — nie wklejaj go do odpowiedzi.",
  inputSchema: z.object({
    opis: z.string().min(1).max(MAX_IMAGE_PROMPT).describe("Dokładny opis obrazu: co na nim jest, styl, kolory"),
  }),
  execute: async ({ opis }) => createImage(opis),
  toModelOutput: ({ output }) => ({
    type: "text",
    value: output.error ? `Błąd: ${output.error}` : "obraz wygenerowany",
  }),
});

const diagnostyka = tool({
  description:
    "Pokazuje informacje diagnostyczne aplikacji, gdy użytkownik pyta o model, narzędzia, ich limity lub konfigurację. " +
    "Zwraca nazwy modeli, listę aktywnych narzędzi, limit kroków i wyłącznie statusy tak/nie dla wymaganych zmiennych. " +
    "Nigdy nie pokazuj ani nie streszczaj wartości kluczy, haseł lub sekretów.",
  inputSchema: z.object({}),
  execute: async () => ({
    model: MODEL_ID,
    modelObrazow: IMAGE_MODEL_ID,
    narzedzia: TOOL_NAMES,
    limitKrokow: MAX_STEPS,
    limitWywolanNarzedzi: MAX_TOOL_CALLS,
    limitCzasuZadaniaSekundy: MAX_TASK_DURATION_MS / 1000,
    limitCzasuNarzedziaSekundy: MAX_TOOL_DURATION_MS / 1000,
    zmienneSrodowiskowe: {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ? "tak" : "nie",
      CHAT_PASSWORD: process.env.CHAT_PASSWORD ? "tak" : "nie",
      SESSION_SECRET: process.env.SESSION_SECRET ? "tak" : "nie",
    },
    pobrano: pobrano(),
  }),
});

export const agentTools = {
  wyszukiwanie: webSearchTool(),
  pogoda,
  mapa,
  waluty,
  swieta,
  wikipedia,
  kalkulator,
  czas,
  notatki,
  diagnostyka,
  generujObraz,
};

export function createTaskAgentTools(counter: { count: number }) {
  const localToolNames = new Set<string>();
  const tools = Object.fromEntries(
    Object.entries(agentTools).map(([name, definition]) => {
      const executable = definition as unknown as {
        execute?: (...args: unknown[]) => Promise<unknown>;
      };
      if (typeof executable.execute !== "function") return [name, definition];

      localToolNames.add(name);
      const execute = executable.execute;
      return [name, {
        ...definition,
        execute: async (...args: unknown[]) => {
          if (counter.count >= MAX_TOOL_CALLS) {
            return { error: `Osiągnięto limit ${MAX_TOOL_CALLS} wywołań narzędzi.` };
          }
          counter.count += 1;
          try {
            return await execute(...args);
          } catch {
            return { error: "Nie udało się wykonać narzędzia. Podam wynik częściowy." };
          }
        },
      }];
    }),
  ) as typeof agentTools;
  return { tools, localToolNames };
}

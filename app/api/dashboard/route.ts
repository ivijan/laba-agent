import { generateText } from "ai";
import { z } from "zod";
import { chatModel, isModelConfigured } from "@/lib/model";
import { hasSession } from "@/lib/session";
import { runTravelTool } from "@/lib/tools";

export const maxDuration = 60;

const requestSchema = z.object({
  miasto: z.string().trim().min(2).max(100),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }),
});

type BaseResult = { error?: string; pobrano?: string };
type WeatherResult = BaseResult & {
  miasto?: string;
  nazwaMiasta?: string;
  kodKraju?: string;
  strefa?: string;
  opis?: string;
  temperaturaMinC?: number;
  temperaturaMaxC?: number;
  prawdopodobienstwoOpadowProc?: number;
  wiatrMaxKmh?: number;
};
type CurrencyResult = BaseResult & { kursPLN?: number; dataKursu?: string };
type HolidayResult = BaseResult & {
  dniWolne?: Array<{ data: string; nazwa: string; regiony?: string[] }>;
};
type WikipediaResult = BaseResult & { streszczenie?: string; link?: string };
type TimeResult = BaseResult & { godzina?: string; strefa?: string };

type DashboardCard = {
  id: string;
  nazwa: string;
  wartosc: string;
  zrodlo: string;
  pobrano: string;
  link?: string;
  blad?: boolean;
};

const WALUTY_KRAJOW = {
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP",
  GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR",
  AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", CY: "EUR", MT: "EUR", LU: "EUR", EE: "EUR",
  LV: "EUR", LT: "EUR", SK: "EUR", SI: "EUR", HR: "EUR", CZ: "CZK", PL: "PLN", CH: "CHF",
  NO: "NOK", SE: "SEK", DK: "DKK", IS: "ISK", TR: "TRY", JP: "JPY", CN: "CNY", KR: "KRW",
  HK: "HKD", SG: "SGD", TH: "THB", VN: "VND", ID: "IDR", MY: "MYR", PH: "PHP", IN: "INR",
  AU: "AUD", NZ: "NZD", ZA: "ZAR", EG: "EGP", MA: "MAD", AE: "AED", SA: "SAR", IL: "ILS",
  UA: "UAH", NG: "NGN", KE: "KES", PK: "PKR", HU: "HUF", RO: "RON", BG: "BGN", RS: "RSD",
  BA: "BAM", AL: "ALL", MK: "MKD", GE: "GEL", AM: "AMD", AZ: "AZN", KZ: "KZT", UZ: "UZS",
  TW: "TWD", BD: "BDT", LK: "LKR", NP: "NPR", MM: "MMK", KH: "KHR", LA: "LAK", TN: "TND",
  GH: "GHS", TZ: "TZS", UG: "UGX", ET: "ETB", MU: "MUR", CR: "CRC", PA: "PAB",
  PE: "PEN", UY: "UYU", DO: "DOP", JM: "JMD", BS: "BSD", TT: "TTD", EC: "USD", SV: "USD",
} satisfies Record<string, string>;

function pobranoTeraz(): string {
  return new Date().toLocaleString("pl-PL", {
    timeZone: "Europe/Warsaw",
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function formatujLiczbe(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits }).format(value);
}

function offsetMinut(strefa: string, date: Date): number | null {
  try {
    const nazwa = new Intl.DateTimeFormat("en-US", {
      timeZone: strefa,
      timeZoneName: "shortOffset",
    }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
    const match = nazwa?.match(/^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/);
    if (!match) return null;
    const wartosc = Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    return match[1] === "-" ? -wartosc : wartosc;
  } catch {
    return null;
  }
}

function tekstBledu(result: BaseResult, fallback: string): string | undefined {
  return result.error || (result.pobrano ? undefined : fallback);
}

export async function POST(request: Request) {
  // Sesję sprawdzamy przed pobieraniem danych i przed wywołaniem modelu.
  if (!(await hasSession())) {
    return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Podaj prawidłowe miasto i datę w formacie RRRR-MM-DD." }, { status: 400 });
  }

  const { miasto, data } = parsed.data;
  const rok = Number(data.slice(0, 4));
  const pogoda = await runTravelTool<WeatherResult>("pogoda", { miasto, dzien: data })
    .catch((): WeatherResult => ({ error: "Źródło nie odpowiada (Open-Meteo). Nie udało się sprawdzić prognozy." }));
  const kraj = pogoda.kodKraju?.toUpperCase();
  const waluta = kraj ? WALUTY_KRAJOW[kraj as keyof typeof WALUTY_KRAJOW] : undefined;
  const strefa = pogoda.strefa;

  const [kurs, swieta, wikipedia, czasMiejsca, czasPolski] = await Promise.all([
    waluta
      ? runTravelTool<CurrencyResult>("waluty", { waluta, kwota: 1, kierunek: "waluta_na_pln" })
          .catch((): CurrencyResult => ({ error: "Źródło nie odpowiada (NBP). Nie udało się sprawdzić kursu." }))
      : Promise.resolve<CurrencyResult>({ error: kraj ? `Nie mam przypisanej waluty dla kraju ${kraj}.` : "Nie udało się ustalić kraju docelowego." }),
    kraj
      ? runTravelTool<HolidayResult>("swieta", { kraj, rok })
          .catch((): HolidayResult => ({ error: "Źródło nie odpowiada (Nager.Date). Nie udało się sprawdzić dni wolnych." }))
      : Promise.resolve<HolidayResult>({ error: "Nie udało się ustalić kraju docelowego." }),
    runTravelTool<WikipediaResult>("wikipedia", { haslo: pogoda.nazwaMiasta || miasto })
      .catch((): WikipediaResult => ({ error: "Źródło nie odpowiada (Wikipedia). Nie udało się sprawdzić miasta." })),
    strefa
      ? runTravelTool<TimeResult>("czas", { strefa }).catch((): TimeResult => ({ error: "Nie udało się sprawdzić czasu na miejscu." }))
      : Promise.resolve<TimeResult>({ error: "Brak strefy czasowej dla tego miasta." }),
    runTravelTool<TimeResult>("czas", { strefa: "Europe/Warsaw" })
      .catch((): TimeResult => ({ error: "Nie udało się sprawdzić czasu w Polsce." })),
  ]);

  const teraz = new Date();
  const roznicaMinut = strefa ? offsetMinut(strefa, teraz) : null;
  const offsetPolski = offsetMinut("Europe/Warsaw", teraz);
  const roznica = roznicaMinut === null || offsetPolski === null ? null : roznicaMinut - offsetPolski;
  const roznicaTekst = roznica === null
    ? "Nie udało się obliczyć różnicy czasu."
    : roznica === 0
      ? "taka sama godzina jak w Polsce"
      : `${formatujLiczbe(Math.abs(roznica) / 60)} godz. ${roznica > 0 ? "później" : "wcześniej"} niż w Polsce`;

  const prognozaTekst = pogoda.error || [
    pogoda.opis,
    typeof pogoda.temperaturaMinC === "number" && typeof pogoda.temperaturaMaxC === "number"
      ? `${formatujLiczbe(pogoda.temperaturaMinC)}–${formatujLiczbe(pogoda.temperaturaMaxC)} °C`
      : undefined,
    typeof pogoda.prawdopodobienstwoOpadowProc === "number"
      ? `opady: ${formatujLiczbe(pogoda.prawdopodobienstwoOpadowProc, 0)}%`
      : undefined,
    typeof pogoda.wiatrMaxKmh === "number" ? `wiatr: do ${formatujLiczbe(pogoda.wiatrMaxKmh)} km/h` : undefined,
  ].filter(Boolean).join(" · ") || "Brak danych prognozy.";

  const kursTekst = kurs.error
    ? kurs.error
    : typeof kurs.kursPLN === "number"
      ? `1 ${waluta} = ${formatujLiczbe(kurs.kursPLN, 4)} PLN${kurs.dataKursu ? ` (kurs z ${kurs.dataKursu})` : ""}`
      : "Brak danych kursu.";
  const najblizszeSwieta = swieta.dniWolne?.filter((holiday) => holiday.data >= data).slice(0, 3) ?? [];
  const swietaTekst = swieta.error
    ? swieta.error
    : najblizszeSwieta.length > 0
      ? najblizszeSwieta.map((holiday) => `${holiday.data}: ${holiday.nazwa}${holiday.regiony?.length ? ` (${holiday.regiony.join(", ")})` : ""}`).join(" · ")
      : `Brak kolejnych dni wolnych w ${rok} od ${data}.`;
  const streszczenie = wikipedia.streszczenie?.match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(" ").trim()
    || wikipedia.streszczenie
    || "Brak krótkiego opisu miasta.";
  const czasTekst = czasMiejsca.error
    ? czasMiejsca.error
    : `${czasMiejsca.godzina ?? "Brak godziny"} — ${roznicaTekst}`;

  const cards: DashboardCard[] = [
    { id: "weather", nazwa: "Pogoda", wartosc: prognozaTekst, zrodlo: "Open-Meteo", pobrano: pogoda.pobrano || pobranoTeraz(), blad: Boolean(pogoda.error) },
    { id: "currency", nazwa: "Waluty", wartosc: kursTekst, zrodlo: "NBP", pobrano: kurs.pobrano || pobranoTeraz(), blad: Boolean(kurs.error) },
    { id: "holidays", nazwa: "Święta", wartosc: swietaTekst, zrodlo: "Nager.Date", pobrano: swieta.pobrano || pobranoTeraz(), blad: Boolean(swieta.error) },
    { id: "wikipedia", nazwa: "O mieście", wartosc: streszczenie, zrodlo: "Wikipedia polska", pobrano: wikipedia.pobrano || pobranoTeraz(), link: wikipedia.link, blad: Boolean(wikipedia.error) },
    { id: "time", nazwa: "Czas na miejscu", wartosc: czasTekst, zrodlo: "Zegar systemowy / IANA", pobrano: czasMiejsca.pobrano || pobranoTeraz(), blad: Boolean(czasMiejsca.error) },
  ];

  const podsumowanieDanych = {
    miasto: pogoda.miasto || miasto,
    data,
    pogoda: prognozaTekst,
    kurs: kursTekst,
    najblizszeSwieta: swietaTekst,
    czas: czasTekst,
    opisMiasta: streszczenie,
  };
  let podsumowanie = "Nie udało się wygenerować podsumowania. Sprawdź dane na kartach przed wyjazdem.";
  if (isModelConfigured()) {
    try {
      const result = await generateText({
        model: chatModel(),
        instructions: "Jesteś asystentem podróży. Napisz po polsku krótkie podsumowanie w 2–3 zdaniach: co spakować i na co uważać. Opieraj się wyłącznie na podanych danych. Jeśli dane są niedostępne, powiedz to wprost; nie zgaduj.",
        prompt: JSON.stringify(podsumowanieDanych),
        timeout: { totalMs: 15_000 },
      });
      if (result.text.trim()) podsumowanie = result.text.trim();
    } catch {
      // Karty z danymi pozostają dostępne, nawet gdy model nie przygotuje podsumowania.
    }
  }

  return Response.json({ miasto: pogoda.miasto || miasto, data, cards, podsumowanie });
}

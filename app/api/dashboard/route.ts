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
  status: "OK" | "Brak danych";
  wartosc?: string;
  zrodlo: string;
  pobrano?: string;
  link?: string;
  powodBraku?: string;
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
    ? undefined
    : roznica === 0
      ? "taka sama godzina jak w Polsce"
      : `${formatujLiczbe(Math.abs(roznica) / 60)} godz. ${roznica > 0 ? "później" : "wcześniej"} niż w Polsce`;

  const powodPogody = pogoda.error || (!pogoda.opis || pogoda.opis === "nieznane warunki pogodowe"
    ? "Open-Meteo nie zwrócił pełnego opisu prognozy."
    : undefined);
  const prognozaTekst = powodPogody ? undefined : [
    pogoda.opis,
    typeof pogoda.temperaturaMinC === "number" && typeof pogoda.temperaturaMaxC === "number"
      ? `${formatujLiczbe(pogoda.temperaturaMinC)}–${formatujLiczbe(pogoda.temperaturaMaxC)} °C`
      : undefined,
    typeof pogoda.prawdopodobienstwoOpadowProc === "number"
      ? `opady: ${formatujLiczbe(pogoda.prawdopodobienstwoOpadowProc, 0)}%`
      : undefined,
    typeof pogoda.wiatrMaxKmh === "number" ? `wiatr: do ${formatujLiczbe(pogoda.wiatrMaxKmh)} km/h` : undefined,
  ].filter(Boolean).join(" · ");

  const powodKursu = kurs.error || (typeof kurs.kursPLN !== "number" ? "NBP nie zwrócił kursu." : undefined);
  const kursTekst = powodKursu ? undefined : `1 ${waluta} = ${formatujLiczbe(kurs.kursPLN!, 4)} PLN${kurs.dataKursu ? ` (kurs z ${kurs.dataKursu})` : ""}`;
  const swietaOdDaty = swieta.dniWolne?.filter((holiday) => holiday.data >= data) ?? [];
  const swietaZNazwami = swietaOdDaty.filter((holiday) => holiday.nazwa && holiday.nazwa !== "Święto");
  const najblizszeSwieta = swietaZNazwami.slice(0, 3);
  const powodSwieta = swieta.error || !Array.isArray(swieta.dniWolne)
    ? "Nager.Date nie zwrócił listy świąt."
    : swietaOdDaty.length > 0 && swietaZNazwami.length === 0
      ? "Nager.Date nie zwrócił nazw najbliższych dni wolnych."
      : undefined;
  const swietaTekst = powodSwieta
    ? undefined
    : najblizszeSwieta.length > 0
      ? najblizszeSwieta.map((holiday) => `${holiday.data}: ${holiday.nazwa}${holiday.regiony?.length ? ` (${holiday.regiony.join(", ")})` : ""}`).join(" · ")
      : `Brak kolejnych dni wolnych w ${rok} od ${data}.`;
  const streszczenie = wikipedia.streszczenie === "To hasło nie ma krótkiego streszczenia."
    ? undefined
    : wikipedia.streszczenie?.match(/[^.!?]+[.!?]+/g)?.slice(0, 2).join(" ").trim() || wikipedia.streszczenie;
  const powodWiki = wikipedia.error || (!streszczenie || !wikipedia.link ? "Wikipedia nie zwróciła streszczenia ani linku." : undefined);
  const powodCzasu = czasMiejsca.error || czasPolski.error || !czasMiejsca.godzina || !roznicaTekst
    ? "Nie udało się ustalić aktualnej godziny i różnicy czasu."
    : undefined;
  const czasTekst = powodCzasu ? undefined : `${czasMiejsca.godzina} — ${roznicaTekst}`;

  const cards: DashboardCard[] = [
    { id: "weather", nazwa: "Pogoda", status: powodPogody ? "Brak danych" : "OK", ...(prognozaTekst ? { wartosc: prognozaTekst } : {}), zrodlo: "Open-Meteo", pobrano: pogoda.pobrano, powodBraku: powodPogody },
    { id: "currency", nazwa: "Waluty", status: powodKursu ? "Brak danych" : "OK", ...(kursTekst ? { wartosc: kursTekst } : {}), zrodlo: "NBP", pobrano: kurs.pobrano, powodBraku: powodKursu },
    { id: "holidays", nazwa: "Święta", status: powodSwieta ? "Brak danych" : "OK", ...(swietaTekst ? { wartosc: swietaTekst } : {}), zrodlo: "Nager.Date", pobrano: swieta.pobrano, powodBraku: powodSwieta },
    { id: "wikipedia", nazwa: "O mieście", status: powodWiki ? "Brak danych" : "OK", ...(streszczenie ? { wartosc: streszczenie } : {}), zrodlo: "Wikipedia polska", pobrano: wikipedia.pobrano, ...(!powodWiki && wikipedia.link ? { link: wikipedia.link } : {}), powodBraku: powodWiki },
    { id: "time", nazwa: "Czas na miejscu", status: powodCzasu ? "Brak danych" : "OK", ...(czasTekst ? { wartosc: czasTekst } : {}), zrodlo: "Zegar systemowy / IANA", pobrano: czasMiejsca.pobrano, powodBraku: powodCzasu },
  ];

  const brakujaceZrodla = cards.filter((card) => card.status === "Brak danych");
  const podsumowanieDanych = {
    miasto: pogoda.miasto || miasto,
    data,
    karty: cards.map(({ nazwa, status, wartosc, zrodlo, powodBraku }) => ({ nazwa, status, wartosc, zrodlo, powodBraku })),
    brakujaceZrodla: brakujaceZrodla.map((card) => `${card.zrodlo} (${card.nazwa}): ${card.powodBraku ?? "brak danych"}`),
  };
  const listaBrakow = brakujaceZrodla.map((card) => `${card.zrodlo} (${card.nazwa})`).join(", ");
  let podsumowanie = brakujaceZrodla.length > 0
    ? `Dopasuj bagaż do danych z dostępnych kart. Brak danych z: ${listaBrakow}.`
    : "Sprawdź dane na kartach i przygotuj bagaż do warunków w miejscu docelowym.";
  if (isModelConfigured()) {
    try {
      const result = await generateText({
        model: chatModel(),
        instructions: "Jesteś asystentem podróży. Napisz po polsku dokładnie 2 zdania: co spakować i na co uważać. Opieraj się wyłącznie na podanych danych, niczego nie zgaduj. Jeśli brakuje źródła, nazwij je wprost w drugim zdaniu.",
        prompt: JSON.stringify(podsumowanieDanych),
        timeout: { totalMs: 15_000 },
      });
      if (result.text.trim()) {
        podsumowanie = result.text.trim();
        if (brakujaceZrodla.length > 0 && !brakujaceZrodla.every((card) => podsumowanie.includes(card.zrodlo))) {
          const pierwszeZdanie = podsumowanie.match(/[^.!?]+[.!?]+/)?.[0].trim() || "Dopasuj bagaż do potwierdzonych danych z kart.";
          podsumowanie = `${pierwszeZdanie} Brak danych z: ${listaBrakow}.`;
        }
      }
    } catch {
      // Karty z danymi pozostają dostępne, nawet gdy model nie przygotuje podsumowania.
    }
  }

  return Response.json({ miasto: pogoda.miasto || miasto, data, cards, podsumowanie });
}

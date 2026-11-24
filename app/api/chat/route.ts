import {
  streamText,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { chatModel, isModelConfigured, openrouter } from "@/lib/model";
import { INSTRUCTIONS } from "@/lib/persona";
import { hasSession } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: Request) {
  // 1. Najpierw sprawdzamy sesję. Bez niej nie dotykamy modelu.
  if (!(await hasSession())) {
    return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  }

  if (!isModelConfigured()) {
    return Response.json({ error: "Brak OPENROUTER_API_KEY w konfiguracji." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const messages: UIMessage[] | undefined = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Brak wiadomości." }, { status: 400 });
  }

  const lastMessage = messages[messages.length - 1];
  const imageParts =
    lastMessage?.role === "user"
      ? lastMessage.parts.filter((part) => part.type === "file")
      : [];
  const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];
  for (const part of imageParts) {
    if (!allowedImageTypes.includes(part.mediaType)) {
      return Response.json(
        { error: "Dozwolone są tylko zdjęcia JPG, PNG i WebP." },
        { status: 400 },
      );
    }

    const base64Data = part.url.match(/^data:image\/(?:jpeg|png|webp);base64,(.+)$/)?.[1];
    if (!base64Data) {
      return Response.json({ error: "Nie udało się odczytać zdjęcia." }, { status: 400 });
    }

    const padding = base64Data.endsWith("==") ? 2 : base64Data.endsWith("=") ? 1 : 0;
    const imageSize = Math.floor((base64Data.length * 3) / 4) - padding;
    if (imageSize > 4 * 1024 * 1024) {
      return Response.json({ error: "Zdjęcie może mieć najwyżej 4 MB." }, { status: 400 });
    }
  }

  const hasImage =
    lastMessage?.role === "user" &&
    imageParts.length > 0;
  let usedModelId: string | undefined;

  // 2. Wysyłamy rozmowę do modelu i odsyłamy odpowiedź kawałek po kawałku (streaming).
  const result = streamText({
    model: chatModel(),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages),
    tools: {
      webSearch: openrouter.tools.webSearch({ maxResults: 3, engine: "native" }),
      aktualnyCzas: tool({
        description:
          "Zwróć aktualną datę, dzień tygodnia i godzinę w strefie Europe/Warsaw. Używaj tego narzędzia, gdy użytkownik pyta o dziś, jutro, konkretny dzień lub datę, albo za ile dni coś nastąpi — szczególnie do poprawnego ustalenia daty i godziny.",
        inputSchema: z.object({}),
        execute: async () => ({
          dateTime: `${new Intl.DateTimeFormat("pl-PL", {
            timeZone: "Europe/Warsaw",
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date())} (Europe/Warsaw)`,
        }),
      }),
      disneyPlus: tool({
        description:
          "Wyszukaj w publicznym Disney API postacie powiązane z podanym tytułem filmu. Używaj, gdy pytanie dotyczy filmu Disneya i jego postaci. To API zawiera dane o postaciach i listach filmów, nie zawiera opisów filmów ani informacji o dostępności w serwisie Disney+.",
        inputSchema: z.object({
          title: z.string().min(1).describe("Tytuł filmu Disney, którego szukamy"),
        }),
        execute: async ({ title }) => {
          const retrievedAt = new Date().toISOString();
          const unavailableMessage =
            "Nie udało się teraz pobrać danych z Disney API. Spróbuj ponownie za chwilę.";

          try {
            const query =
              "query($title: String!) { characters(filter: { films: $title }) { items { name films } } }";
            const url = new URL("https://api.disneyapi.dev/graphql");
            url.searchParams.set("query", query);
            url.searchParams.set("variables", JSON.stringify({ title }));

            const response = await fetch(url, {
              method: "GET",
              cache: "no-store",
              signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) {
              return { title, characters: [], retrievedAt, message: unavailableMessage };
            }

            const payload = (await response.json()) as {
              data?: {
                characters?: {
                  items?: Array<{ name?: unknown; films?: unknown }>;
                };
              };
              errors?: unknown[];
            };

            const items = payload.data?.characters?.items;
            if (payload.errors?.length || !items) {
              return { title, characters: [], retrievedAt, message: unavailableMessage };
            }

            const normalizedTitle = title.trim().toLocaleLowerCase("pl-PL");
            const characters = items
              .map((item) => ({
                name: typeof item.name === "string" ? item.name : "",
                films: Array.isArray(item.films)
                  ? item.films.filter(
                      (film): film is string =>
                        typeof film === "string" &&
                        film.trim().toLocaleLowerCase("pl-PL") === normalizedTitle,
                    )
                  : [],
              }))
              .filter((item) => item.name && item.films.length > 0)
              .slice(0, 10);

            return {
              title,
              characters,
              retrievedAt,
              ...(characters.length === 0
                ? { message: "Nie znaleziono postaci powiązanych z tym tytułem w Disney API." }
                : {}),
            };
          } catch {
            return { title, characters: [], retrievedAt, message: unavailableMessage };
          }
        },
      }),
    },
    stopWhen: isStepCount(5),
    onStepEnd: ({ response }) => {
      usedModelId = response.modelId;
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendSources: true,
      originalMessages: messages as UIMessage<{
        sourceFetchedAt?: string;
        modelId?: string;
        generatedImage?: boolean;
      }>[],
      messageMetadata: ({ part }) =>
        part.type === "finish"
          ? {
              sourceFetchedAt: new Date().toISOString(),
              ...(hasImage && usedModelId ? { modelId: usedModelId } : {}),
            }
          : undefined,
    }),
  });
}

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateImage as generateImageFile,
  generateText,
  isStepCount,
  Output,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { ANALYSIS_INSTRUCTIONS, analysisSchema, INSTRUCTIONS } from "@/lib/persona";
import { chatModel, isModelConfigured, openrouter } from "@/lib/model";
import { hasSession } from "@/lib/session";

export const maxDuration = 60;

const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

type AgentMessageMetadata = {
  sourceFetchedAt?: string;
  modelId?: string;
};

type ImageToolOutput =
  | { image: string; mediaType: string; modelId: string; error?: undefined }
  | { error: string; image?: undefined; mediaType?: undefined; modelId?: undefined };

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || (body.mode !== "chat" && body.mode !== "analyze")) {
    return Response.json({ error: "Nieznany tryb pracy." }, { status: 400 });
  }

  if (body.mode === "analyze") {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      return Response.json({ error: "Wpisz wiadomość do analizy." }, { status: 400 });
    }
    if (text.length > 4000) {
      return Response.json({ error: "Wiadomość jest za długa (limit 4000 znaków)." }, { status: 400 });
    }
    if (!isModelConfigured()) {
      return Response.json({ error: "Brak konfiguracji modelu." }, { status: 500 });
    }

    try {
      const { output } = await generateText({
        model: chatModel(),
        instructions: ANALYSIS_INSTRUCTIONS,
        prompt: text,
        output: Output.object({ schema: analysisSchema }),
      });

      const checked = analysisSchema.safeParse(output);
      if (!checked.success) {
        return Response.json({ error: "Model zwrócił dane w złym formacie." }, { status: 502 });
      }
      return Response.json(checked.data);
    } catch {
      return Response.json({ error: "Nie udało się przeanalizować wiadomości." }, { status: 502 });
    }
  }

  const messages: UIMessage<AgentMessageMetadata>[] | undefined = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Brak wiadomości." }, { status: 400 });
  }
  if (!isModelConfigured()) {
    return Response.json({ error: "Brak konfiguracji modelu." }, { status: 500 });
  }

  const lastMessage = messages[messages.length - 1];
  const imageParts =
    lastMessage?.role === "user"
      ? lastMessage.parts.filter((part) => part.type === "file")
      : [];
  for (const part of imageParts) {
    if (!ALLOWED_IMAGE_TYPES.includes(part.mediaType)) {
      return Response.json({ error: "Dozwolone są tylko zdjęcia JPG, PNG i WebP." }, { status: 400 });
    }

    const base64Data = part.url.match(/^data:image\/(?:jpeg|png|webp);base64,(.+)$/)?.[1];
    if (!base64Data) {
      return Response.json({ error: "Nie udało się odczytać zdjęcia." }, { status: 400 });
    }
    const padding = base64Data.endsWith("==") ? 2 : base64Data.endsWith("=") ? 1 : 0;
    if (Math.floor((base64Data.length * 3) / 4) - padding > MAX_IMAGE_SIZE) {
      return Response.json({ error: "Zdjęcie może mieć najwyżej 4 MB." }, { status: 400 });
    }
  }

  const hasImage = lastMessage?.role === "user" && imageParts.length > 0;
  let usedModelId: string | undefined;

  const tools = {
    webSearch: openrouter.tools.webSearch({ maxResults: 3, engine: "native" }),
    aktualnyCzas: tool({
      description:
        "Zwróć aktualną datę, dzień tygodnia i godzinę w strefie Europe/Warsaw. Używaj tego narzędzia, gdy użytkownik pyta o dziś, jutro, konkretny dzień lub datę, albo za ile dni coś nastąpi.",
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
        "Wyszukaj w publicznym Disney API postacie powiązane z podanym tytułem filmu. Używaj, gdy pytanie dotyczy filmu Disneya i jego postaci. API zawiera dane o postaciach i listach filmów, nie opisy filmów ani dostępność w serwisie Disney+.",
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
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) {
            return { title, characters: [], retrievedAt, message: unavailableMessage };
          }

          const payload = (await response.json()) as {
            data?: { characters?: { items?: Array<{ name?: unknown; films?: unknown }> } };
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
    generateImage: tool({
      description:
        "Wygeneruj obraz, gdy użytkownik prosi o stworzenie, narysowanie lub wygenerowanie obrazu. Zwróć wygenerowany obraz użytkownikowi. Nie używaj tego narzędzia do opisywania przesłanych zdjęć.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(500).describe("Opis obrazu, który należy wygenerować"),
      }),
      execute: async ({ prompt }): Promise<ImageToolOutput> => {
        try {
          const result = await generateImageFile({
            model: openrouter.imageModel(IMAGE_MODEL),
            prompt,
          });
          const modelId = result.calls[0]?.response.modelId;
          if (!modelId) {
            return { error: "Model nie zwrócił identyfikatora obrazu. Spróbuj ponownie później." };
          }
          return {
            image: `data:${result.image.mediaType};base64,${result.image.base64}`,
            mediaType: result.image.mediaType,
            modelId,
          };
        } catch {
          return {
            error: "Nie udało się wygenerować obrazu. Model może być chwilowo niedostępny — spróbuj ponownie.",
          };
        }
      },
      toModelOutput: ({ output }) => ({
        type: "text",
        value: output.error ?? "obraz wygenerowany",
      }),
    }),
  };

  const result = streamText({
    model: chatModel(),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: isStepCount(5),
    onStepEnd: ({ response }) => {
      usedModelId = response.modelId;
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      sendSources: true,
      originalMessages: messages,
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

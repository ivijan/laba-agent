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
    },
    stopWhen: isStepCount(5),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendSources: true,
      originalMessages: messages as UIMessage<{ sourceFetchedAt?: string }>[],
      messageMetadata: ({ part }) =>
        part.type === "finish"
          ? { sourceFetchedAt: new Date().toISOString() }
          : undefined,
    }),
  });
}

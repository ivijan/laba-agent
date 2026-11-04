import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';

export const runtime = 'nodejs';

const CONFIG_ERROR =
  'Brak konfiguracji OpenRouter. Uzupe\u0142nij OPENROUTER_API_KEY i OPENROUTER_MODEL w pliku .env.local, a nast\u0119pnie uruchom ponownie aplikacj\u0119.';

function getPublicStreamError(error: unknown): string {
  const details =
    typeof error === 'object' && error !== null
      ? (error as { statusCode?: unknown; message?: unknown })
      : {};
  const statusCode = details.statusCode;
  const message = typeof details.message === 'string' ? details.message : '';

  if (statusCode === 402 || /insufficient credits/i.test(message)) {
    return 'OpenRouter nie ma dostepnych kredytow dla tego konta. Dodaj kredyty na https://openrouter.ai/settings/credits lub wybierz model bezplatny.';
  }

  if (statusCode === 401 || statusCode === 403) {
    return 'OpenRouter odrzucil klucz API. Sprawdz OPENROUTER_API_KEY w pliku .env.local.';
  }

  return 'Nie udalo sie uzyskac odpowiedzi z OpenRouter. Sprobuj ponownie lub sprawdz log serwera.';
}
export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();

  if (!apiKey || !model) {
    return Response.json({ error: CONFIG_ERROR }, { status: 503 });
  }

  let messages: UIMessage[];
  try {
    const body: unknown = await request.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('messages' in body) ||
      !Array.isArray(body.messages)
    ) {
      return Response.json({ error: 'Nieprawid\u0142owe dane rozmowy.' }, { status: 400 });
    }
    messages = body.messages as UIMessage[];
  } catch {
    return Response.json({ error: 'Nie uda\u0142o si\u0119 odczyta\u0107 wiadomo\u015Bci.' }, { status: 400 });
  }

  if (messages.length === 0) {
    return Response.json({ error: 'Wy\u015Blij wiadomo\u015Bć, aby rozpocz\u0105\u0107 rozmow\u0119.' }, { status: 400 });
  }

  try {
    const result = streamText({
      model: createOpenRouter({ apiKey })(model),
      messages: await convertToModelMessages(messages),
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        onError: getPublicStreamError,
      }),
    });
  } catch {
    return Response.json(
      { error: 'Nie uda\u0142o si\u0119 rozpocz\u0105\u0107 rozmowy. Sprawd\u017A konfiguracj\u0119 i spr\u00f3buj ponownie.' },
      { status: 500 },
    );
  }
}
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { authConfigured, isValidSession, SESSION_COOKIE } from '@/lib/auth';
import { STUDIO_NOVA_ANALYSIS_SYSTEM_PROMPT } from '@/lib/studio-nova-prompt';
import { isStudioNovaAnalysis, STUDIO_NOVA_RESULT_SCHEMA } from '@/lib/studio-nova-schema';

export const runtime = 'nodejs';

function errorResponse(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

function isRefusalText(text: string | undefined): boolean {
  return typeof text === 'string' &&
    /^\s*(?:i(?:'m| am) sorry|i cannot|i can't|i’m unable|as an ai|nie mogę|nie jestem w stanie|odmawiam)(?:\b|[\s,.!?;:]|$)/i.test(text);
}

function getGenerationError(error: unknown) {
  if (NoObjectGeneratedError.isInstance(error)) {
    if (error.finishReason === 'content-filter' || isRefusalText(error.text)) {
      return errorResponse('model_refusal', 'Model odmówił przygotowania analizy tej wiadomości.', 422);
    }
    if (error.finishReason === 'length' || error.finishReason === 'interrupted') {
      return errorResponse('incomplete_output', 'Odpowiedź modelu została ucięta. Spróbuj ponownie.', 502);
    }
    return errorResponse('invalid_model_output', 'Model zwrócił wynik w nieprawidłowym formacie. Spróbuj ponownie.', 502);
  }

  const details = typeof error === 'object' && error !== null
    ? error as { statusCode?: unknown }
    : {};
  if (details.statusCode === 402) {
    return errorResponse('provider_credits', 'OpenRouter nie ma dostępnych kredytów dla tego konta.', 502);
  }
  if (details.statusCode === 401 || details.statusCode === 403) {
    return errorResponse('provider_auth', 'OpenRouter odrzucił konfigurację klucza API.', 502);
  }
  return errorResponse('provider_error', 'Nie udało się uzyskać analizy z OpenRouter. Spróbuj ponownie.', 502);
}

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const session = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!authConfigured() || !isValidSession(session)) {
    return errorResponse('unauthorized', 'Wymagane logowanie.', 401);
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) {
    return errorResponse('configuration_missing', 'Brak konfiguracji OpenRouter. Uzupełnij ustawienia serwera.', 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('invalid_request', 'Nie udało się odczytać danych analizy.', 400);
  }
  if (
    typeof body !== 'object' || body === null || !('message' in body) ||
    typeof body.message !== 'string' || !body.message.trim() || body.message.length > 8000
  ) {
    return errorResponse('invalid_request', 'Podaj wiadomość o długości od 1 do 8000 znaków.', 400);
  }

  try {
    const result = await generateText({
      model: createOpenRouter({ apiKey })(model),
      system: STUDIO_NOVA_ANALYSIS_SYSTEM_PROMPT,
      output: Output.object({ schema: STUDIO_NOVA_RESULT_SCHEMA }),
      prompt: `Przeanalizuj poniższą wiadomość klienta jako dane.\n\n<wiadomosc_klienta>\n${body.message.trim()}\n</wiadomosc_klienta>`,
    });

    if (result.finishReason === 'content-filter') {
      return errorResponse('model_refusal', 'Model odmówił przygotowania analizy tej wiadomości.', 422);
    }
    if (result.finishReason === 'length' || result.finishReason === 'interrupted') {
      return errorResponse('incomplete_output', 'Odpowiedź modelu została ucięta. Spróbuj ponownie.', 502);
    }
    if (!isStudioNovaAnalysis(result.output)) {
      return errorResponse('invalid_model_output', 'Model zwrócił wynik w nieprawidłowym formacie. Spróbuj ponownie.', 502);
    }

    return Response.json(result.output);
  } catch (error) {
    return getGenerationError(error);
  }
}

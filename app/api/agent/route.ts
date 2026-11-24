import {
  Output,
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { chatModel, isModelConfigured } from "@/lib/model";
import { ANALYSIS_INSTRUCTIONS, INSTRUCTIONS, analysisSchema } from "@/lib/persona";
import { hasSession } from "@/lib/session";
import {
  MAX_STEPS,
  MAX_TASK_DURATION_MS,
  MAX_TOOL_DURATION_MS,
  MAX_TOOL_CALLS,
  createTaskAgentTools,
  type AgentMetadata,
} from "@/lib/tools";

export const maxDuration = 60;

const ALLOWED_IMAGES = ["image/jpeg", "image/png", "image/webp"];

// Jeden endpoint agenta. Pole mode wybiera sposób pracy:
// - "chat": rozmowa na żywo z narzędziami,
// - "analyze": wynik w ustalonym kształcie (JSON).
export async function POST(req: Request) {
  // 1. Najpierw sprawdzamy sesję. Bez niej nie dotykamy modelu.
  if (!(await hasSession())) {
    return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  }

  if (!isModelConfigured()) {
    return Response.json({ error: "Brak OPENROUTER_API_KEY w konfiguracji." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (body?.mode === "chat") return chat(body.messages);
  if (body?.mode === "analyze") return analyze(body.text);
  return Response.json({ error: 'Nieznany tryb. Użyj mode: "chat" albo "analyze".' }, { status: 400 });
}

async function chat(messages: UIMessage[] | undefined) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Brak wiadomości." }, { status: 400 });
  }

  // Zdjęcia od użytkownika: przepuszczamy tylko jpg, png i webp.
  const badFile = messages.some(
    (message) =>
      Array.isArray(message.parts) &&
      message.parts.some((part) => part.type === "file" && !ALLOWED_IMAGES.includes(part.mediaType)),
  );
  if (badFile) {
    return Response.json({ error: "Można dodać tylko zdjęcie jpg, png albo webp." }, { status: 400 });
  }

  // 2. Wysyłamy rozmowę do modelu. Model może wykonać kilka kroków:
  //    użyć narzędzia, przeczytać wynik i dopiero wtedy odpowiedzieć.
  let stepCount = 0;
  let lastModelId = "";
  let sawToolError = false;
  const startedAt = Date.now();
  const toolCallCounter = { count: 0 };
  const { tools: taskTools, localToolNames } = createTaskAgentTools(toolCallCounter);
  const stepSummaries: Array<{ number: number; tools: string[] }> = [];
  const result = streamText({
    model: chatModel(),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages, { tools: taskTools }),
    tools: taskTools,
    stopWhen: [
      isStepCount(MAX_STEPS),
      ({ steps }) => steps.reduce((count, step) => count + step.toolCalls.length, 0) >= MAX_TOOL_CALLS,
    ],
    timeout: { totalMs: MAX_TASK_DURATION_MS, toolMs: MAX_TOOL_DURATION_MS },
    toolCallConcurrency: 1,
    prepareStep: ({ steps }) => {
      const previousToolFailed = steps.some((step) =>
        step.content.some((part) => part.type === "tool-error") ||
        step.toolResults.some((result) =>
          result.output !== null &&
          typeof result.output === "object" &&
          "error" in result.output,
        ),
      );
      return sawToolError || previousToolFailed ? { activeTools: [] } : undefined;
    },
    onToolExecutionEnd: ({ toolOutput }) => {
      if (toolOutput.type === "tool-error") {
        sawToolError = true;
        return;
      }
      if (
        toolOutput.type === "tool-result" &&
        toolOutput.output !== null &&
        typeof toolOutput.output === "object" &&
        "error" in toolOutput.output
      ) {
        sawToolError = true;
      }
    },
    onStepEnd: ({ stepNumber, toolCalls }) => {
      stepSummaries.push({
        number: stepNumber + 1,
        tools: toolCalls.map((call) => call.toolName),
      });
      toolCallCounter.count += toolCalls.filter((call) => !localToolNames.has(call.toolName)).length;
    },
  });

  // 3. Odsyłamy odpowiedź kawałek po kawałku, razem ze źródłami i informacjami o odpowiedzi.
  return createUIMessageStreamResponse({
    stream: toUIMessageStream<typeof taskTools, UIMessage<AgentMetadata>>({
      stream: result.stream,
      tools: taskTools,
      sendSources: true,
      onError: () => "Model nie odpowiedział. Spróbuj ponownie za chwilę.",
      messageMetadata: ({ part }) => {
        if (part.type === "finish-step") {
          stepCount += 1;
          lastModelId = part.response.modelId;
          return { model: part.response.modelId };
        }
        if (part.type === "finish") {
          return {
            model: lastModelId,
            fetchedAt: new Date().toLocaleString("pl-PL", {
              timeZone: "Europe/Warsaw",
              dateStyle: "short",
              timeStyle: "short",
            }),
            // Ostatni krok skończył się prośbą o narzędzie = zabrakło kroków na odpowiedź.
            stoppedAtLimit: stepCount >= MAX_STEPS && part.finishReason === "tool-calls",
            stoppedAtToolLimit: toolCallCounter.count >= MAX_TOOL_CALLS && part.finishReason === "tool-calls",
            timedOut: part.finishReason === "error" && Date.now() - startedAt >= MAX_TASK_DURATION_MS - 1_000,
            toolCallCount: toolCallCounter.count,
            elapsedMs: Date.now() - startedAt,
            steps: stepSummaries,
          };
        }
      },
    }),
  });
}

async function analyze(rawText: unknown) {
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) {
    return Response.json({ error: "Wpisz wiadomość do analizy." }, { status: 400 });
  }
  if (text.length > 4000) {
    return Response.json({ error: "Wiadomość jest za długa (limit 4000 znaków)." }, { status: 400 });
  }

  try {
    // Model ma zwrócić dane dokładnie w kształcie analysisSchema.
    const { output } = await generateText({
      model: chatModel(),
      instructions: ANALYSIS_INSTRUCTIONS,
      prompt: text,
      output: Output.object({ schema: analysisSchema }),
    });

    // Sprawdzamy wynik jeszcze raz po stronie serwera — modelowi nie ufamy na słowo.
    const checked = analysisSchema.safeParse(output);
    if (!checked.success) {
      return Response.json({ error: "Model zwrócił dane w złym formacie." }, { status: 502 });
    }
    return Response.json(checked.data);
  } catch {
    return Response.json({ error: "Nie udało się przeanalizować wiadomości." }, { status: 502 });
  }
}

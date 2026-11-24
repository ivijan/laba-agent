import { generateImage } from "ai";
import { hasSession } from "@/lib/session";
import { isModelConfigured, openrouter } from "@/lib/model";

const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

export async function POST(req: Request) {
  if (!(await hasSession())) {
    return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  }

  if (!isModelConfigured()) {
    return Response.json(
      { error: "Generowanie obrazu jest teraz niedostępne. Spróbuj ponownie później." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "Wpisz opis obrazu." }, { status: 400 });
  }
  if (prompt.length > 500) {
    return Response.json({ error: "Opis obrazu może mieć najwyżej 500 znaków." }, { status: 400 });
  }

  try {
    const result = await generateImage({
      model: openrouter.imageModel(IMAGE_MODEL),
      prompt,
    });
    const modelId = result.calls[0]?.response.modelId;

    if (!modelId) {
      return Response.json(
        { error: "Model nie zwrócił identyfikatora obrazu. Spróbuj ponownie później." },
        { status: 503 },
      );
    }

    return Response.json({
      image: `data:${result.image.mediaType};base64,${result.image.base64}`,
      mediaType: result.image.mediaType,
      modelId,
    });
  } catch {
    return Response.json(
      { error: "Nie udało się wygenerować obrazu. Model może być chwilowo niedostępny — spróbuj ponownie." },
      { status: 503 },
    );
  }
}

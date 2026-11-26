import { hasSession } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";

type ProfileInput = { name: string | null; preferences: Record<string, string> };

function validProfile(value: unknown): value is ProfileInput {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  if (profile.name !== null && typeof profile.name !== "string") return false;
  if (!profile.preferences || typeof profile.preferences !== "object" || Array.isArray(profile.preferences)) return false;
  return Object.entries(profile.preferences).every(([key, item]) =>
    key.trim().length > 0 && key.length <= 100 && typeof item === "string" && item.length <= 300,
  );
}

export async function GET() {
  if (!(await hasSession())) return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  try {
    const { data, error } = await getSupabase().from("user_profiles").select("name, preferences").limit(1);
    if (error) throw error;
    const row = data?.[0];
    return Response.json({
      profile: {
        name: typeof row?.name === "string" ? row.name : "",
        preferences: row?.preferences && typeof row.preferences === "object" && !Array.isArray(row.preferences)
          ? row.preferences
          : {},
      },
    });
  } catch (error) {
    console.error("Nie udało się wczytać profilu:", error);
    return Response.json({ error: "Nie udało się wczytać profilu." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await hasSession())) return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  const input: unknown = await request.json().catch(() => null);
  if (!validProfile(input) || (input.name !== null && input.name.length > 100)) {
    return Response.json({ error: "Profil ma nieprawidłowy format." }, { status: 400 });
  }
  const profile = {
    name: input.name?.trim() || null,
    preferences: Object.fromEntries(Object.entries(input.preferences)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key && value)),
  };

  try {
    const supabase = getSupabase();
    const { data: rows, error: readError } = await supabase.from("user_profiles").select("name").limit(1);
    if (readError) throw readError;
    if (rows?.length) {
      const { error } = await supabase.from("user_profiles").update(profile);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("user_profiles").insert(profile);
      if (error) throw error;
    }
    return Response.json({ profile });
  } catch (error) {
    console.error("Nie udało się zapisać profilu:", error);
    return Response.json({ error: "Nie udało się zapisać profilu." }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await hasSession())) return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  try {
    const { error } = await getSupabase().from("user_profiles").update({ name: null, preferences: {} });
    if (error) throw error;
    return Response.json({ cleared: true });
  } catch (error) {
    console.error("Nie udało się wyczyścić profilu:", error);
    return Response.json({ error: "Nie udało się wyczyścić profilu." }, { status: 500 });
  }
}

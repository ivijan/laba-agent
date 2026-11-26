import { hasSession } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  if (!(await hasSession())) {
    return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  }

  try {
    const supabase = getSupabase();
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id, title")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!conversation) return Response.json({ conversation: null, messages: [] });

    const { data: rows, error: messagesError } = await supabase
      .from("messages")
      .select("id, role, content")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });

    if (messagesError) throw messagesError;

    return Response.json({
      conversation,
      messages: (rows ?? []).map((row) => ({
        id: String(row.id),
        role: row.role,
        parts: [{ type: "text", text: row.content }],
      })),
    });
  } catch (error) {
    console.error("Nie udało się wczytać rozmowy:", error);
    return Response.json({ error: "Nie udało się wczytać rozmowy z bazy." }, { status: 500 });
  }
}

export async function POST() {
  if (!(await hasSession())) {
    return Response.json({ error: "Brak dostępu. Zaloguj się hasłem." }, { status: 401 });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title: "Nowa rozmowa" })
      .select("id, title")
      .single();

    if (error) throw error;
    return Response.json({ conversation: data });
  } catch (error) {
    console.error("Nie udało się utworzyć rozmowy:", error);
    return Response.json({ error: "Nie udało się utworzyć rozmowy w bazie." }, { status: 500 });
  }
}

import type { UIMessage } from 'ai';

/** Accept only client chat history; server instructions and provider metadata are never trusted. */
export function sanitizeChatMessages(value: unknown): UIMessage[] | null {
  if (!Array.isArray(value)) return null;

  const messages: UIMessage[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      (item.role !== 'user' && item.role !== 'assistant') ||
      !Array.isArray(item.parts)
    ) return null;

    const parts = item.parts.flatMap((part) => {
      if (typeof part !== 'object' || part === null || Array.isArray(part)) return [];
      const candidate = part as Record<string, unknown>;
      return candidate.type === 'text' && typeof candidate.text === 'string'
        ? [{ type: 'text' as const, text: candidate.text }]
        : [];
    });
    messages.push({ id: item.id, role: item.role, parts });
  }

  return messages;
}

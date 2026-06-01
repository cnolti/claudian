export function extractAssistantText(
  message: { type: string; message?: unknown }
): string {
  if (message.type !== 'assistant') {
    return '';
  }

  const payload = message.message;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '';
  }

  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block): block is { type: 'text'; text: string } =>
      !!block &&
      typeof block === 'object' &&
      'type' in block &&
      'text' in block &&
      block.type === 'text' &&
      typeof block.text === 'string'
    )
    .map((block) => block.text)
    .join('');
}

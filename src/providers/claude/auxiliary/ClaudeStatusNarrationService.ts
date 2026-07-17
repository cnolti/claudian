import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { StatusNarrationRequest, StatusNarrationService } from '../../../core/providers/types';
import { runColdStartQuery } from '../runtime/claudeColdStartQuery';

const NARRATION_SYSTEM_PROMPT = `You are the status voice of a personal assistant plugin. While the main assistant works on the user's request, you announce what is happening right now, based on its recent tool activity.

Rules:
- Respond with EXACTLY ONE short sentence (at most ~12 words). Plain text only — no lists, no quotes, no emoji, no markdown.
- Use the same language as the user's message.
- Present tense, first person, as the assistant ("Ich schaue gerade in deinen Kalender …").
- Ground the sentence in the tool activity. Never invent results, findings, or conclusions — you only know what is being looked at, not what was found.
- NEVER claim that something failed, is unreachable, or should be retried. You cannot see outcomes — only which tools are being used. Describe the activity, nothing else.
- If the previous status line still fits, vary the wording instead of repeating it.`;

const MAX_USER_MESSAGE_CHARS = 300;
const MAX_NARRATION_CHARS = 120;

export class ClaudeStatusNarrationService implements StatusNarrationService {
  private plugin: ProviderHost;
  private activeController: AbortController | null = null;

  constructor(plugin: ProviderHost) {
    this.plugin = plugin;
  }

  async narrate(request: StatusNarrationRequest): Promise<string | null> {
    this.activeController?.abort();
    const abortController = new AbortController();
    this.activeController = abortController;

    const userMessage = request.userMessage.length > MAX_USER_MESSAGE_CHARS
      ? `${request.userMessage.slice(0, MAX_USER_MESSAGE_CHARS)}…`
      : request.userMessage;
    const parts = [
      `User's request:\n"""\n${userMessage}\n"""`,
      `Recent tool activity (newest last):\n${request.toolEvents.map(line => `- ${line}`).join('\n')}`,
    ];
    if (request.previousNarration) {
      parts.push(`Previous status line: "${request.previousNarration}"`);
    }
    parts.push('Write the current status line:');

    try {
      const result = await runColdStartQuery({
        plugin: this.plugin,
        systemPrompt: NARRATION_SYSTEM_PROMPT,
        tools: [],
        model: this.resolveModel(),
        thinking: { disabled: true },
        persistSession: false,
        abortController,
      }, parts.join('\n\n'));

      const line = result.text.trim().split('\n')[0]?.trim() ?? '';
      if (!line) return null;
      return line.length > MAX_NARRATION_CHARS
        ? `${line.slice(0, MAX_NARRATION_CHARS - 1)}…`
        : line;
    } catch {
      // Narration is best-effort; a failed status line must never surface as an error.
      return null;
    } finally {
      if (this.activeController === abortController) {
        this.activeController = null;
      }
    }
  }

  cancel(): void {
    this.activeController?.abort();
    this.activeController = null;
  }

  private resolveModel(): string {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const model = typeof settings.statusNarratorModel === 'string'
      ? settings.statusNarratorModel.trim()
      : '';
    return model || 'haiku';
  }
}

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { ProviderId, StatusNarrationService } from '../../../core/providers/types';
import type { FeatureHost } from '../../FeatureHost';

const FIRST_NARRATION_DELAY_MS = 1200;
const MIN_NARRATION_INTERVAL_MS = 8000;
const MAX_TOOL_EVENTS = 12;

/**
 * Fork-only: ephemeral "personal assistant" status line under the streaming
 * message. A cheap model (haiku by default) narrates the live tool activity
 * of the active turn; the line is pure DOM — it never enters ChatState,
 * conversation history, or persistence.
 */
export class StatusNarrator {
  private plugin: FeatureHost;
  private getContentEl: () => HTMLElement | null;
  private service: StatusNarrationService | null = null;
  private lineEl: HTMLElement | null = null;
  private toolEvents: string[] = [];
  private pendingEvents = 0;
  private lastNarration: string | null = null;
  private lastNarrationAt = 0;
  private timer: number | null = null;
  private active = false;
  private userMessage = '';
  private generation = 0;

  constructor(plugin: FeatureHost, getContentEl: () => HTMLElement | null) {
    this.plugin = plugin;
    this.getContentEl = getContentEl;
  }

  beginTurn(userMessage: string, providerId: ProviderId): void {
    this.endTurn();
    if (!this.plugin.settings.statusNarratorEnabled) return;
    try {
      this.service = ProviderRegistry.createStatusNarrationService(
        this.plugin.providerHost,
        providerId,
      );
    } catch {
      this.service = null;
    }
    if (!this.service) return;
    this.active = true;
    this.userMessage = userMessage;
  }

  recordToolEvent(line: string): void {
    if (!this.active || !line) return;
    this.toolEvents.push(line);
    if (this.toolEvents.length > MAX_TOOL_EVENTS) {
      this.toolEvents.shift();
    }
    this.pendingEvents++;
    this.scheduleNarration();
  }

  endTurn(): void {
    this.generation++;
    this.active = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.service?.cancel();
    this.service = null;
    this.lineEl?.remove();
    this.lineEl = null;
    this.toolEvents = [];
    this.pendingEvents = 0;
    this.lastNarration = null;
    this.lastNarrationAt = 0;
    this.userMessage = '';
  }

  private scheduleNarration(): void {
    if (this.timer !== null) return;
    const wait = this.lastNarrationAt === 0
      ? FIRST_NARRATION_DELAY_MS
      : Math.max(0, MIN_NARRATION_INTERVAL_MS - (Date.now() - this.lastNarrationAt));
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.runNarration();
    }, wait);
  }

  private async runNarration(): Promise<void> {
    if (!this.active || !this.service || this.pendingEvents === 0) return;
    const generation = this.generation;
    this.pendingEvents = 0;
    // Stamp before the request so the throttle window covers request latency.
    this.lastNarrationAt = Date.now();

    const text = await this.service.narrate({
      userMessage: this.userMessage,
      toolEvents: [...this.toolEvents],
      previousNarration: this.lastNarration,
    });

    if (!this.active || generation !== this.generation) return;
    if (text) {
      this.lastNarration = text;
      this.render(text);
    }
    if (this.pendingEvents > 0) {
      this.scheduleNarration();
    }
  }

  private render(text: string): void {
    const contentEl = this.getContentEl();
    if (!contentEl) return;
    if (!this.lineEl) {
      this.lineEl = contentEl.ownerDocument.createElement('div');
      this.lineEl.className = 'claudian-narrator-line';
    }
    this.lineEl.textContent = text;
    // Re-append so the status line stays below the latest streamed content.
    contentEl.appendChild(this.lineEl);
  }
}

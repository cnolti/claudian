import { setIcon } from 'obsidian';

import type { HeartbeatHost, HeartbeatSummary } from '../../../core/types';

const STATUS_CLASSES = {
  running: 'claudian-heartbeat-status--running',
  error: 'claudian-heartbeat-status--error',
  quiet: 'claudian-heartbeat-status--quiet',
} as const;

/**
 * Heartbeat (fork-only): heart button in the input nav row with a status
 * dropup for the background vault daemon.
 */
export class HeartbeatStatusControl {
  private readonly containerEl: HTMLElement;
  private readonly buttonEl: HTMLButtonElement;
  private readonly dropdownEl: HTMLElement;
  private lastSummary: HeartbeatSummary | null = null;
  private unsubscribe: (() => void) | null;
  private disposed = false;

  constructor(parentEl: HTMLElement, private readonly heartbeat: HeartbeatHost) {
    this.containerEl = parentEl.createDiv({
      cls: 'claudian-heartbeat-status-container claudian-nav-dropup-container',
    });
    this.buttonEl = this.containerEl.createEl('button', {
      cls: 'claudian-input-nav-btn claudian-heartbeat-status',
      attr: { type: 'button', 'aria-label': 'Heartbeat status', 'aria-expanded': 'false' },
    });
    setIcon(this.buttonEl, 'heart');
    this.dropdownEl = this.containerEl.createDiv({
      cls: 'claudian-heartbeat-dropdown claudian-nav-dropup-menu',
    });

    this.buttonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.toggleDropdown();
    });

    this.unsubscribe = heartbeat.subscribe(summary => this.applySummary(summary));
    void heartbeat.getSummary().then(summary => this.applySummary(summary)).catch(() => undefined);
  }

  /** Closes the dropup unless the click happened inside this control. */
  handleDocumentClick(target: EventTarget | null): void {
    if (target instanceof Node && this.containerEl.contains(target)) return;
    this.setDropdownVisible(false);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private applySummary(summary: HeartbeatSummary): void {
    if (this.disposed) return;
    this.lastSummary = summary;
    this.buttonEl.toggleClass(STATUS_CLASSES.running, summary.status === 'running');
    this.buttonEl.toggleClass(STATUS_CLASSES.error, summary.status === 'error');
    this.buttonEl.toggleClass(
      STATUS_CLASSES.quiet,
      summary.status === 'quiet' || summary.status === 'paused' || summary.status === 'disabled',
    );
    if (this.dropdownEl.hasClass('visible')) {
      this.renderDropdown(summary);
    }
  }

  private async toggleDropdown(): Promise<void> {
    if (this.dropdownEl.hasClass('visible')) {
      this.setDropdownVisible(false);
      return;
    }
    const summary = this.lastSummary ?? await this.heartbeat.getSummary();
    if (this.disposed) return;
    this.lastSummary = summary;
    this.renderDropdown(summary);
    this.setDropdownVisible(true);
  }

  private setDropdownVisible(visible: boolean): void {
    this.dropdownEl.toggleClass('visible', visible);
    this.buttonEl.setAttribute('aria-expanded', String(visible));
  }

  private renderDropdown(summary: HeartbeatSummary): void {
    const dropdown = this.dropdownEl;
    dropdown.empty();

    const rows: Array<[string, string]> = [
      ['Status', summary.status],
      ['Last run', summary.lastRun ? new Date(summary.lastRun).toLocaleString() : '—'],
      ['Last mode', summary.lastMode ?? '—'],
      ['Runs (current / total)', `${summary.runCount} / ${summary.totalRuns}`],
      ['Runs to compaction', String(summary.runsToCompaction)],
      ['Next in', summary.nextHeartbeatIn !== null ? `${summary.nextHeartbeatIn} min` : '—'],
    ];
    if (summary.error) rows.push(['Error', summary.error]);

    for (const [label, value] of rows) {
      const row = dropdown.createDiv({ cls: 'claudian-heartbeat-dropdown-row' });
      row.createSpan({ cls: 'claudian-heartbeat-dropdown-row-label', text: label });
      row.createSpan({
        cls: 'claudian-heartbeat-dropdown-row-value',
        text: value,
        attr: { title: value },
      });
    }

    if (summary.lastJournalLines && summary.lastJournalLines.length > 0) {
      dropdown.createEl('hr', { cls: 'claudian-heartbeat-dropdown-separator' });
      dropdown.createDiv({ cls: 'claudian-heartbeat-dropdown-journal-title', text: 'Recent journal' });
      dropdown.createDiv({
        cls: 'claudian-heartbeat-dropdown-journal',
        text: summary.lastJournalLines.join('\n'),
      });
    }
  }
}

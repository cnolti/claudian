import * as fs from 'fs/promises';
import * as path from 'path';

import type {
  ClaudianSettings,
  HeartbeatHost,
  HeartbeatQueryResult,
  HeartbeatQueryRunner,
  HeartbeatStatus,
  HeartbeatStatusListener,
  HeartbeatSummary,
} from '../../core/types';
import { loadConfig } from './HeartbeatConfig';
import { HeartbeatPromptBuilder } from './HeartbeatPromptBuilder';
import type { HeartbeatState } from './types';

const DAEMON_DIR = '.agentfiles/daemon';
const STARTUP_DELAY_MS = 30_000;
const DEFAULT_COMPACTION_THRESHOLD = 30;

export interface HeartbeatManagerHost {
  getSettings(): ClaudianSettings;
  getVaultPath(): string | null;
  isAnyTabStreaming(): boolean;
  runQuery: HeartbeatQueryRunner;
  now?: () => Date;
}

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseTimeToMinutes(timeStr: string, fallback: number): number {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

export class HeartbeatManager implements HeartbeatHost {
  private intervalId: number | null = null;
  private initialTimeoutId: number | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private lastError: string | null = null;
  private lastTickTime: number | null = null;
  private readonly listeners = new Set<HeartbeatStatusListener>();

  constructor(private readonly host: HeartbeatManagerHost) {}

  private get settings(): ClaudianSettings {
    return this.host.getSettings();
  }

  private now(): Date {
    return this.host.now?.() ?? new Date();
  }

  start(): void {
    if (this.intervalId !== null) return;
    if (!this.settings.heartbeatEnabled) return;

    const intervalMs = this.settings.heartbeatIntervalMinutes * 60 * 1000;
    this.intervalId = window.setInterval(() => void this.tick(), intervalMs);

    // Let Obsidian finish starting before the first beat.
    this.initialTimeoutId = window.setTimeout(() => {
      this.initialTimeoutId = null;
      void this.tick();
    }, STARTUP_DELAY_MS);

    this.notifyStatusChange();
  }

  stop(): void {
    if (this.initialTimeoutId !== null) {
      window.clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.abort();
    this.notifyStatusChange();
  }

  restart(): void {
    this.stop();
    this.start();
  }

  destroy(): void {
    this.listeners.clear();
    this.stop();
  }

  subscribe(listener: HeartbeatStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): HeartbeatStatus {
    if (!this.settings.heartbeatEnabled) return 'disabled';
    if (this.lastError) return 'error';
    if (this.isRunning) return 'running';
    if (this.isQuietHours()) return 'quiet';
    if (this.settings.heartbeatPauseOnStreaming && this.host.isAnyTabStreaming()) return 'paused';
    return 'idle';
  }

  async getSummary(): Promise<HeartbeatSummary> {
    const vaultPath = this.host.getVaultPath();
    const state = vaultPath ? await this.readState(vaultPath) : this.defaultState();

    let nextHeartbeatIn: number | null = null;
    if (this.intervalId !== null && this.lastTickTime !== null) {
      const intervalMs = this.settings.heartbeatIntervalMinutes * 60 * 1000;
      const elapsed = this.now().getTime() - this.lastTickTime;
      nextHeartbeatIn = Math.max(0, Math.round((intervalMs - elapsed) / 60000));
    }

    return {
      status: this.getStatus(),
      lastRun: state.last_run,
      lastMode: state.last_mode,
      runCount: state.run_count,
      totalRuns: state.total_runs,
      runsToCompaction: DEFAULT_COMPACTION_THRESHOLD - state.run_count,
      nextHeartbeatIn,
      error: this.lastError,
      lastJournalLines: vaultPath ? await this.getLatestJournalLines(vaultPath) : null,
    };
  }

  private async tick(): Promise<void> {
    if (this.isRunning) return;

    if (
      this.isQuietHours()
      || (this.settings.heartbeatPauseOnStreaming && this.host.isAnyTabStreaming())
    ) {
      this.notifyStatusChange();
      return;
    }

    this.isRunning = true;
    this.lastError = null;
    this.lastTickTime = this.now().getTime();
    this.notifyStatusChange();

    try {
      await this.executeHeartbeat();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      this.isRunning = false;
      this.notifyStatusChange();
    }
  }

  private abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private async executeHeartbeat(): Promise<void> {
    const vaultPath = this.host.getVaultPath();
    if (!vaultPath) {
      this.lastError = 'Could not determine vault path';
      return;
    }

    const state = await this.readState(vaultPath);
    const config = await loadConfig(vaultPath);
    const needsCompaction = state.run_count >= config.compaction_threshold;
    const mode = this.getCurrentMode();

    const prompt = HeartbeatPromptBuilder.build({
      state,
      mode,
      needsCompaction,
      compactionThreshold: config.compaction_threshold,
      now: this.now(),
    });

    const resumeSessionId = state.session_id && state.recommend_resume && !needsCompaction
      ? state.session_id
      : null;

    const abortController = new AbortController();
    this.abortController = abortController;
    let result: HeartbeatQueryResult;
    try {
      result = await this.host.runQuery({
        cwd: vaultPath,
        prompt,
        model: this.settings.heartbeatModel,
        maxTurns: this.settings.heartbeatMaxTurns,
        resumeSessionId,
        signal: abortController.signal,
      });
    } finally {
      if (this.abortController === abortController) this.abortController = null;
    }

    // stop()/unload aborted this beat: leave the daemon state untouched.
    if (abortController.signal.aborted) return;
    if (!result.success) this.lastError = result.error ?? 'Heartbeat query failed';

    await this.updateState(vaultPath, state, result, mode, needsCompaction);
  }

  private async readState(vaultPath: string): Promise<HeartbeatState> {
    const stateFile = path.join(vaultPath, DAEMON_DIR, 'state.json');
    try {
      const content = await fs.readFile(stateFile, 'utf-8');
      return JSON.parse(content) as HeartbeatState;
    } catch {
      return this.defaultState();
    }
  }

  private async updateState(
    vaultPath: string,
    oldState: HeartbeatState,
    result: HeartbeatQueryResult,
    mode: string,
    compacted: boolean,
  ): Promise<void> {
    // Re-read: the daemon agent may have rewritten state.json during the beat.
    const freshState = await this.readState(vaultPath);
    const now = this.now();

    const newState: HeartbeatState = {
      ...freshState,
      session_id: compacted ? null : (result.sessionId || freshState.session_id),
      run_count: compacted ? 0 : freshState.run_count + 1,
      total_runs: freshState.total_runs + 1,
      last_run: now.toISOString(),
      last_mode: mode,
      today: formatLocalDate(now),
    };

    if (compacted) {
      newState.last_compaction = now.toISOString();
      newState.recommend_resume = false;
    }

    if (oldState.today !== newState.today) {
      newState.morning_briefing_sent_today = false;
      newState.evening_summary_sent_today = false;
    }

    const stateFile = path.join(vaultPath, DAEMON_DIR, 'state.json');
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(newState, null, 2));
  }

  private async getLatestJournalLines(vaultPath: string, maxLines = 5): Promise<string[]> {
    const journalDir = path.join(vaultPath, DAEMON_DIR, 'journal');
    try {
      const files = (await fs.readdir(journalDir)).filter(f => f.endsWith('.md')).sort();
      const latest = files.at(-1);
      if (!latest) return [];
      const content = await fs.readFile(path.join(journalDir, latest), 'utf-8');
      return content.split('\n').filter(l => l.trim()).slice(-maxLines);
    } catch {
      return [];
    }
  }

  private isQuietHours(): boolean {
    const now = this.now();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const quietStart = parseTimeToMinutes(this.settings.heartbeatQuietStart, 22 * 60);
    const quietEnd = parseTimeToMinutes(this.settings.heartbeatQuietEnd, 6 * 60);

    if (quietStart > quietEnd) {
      // Window spans midnight (e.g. 22:00 - 06:00).
      return currentMinutes >= quietStart || currentMinutes < quietEnd;
    }
    return currentMinutes >= quietStart && currentMinutes < quietEnd;
  }

  private getCurrentMode(): string {
    const hour = this.now().getHours();
    if (hour >= 22 || hour < 6) return 'sleep';
    if (hour === 6) return 'dawn';
    if (hour >= 18) return 'evening';
    return 'active';
  }

  private defaultState(): HeartbeatState {
    return {
      session_id: null,
      run_count: 0,
      total_runs: 0,
      last_run: null,
      last_compaction: null,
      last_mode: null,
      today: formatLocalDate(this.now()),
      morning_briefing_sent_today: false,
      evening_summary_sent_today: false,
      recommend_resume: false,
      started_at: null,
    };
  }

  private notifyStatusChange(): void {
    if (this.listeners.size === 0) return;
    void this.getSummary().then((summary) => {
      for (const listener of this.listeners) listener(summary);
    }).catch(() => undefined);
  }
}

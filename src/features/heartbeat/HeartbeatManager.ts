import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { query as agentQuery } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs/promises';
import * as path from 'path';

import { createCustomSpawnFunction } from '../../core/agent/customSpawn';
import type ClaudianPlugin from '../../main';
import { getEnhancedPath, getMissingNodeError, parseEnvironmentVariables } from '../../utils/env';
import { getVaultPath } from '../../utils/path';
import { loadConfig } from './HeartbeatConfig';
import { HeartbeatPromptBuilder } from './HeartbeatPromptBuilder';
import type { HeartbeatState, HeartbeatStatus, HeartbeatSummary } from './types';

export class HeartbeatManager {
  private plugin: ClaudianPlugin;
  private intervalId: number | null = null;
  private initialTimeoutId: number | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private lastError: string | null = null;
  private lastTickTime: number | null = null;
  private cachedJournalLines: string[] | null = null;

  onStatusChange?: (summary: HeartbeatSummary) => void;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  start(): void {
    if (this.intervalId) return;
    if (!this.plugin.settings.heartbeatEnabled) return;

    const intervalMs = this.plugin.settings.heartbeatIntervalMinutes * 60 * 1000;
    this.intervalId = window.setInterval(() => this.tick(), intervalMs);

    // First heartbeat after short delay (let Obsidian finish starting)
    this.initialTimeoutId = window.setTimeout(() => {
      this.initialTimeoutId = null;
      this.tick();
    }, 30_000);

    this.notifyStatusChange();
  }

  stop(): void {
    if (this.initialTimeoutId) {
      window.clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.abort();
    this.notifyStatusChange();
  }

  destroy(): void {
    this.stop();
    this.onStatusChange = undefined;
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  restart(): void {
    this.stop();
    this.start();
  }

  getStatus(): HeartbeatStatus {
    if (!this.plugin.settings.heartbeatEnabled) return 'disabled';
    if (this.lastError) return 'error';
    if (this.isRunning) return 'running';
    if (this.isQuietHours()) return 'quiet';
    if (this.plugin.settings.heartbeatPauseOnStreaming && this.isUserStreaming()) return 'paused';
    return 'idle';
  }

  async getSummary(): Promise<HeartbeatSummary> {
    const vaultPath = getVaultPath(this.plugin.app);
    const state = vaultPath ? await this.readState(vaultPath) : this.defaultState();
    const compactionThreshold = 30;

    let nextHeartbeatIn: number | null = null;
    if (this.intervalId && this.lastTickTime) {
      const intervalMs = this.plugin.settings.heartbeatIntervalMinutes * 60 * 1000;
      const elapsed = Date.now() - this.lastTickTime;
      nextHeartbeatIn = Math.max(0, Math.round((intervalMs - elapsed) / 60000));
    }

    // Read journal lines on demand
    if (vaultPath) {
      this.cachedJournalLines = await this.getLatestJournalLines(vaultPath);
    }

    return {
      status: this.getStatus(),
      lastRun: state.last_run,
      lastMode: state.last_mode,
      runCount: state.run_count,
      totalRuns: state.total_runs,
      runsToCompaction: compactionThreshold - state.run_count,
      nextHeartbeatIn,
      error: this.lastError,
      lastJournalLines: this.cachedJournalLines,
    };
  }

  private async tick(): Promise<void> {
    if (this.isRunning) return;

    if (this.isQuietHours()) {
      this.notifyStatusChange();
      return;
    }

    if (this.plugin.settings.heartbeatPauseOnStreaming && this.isUserStreaming()) {
      this.notifyStatusChange();
      return;
    }

    this.isRunning = true;
    this.lastError = null;
    this.lastTickTime = Date.now();
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

  private async executeHeartbeat(): Promise<void> {
    const vaultPath = getVaultPath(this.plugin.app);
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
      timestamp: new Date().toISOString(),
    });

    let sessionId: string | null = null;
    if (state.session_id && state.recommend_resume && !needsCompaction) {
      sessionId = state.session_id;
    }

    this.abortController = new AbortController();
    const result = await this.runQuery(vaultPath, prompt, sessionId);

    // Read journal lines after heartbeat completes
    this.cachedJournalLines = await this.getLatestJournalLines(vaultPath);

    await this.updateState(vaultPath, state, result, mode, needsCompaction);
  }

  private async runQuery(
    vaultPath: string,
    prompt: string,
    sessionId: string | null
  ): Promise<{ sessionId: string | null; success: boolean }> {
    const resolvedClaudePath = this.plugin.getResolvedClaudeCliPath();
    if (!resolvedClaudePath) {
      return { sessionId: null, success: false };
    }

    const customEnv = parseEnvironmentVariables(this.plugin.getActiveEnvironmentVariables());
    const enhancedPath = getEnhancedPath(customEnv.PATH, resolvedClaudePath);
    const missingNodeError = getMissingNodeError(resolvedClaudePath, enhancedPath);
    if (missingNodeError) {
      this.lastError = missingNodeError;
      return { sessionId: null, success: false };
    }

    const options: Options = {
      cwd: vaultPath,
      model: this.plugin.settings.heartbeatModel,
      abortController: this.abortController!,
      pathToClaudeCodeExecutable: resolvedClaudePath,
      maxTurns: this.plugin.settings.heartbeatMaxTurns,
      env: {
        ...process.env,
        ...customEnv,
        PATH: enhancedPath,
      },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: this.plugin.settings.loadUserClaudeSettings
        ? ['user', 'project']
        : ['project'],
      spawnClaudeCodeProcess: createCustomSpawnFunction(enhancedPath),
    };

    // Add MCP servers (calendar, paperless, whatsapp, etc.)
    const mcpServers = this.plugin.mcpManager.getActiveServers(new Set());
    if (Object.keys(mcpServers).length > 0) {
      options.mcpServers = mcpServers;
    }

    if (sessionId) {
      options.resume = sessionId;
    }

    let newSessionId: string | null = null;

    try {
      const response = agentQuery({ prompt, options });
      for await (const message of response) {
        if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
          newSessionId = message.session_id;
        }
      }
      return { sessionId: newSessionId, success: true };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Query failed';
      return { sessionId: null, success: false };
    }
  }

  private async readState(vaultPath: string): Promise<HeartbeatState> {
    const stateFile = path.join(vaultPath, '.agentfiles/daemon/state.json');
    try {
      const content = await fs.readFile(stateFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return this.defaultState();
    }
  }

  private async updateState(
    vaultPath: string,
    oldState: HeartbeatState,
    result: { sessionId: string | null; success: boolean },
    mode: string,
    compacted: boolean
  ): Promise<void> {
    // Re-read state (daemon may have modified it during the heartbeat)
    const freshState = await this.readState(vaultPath);

    const newState: HeartbeatState = {
      ...freshState,
      session_id: compacted ? null : (result.sessionId || freshState.session_id),
      run_count: compacted ? 0 : freshState.run_count + 1,
      total_runs: freshState.total_runs + 1,
      last_run: new Date().toISOString(),
      last_mode: mode,
      today: new Date().toISOString().split('T')[0],
    };

    if (compacted) {
      newState.last_compaction = new Date().toISOString();
      newState.recommend_resume = false;
    }

    // Day change: reset daily flags
    if (oldState.today !== newState.today) {
      newState.morning_briefing_sent_today = false;
      newState.evening_summary_sent_today = false;
    }

    const stateFile = path.join(vaultPath, '.agentfiles/daemon/state.json');
    const stateDir = path.dirname(stateFile);
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(newState, null, 2));
  }

  private async getLatestJournalLines(vaultPath: string, maxLines = 5): Promise<string[]> {
    const journalDir = path.join(vaultPath, '.agentfiles/daemon/journal');
    try {
      const files = await fs.readdir(journalDir);
      if (files.length === 0) return [];

      // Sort descending to get newest first
      const sorted = files.filter(f => f.endsWith('.md')).sort().reverse();
      if (sorted.length === 0) return [];

      const latestFile = path.join(journalDir, sorted[0]);
      const content = await fs.readFile(latestFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      // Return last N non-empty lines
      return lines.slice(-maxLines);
    } catch {
      return [];
    }
  }

  private isQuietHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentMinutes = hour * 60 + minute;

    const quietStart = this.parseTimeToMinutes(this.plugin.settings.heartbeatQuietStart, 22 * 60);
    const quietEnd = this.parseTimeToMinutes(this.plugin.settings.heartbeatQuietEnd, 6 * 60);

    if (quietStart > quietEnd) {
      // Over midnight (e.g. 22:00 - 06:00)
      return currentMinutes >= quietStart || currentMinutes < quietEnd;
    }
    return currentMinutes >= quietStart && currentMinutes < quietEnd;
  }

  private parseTimeToMinutes(timeStr: string, fallback: number): number {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return fallback;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }

  private isUserStreaming(): boolean {
    for (const view of this.plugin.getAllViews()) {
      const tabManager = view.getTabManager();
      if (tabManager) {
        for (const tab of tabManager.getAllTabs()) {
          if (tab.state?.isStreaming) return true;
        }
      }
    }
    return false;
  }

  private getCurrentMode(): string {
    const hour = new Date().getHours();
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
      today: new Date().toISOString().split('T')[0],
      morning_briefing_sent_today: false,
      evening_summary_sent_today: false,
      recommend_resume: false,
      started_at: null,
    };
  }

  private notifyStatusChange(): void {
    if (this.onStatusChange) {
      // Fire-and-forget async summary
      this.getSummary().then(summary => {
        this.onStatusChange?.(summary);
      });
    }
  }
}

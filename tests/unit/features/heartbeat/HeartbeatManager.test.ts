import * as fs from 'fs/promises';

import { HeartbeatManager } from '../../../../src/features/heartbeat/HeartbeatManager';
import type { HeartbeatState } from '../../../../src/features/heartbeat/types';

// Mock window for Node test environment
const mockWindow = {
  setInterval: jest.fn((fn: () => void, ms: number) => setInterval(fn, ms)),
  clearInterval: jest.fn((id: number) => clearInterval(id)),
  setTimeout: jest.fn((fn: () => void, ms: number) => setTimeout(fn, ms)),
  clearTimeout: jest.fn((id: number) => clearTimeout(id)),
};
(global as any).window = mockWindow;

// Mock dependencies
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));
jest.mock('fs/promises');
jest.mock('../../../../src/core/agent/customSpawn', () => ({
  createCustomSpawnFunction: jest.fn(() => jest.fn()),
}));
jest.mock('../../../../src/utils/env', () => ({
  getEnhancedPath: jest.fn(() => '/usr/bin'),
  parseEnvironmentVariables: jest.fn(() => ({})),
  getMissingNodeError: jest.fn(() => null),
}));
jest.mock('../../../../src/utils/path', () => ({
  getVaultPath: jest.fn(() => '/vault'),
}));

function makePlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {
      heartbeatEnabled: true,
      heartbeatIntervalMinutes: 30,
      heartbeatMaxTurns: 25,
      heartbeatModel: 'sonnet',
      heartbeatQuietStart: '22:00',
      heartbeatQuietEnd: '06:00',
      heartbeatPauseOnStreaming: true,
      loadUserClaudeSettings: false,
      ...overrides,
    },
    app: { vault: { adapter: { basePath: '/vault' } } },
    mcpManager: { getActiveServers: jest.fn(() => ({})) },
    getAllViews: jest.fn(() => []),
    getResolvedClaudeCliPath: jest.fn(() => '/usr/local/bin/claude'),
    getActiveEnvironmentVariables: jest.fn(() => ''),
    saveSettings: jest.fn(),
  };
}

describe('HeartbeatManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('should not start if heartbeat is disabled', () => {
      const plugin = makePlugin({ heartbeatEnabled: false });
      const manager = new HeartbeatManager(plugin);

      manager.start();

      expect(manager.getStatus()).toBe('disabled');
    });

    it('should report idle status when started and enabled', () => {
      const plugin = makePlugin();
      const manager = new HeartbeatManager(plugin);

      // Mock: not quiet hours (default test assumes daytime)
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12);

      manager.start();

      expect(manager.getStatus()).toBe('idle');
      manager.destroy();
    });

    it('should stop cleanly', () => {
      const plugin = makePlugin();
      const manager = new HeartbeatManager(plugin);

      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12);

      manager.start();
      manager.stop();

      // Should still be enabled in settings but timer is stopped
      expect(plugin.settings.heartbeatEnabled).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return disabled when heartbeat is off', () => {
      const plugin = makePlugin({ heartbeatEnabled: false });
      const manager = new HeartbeatManager(plugin);
      expect(manager.getStatus()).toBe('disabled');
    });

    it('should return quiet during quiet hours', () => {
      const plugin = makePlugin();
      const manager = new HeartbeatManager(plugin);

      // Mock 23:00 (within 22:00-06:00 quiet window)
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(23);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      expect(manager.getStatus()).toBe('quiet');
    });

    it('should return paused when user is streaming', () => {
      const mockTab = { state: { isStreaming: true } };
      const mockTabManager = { getAllTabs: () => [mockTab] };
      const mockView = { getTabManager: () => mockTabManager };

      const plugin = makePlugin();
      plugin.getAllViews = jest.fn(() => [mockView]);

      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      const manager = new HeartbeatManager(plugin);
      expect(manager.getStatus()).toBe('paused');
    });
  });

  describe('getSummary', () => {
    it('should return default summary when no state exists', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      (fs.readdir as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const plugin = makePlugin({ heartbeatEnabled: false });
      const manager = new HeartbeatManager(plugin);

      const summary = await manager.getSummary();

      expect(summary.status).toBe('disabled');
      expect(summary.lastRun).toBeNull();
      expect(summary.runCount).toBe(0);
      expect(summary.totalRuns).toBe(0);
    });

    it('should parse state.json correctly', async () => {
      const state: HeartbeatState = {
        session_id: 'abc123',
        run_count: 7,
        total_runs: 42,
        last_run: '2026-02-25T14:32:00.000Z',
        last_compaction: null,
        last_mode: 'active',
        today: '2026-02-25',
        morning_briefing_sent_today: true,
        evening_summary_sent_today: false,
        recommend_resume: true,
        started_at: '2026-02-25T06:00:00.000Z',
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(state));
      (fs.readdir as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(12);
      jest.spyOn(Date.prototype, 'getMinutes').mockReturnValue(0);

      const plugin = makePlugin();
      const manager = new HeartbeatManager(plugin);

      const summary = await manager.getSummary();

      expect(summary.runCount).toBe(7);
      expect(summary.totalRuns).toBe(42);
      expect(summary.lastRun).toBe('2026-02-25T14:32:00.000Z');
      expect(summary.lastMode).toBe('active');
    });
  });
});

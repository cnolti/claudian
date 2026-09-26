import * as nodeTimers from 'node:timers';

import { testDate } from '@test/helpers/testClock';
import * as fs from 'fs/promises';

import { HeartbeatManager } from '@/app/heartbeat/HeartbeatManager';
import type { HeartbeatState } from '@/app/heartbeat/types';
import type {
  ClaudianSettings,
  HeartbeatQueryRequest,
  HeartbeatQueryResult,
  HeartbeatSummary,
} from '@/core/types';

jest.mock('fs/promises');

const mockFs = fs as jest.Mocked<typeof fs>;
const STATE_FILE = '/vault/.agentfiles/daemon/state.json';
const STARTUP_DELAY_MS = 30_000;

if (typeof window === 'undefined') {
  Object.assign(globalThis, { window: globalThis });
}

function atLocalTime(hours: number, minutes = 0): Date {
  const date = testDate();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function makeState(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return {
    session_id: null,
    run_count: 3,
    total_runs: 40,
    last_run: null,
    last_compaction: null,
    last_mode: 'active',
    today: 'stale-day',
    morning_briefing_sent_today: true,
    evening_summary_sent_today: false,
    recommend_resume: false,
    started_at: null,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<ClaudianSettings> = {}): ClaudianSettings {
  return {
    heartbeatEnabled: true,
    heartbeatIntervalMinutes: 30,
    heartbeatMaxTurns: 25,
    heartbeatModel: 'sonnet',
    heartbeatQuietStart: '22:00',
    heartbeatQuietEnd: '06:00',
    heartbeatPauseOnStreaming: true,
    ...overrides,
  } as ClaudianSettings;
}

interface Harness {
  manager: HeartbeatManager;
  settings: ClaudianSettings;
  runQuery: jest.Mock<Promise<HeartbeatQueryResult>, [HeartbeatQueryRequest]>;
  setStreaming(value: boolean): void;
  writtenState(): HeartbeatState | null;
}

function createHarness(options: {
  now?: Date;
  settings?: Partial<ClaudianSettings>;
  state?: HeartbeatState | null;
  result?: HeartbeatQueryResult;
} = {}): Harness {
  const settings = makeSettings(options.settings);
  let streaming = false;
  let storedState = options.state === undefined ? makeState() : options.state;
  let lastWrite: HeartbeatState | null = null;

  mockFs.readFile.mockImplementation(async (file) => {
    if (file === STATE_FILE && storedState) return JSON.stringify(storedState);
    throw new Error('ENOENT');
  });
  mockFs.readdir.mockRejectedValue(new Error('ENOENT'));
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.writeFile.mockImplementation(async (file, data) => {
    if (file === STATE_FILE) {
      lastWrite = JSON.parse(String(data)) as HeartbeatState;
      storedState = lastWrite;
    }
  });

  const runQuery = jest.fn<Promise<HeartbeatQueryResult>, [HeartbeatQueryRequest]>()
    .mockResolvedValue(options.result ?? { sessionId: 'new-session', success: true, error: null });
  const now = options.now ?? atLocalTime(12);
  const manager = new HeartbeatManager({
    getSettings: () => settings,
    getVaultPath: () => '/vault',
    isAnyTabStreaming: () => streaming,
    runQuery,
    now: () => now,
  });

  return {
    manager,
    settings,
    runQuery,
    setStreaming: (value) => { streaming = value; },
    writtenState: () => lastWrite,
  };
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    // node:timers keeps the real setImmediate while Jest fakes the globals.
    await new Promise<void>(resolve => nodeTimers.setImmediate(resolve));
  }
}

async function runFirstBeat(harness: Harness): Promise<void> {
  harness.manager.start();
  await jest.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
  await flushAsyncWork();
}

describe('HeartbeatManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stays disabled and never beats when the setting is off', async () => {
    const harness = createHarness({ settings: { heartbeatEnabled: false } });

    await runFirstBeat(harness);

    expect(harness.manager.getStatus()).toBe('disabled');
    expect(harness.runQuery).not.toHaveBeenCalled();
  });

  it('reports quiet hours across midnight and paused while a tab streams', () => {
    expect(createHarness({ now: atLocalTime(23) }).manager.getStatus()).toBe('quiet');
    expect(createHarness({ now: atLocalTime(5, 59) }).manager.getStatus()).toBe('quiet');

    const harness = createHarness({ now: atLocalTime(12) });
    expect(harness.manager.getStatus()).toBe('idle');
    harness.setStreaming(true);
    expect(harness.manager.getStatus()).toBe('paused');
  });

  it('skips beats during quiet hours', async () => {
    const harness = createHarness({ now: atLocalTime(23) });

    await runFirstBeat(harness);

    expect(harness.runQuery).not.toHaveBeenCalled();
    harness.manager.destroy();
  });

  it('runs a beat and advances the daemon state', async () => {
    const harness = createHarness();

    await runFirstBeat(harness);

    expect(harness.runQuery).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/vault',
      model: 'sonnet',
      maxTurns: 25,
      resumeSessionId: null,
    }));
    expect(harness.runQuery.mock.calls[0][0].prompt).toContain('Modus: active');
    expect(harness.writtenState()).toEqual(expect.objectContaining({
      session_id: 'new-session',
      run_count: 4,
      total_runs: 41,
      last_mode: 'active',
      morning_briefing_sent_today: false,
    }));
    expect(harness.manager.getStatus()).toBe('idle');
    harness.manager.destroy();
  });

  it('resumes the recommended session and resets it on compaction', async () => {
    const resuming = createHarness({ state: makeState({ session_id: 'old', recommend_resume: true }) });
    await runFirstBeat(resuming);
    expect(resuming.runQuery.mock.calls[0][0].resumeSessionId).toBe('old');
    resuming.manager.destroy();

    const compacting = createHarness({
      state: makeState({ session_id: 'old', recommend_resume: true, run_count: 30 }),
    });
    await runFirstBeat(compacting);
    expect(compacting.runQuery.mock.calls[0][0].resumeSessionId).toBeNull();
    expect(compacting.writtenState()).toEqual(expect.objectContaining({
      session_id: null,
      run_count: 0,
      recommend_resume: false,
    }));
    compacting.manager.destroy();
  });

  it('surfaces failed beats as an error status', async () => {
    const harness = createHarness({
      result: { sessionId: null, success: false, error: 'error_max_turns' },
    });

    await runFirstBeat(harness);

    expect(harness.manager.getStatus()).toBe('error');
    await expect(harness.manager.getSummary()).resolves.toEqual(expect.objectContaining({
      status: 'error',
      error: 'error_max_turns',
    }));
    harness.manager.destroy();
  });

  it('aborts a running beat on stop without touching the daemon state', async () => {
    const harness = createHarness();
    let seenSignal: AbortSignal | null = null;
    harness.runQuery.mockImplementation(request => new Promise((resolve) => {
      seenSignal = request.signal;
      request.signal.addEventListener('abort', () => resolve({
        sessionId: null,
        success: false,
        error: 'aborted',
      }));
    }));

    await runFirstBeat(harness);
    expect(harness.manager.getStatus()).toBe('running');
    harness.manager.stop();
    await flushAsyncWork();

    expect(seenSignal!.aborted).toBe(true);
    expect(harness.writtenState()).toBeNull();
    expect(harness.manager.getStatus()).toBe('idle');
  });

  it('notifies every subscriber until it unsubscribes', async () => {
    const harness = createHarness();
    const first = jest.fn<void, [HeartbeatSummary]>();
    const second = jest.fn<void, [HeartbeatSummary]>();
    const unsubscribeFirst = harness.manager.subscribe(first);
    harness.manager.subscribe(second);

    harness.manager.start();
    await flushAsyncWork();
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle', runCount: 3 }));
    expect(second).toHaveBeenCalled();

    unsubscribeFirst();
    first.mockClear();
    harness.manager.stop();
    await flushAsyncWork();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
    harness.manager.destroy();
  });
});

import { HeartbeatPromptBuilder } from '../../../../src/features/heartbeat/HeartbeatPromptBuilder';
import type { HeartbeatState } from '../../../../src/features/heartbeat/types';

function makeState(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return {
    session_id: null,
    run_count: 0,
    total_runs: 0,
    last_run: null,
    last_compaction: null,
    last_mode: null,
    today: '2026-02-25',
    morning_briefing_sent_today: false,
    evening_summary_sent_today: false,
    recommend_resume: false,
    started_at: null,
    ...overrides,
  };
}

describe('HeartbeatPromptBuilder', () => {
  it('should build a prompt with mode and run count', () => {
    const result = HeartbeatPromptBuilder.build({
      state: makeState({ run_count: 5, total_runs: 41 }),
      mode: 'active',
      needsCompaction: false,
      compactionThreshold: 30,
      timestamp: '2026-02-25T14:30:00.000Z',
    });

    expect(result).toContain('[DAEMON] Heartbeat @ 2026-02-25T14:30:00.000Z');
    expect(result).toContain('Modus: active');
    expect(result).toContain('Run #6');
    expect(result).toContain('Gesamt: 42');
    expect(result).toContain('Session-Runs bis Compaction: 25');
    expect(result).toContain('daemon.md');
  });

  it('should include compaction notice when needed', () => {
    const result = HeartbeatPromptBuilder.build({
      state: makeState({ run_count: 30 }),
      mode: 'active',
      needsCompaction: true,
      compactionThreshold: 30,
      timestamp: '2026-02-25T14:30:00.000Z',
    });

    expect(result).toContain('COMPACTION FAELLIG');
  });

  it('should not include compaction notice when not needed', () => {
    const result = HeartbeatPromptBuilder.build({
      state: makeState({ run_count: 5 }),
      mode: 'active',
      needsCompaction: false,
      compactionThreshold: 30,
      timestamp: '2026-02-25T14:30:00.000Z',
    });

    expect(result).not.toContain('COMPACTION');
  });

  it('should include morning briefing note in dawn mode', () => {
    const result = HeartbeatPromptBuilder.build({
      state: makeState({ morning_briefing_sent_today: false }),
      mode: 'dawn',
      needsCompaction: false,
      compactionThreshold: 30,
      timestamp: '2026-02-25T06:00:00.000Z',
    });

    expect(result).toContain('MORNING BRIEFING');
  });

  it('should not include morning briefing if already sent', () => {
    const result = HeartbeatPromptBuilder.build({
      state: makeState({ morning_briefing_sent_today: true }),
      mode: 'dawn',
      needsCompaction: false,
      compactionThreshold: 30,
      timestamp: '2026-02-25T06:00:00.000Z',
    });

    expect(result).not.toContain('MORNING BRIEFING');
  });

  it('should not include morning briefing in non-dawn modes', () => {
    const result = HeartbeatPromptBuilder.build({
      state: makeState({ morning_briefing_sent_today: false }),
      mode: 'active',
      needsCompaction: false,
      compactionThreshold: 30,
      timestamp: '2026-02-25T10:00:00.000Z',
    });

    expect(result).not.toContain('MORNING BRIEFING');
  });
});

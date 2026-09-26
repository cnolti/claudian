import { testDate } from '@test/helpers/testClock';

import { HeartbeatPromptBuilder } from '@/app/heartbeat/HeartbeatPromptBuilder';
import type { HeartbeatState } from '@/app/heartbeat/types';

const now = testDate();

function makeState(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return {
    session_id: null,
    run_count: 0,
    total_runs: 0,
    last_run: null,
    last_compaction: null,
    last_mode: null,
    today: now.toISOString().slice(0, 10),
    morning_briefing_sent_today: false,
    evening_summary_sent_today: false,
    recommend_resume: false,
    started_at: null,
    ...overrides,
  };
}

function build(overrides: {
  state?: Partial<HeartbeatState>;
  mode?: string;
  needsCompaction?: boolean;
} = {}): string {
  return HeartbeatPromptBuilder.build({
    state: makeState(overrides.state),
    mode: overrides.mode ?? 'active',
    needsCompaction: overrides.needsCompaction ?? false,
    compactionThreshold: 30,
    now,
  });
}

describe('HeartbeatPromptBuilder', () => {
  it('builds a prompt with timestamp, mode, and run counters', () => {
    const result = build({ state: { run_count: 5, total_runs: 41 } });

    expect(result).toContain(`[DAEMON] Heartbeat @ ${now.toISOString()}`);
    expect(result).toContain('Modus: active');
    expect(result).toContain('Run #6');
    expect(result).toContain('Gesamt: 42');
    expect(result).toContain('Session-Runs bis Compaction: 25');
    expect(result).toContain('daemon.md');
  });

  it('includes the compaction notice only when compaction is due', () => {
    expect(build({ state: { run_count: 30 }, needsCompaction: true })).toContain('COMPACTION FAELLIG');
    expect(build({ state: { run_count: 5 } })).not.toContain('COMPACTION');
  });

  it('asks for the morning briefing only at dawn while it is still unsent', () => {
    expect(build({ mode: 'dawn' })).toContain('MORNING BRIEFING');
    expect(build({ mode: 'dawn', state: { morning_briefing_sent_today: true } }))
      .not.toContain('MORNING BRIEFING');
    expect(build({ mode: 'active' })).not.toContain('MORNING BRIEFING');
  });
});

export interface HeartbeatState {
  session_id: string | null;
  run_count: number;
  total_runs: number;
  last_run: string | null;
  last_compaction: string | null;
  last_mode: string | null;
  today: string;
  morning_briefing_sent_today: boolean;
  evening_summary_sent_today: boolean;
  recommend_resume: boolean;
  started_at: string | null;
}

export interface DaemonConfig {
  compaction_threshold: number;
}

export type HeartbeatStatus = 'idle' | 'running' | 'quiet' | 'paused' | 'error' | 'disabled';

export interface HeartbeatSummary {
  status: HeartbeatStatus;
  lastRun: string | null;
  lastMode: string | null;
  runCount: number;
  totalRuns: number;
  runsToCompaction: number;
  nextHeartbeatIn: number | null;
  error: string | null;
  lastJournalLines: string[] | null;
}

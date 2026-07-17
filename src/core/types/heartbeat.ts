// Heartbeat (fork-only) — provider-neutral contract for the app-owned
// background heartbeat daemon. The implementation lives in src/app/heartbeat/;
// features consume it through FeatureHost.heartbeat.

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

export interface HeartbeatHost {
  onStatusChange?: (summary: HeartbeatSummary) => void;
  start(): void;
  stop(): void;
  restart(): void;
  destroy(): void;
  getSummary(): Promise<HeartbeatSummary>;
}

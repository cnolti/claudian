// Heartbeat (fork-only) — provider-neutral contract for the app-owned
// background heartbeat daemon. Scheduling and daemon state live in
// src/app/heartbeat/; the provider-specific query runner is injected by
// main.ts; features consume the daemon through FeatureHost.heartbeat.

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

export type HeartbeatStatusListener = (summary: HeartbeatSummary) => void;

export interface HeartbeatHost {
  start(): void;
  stop(): void;
  restart(): void;
  destroy(): void;
  getSummary(): Promise<HeartbeatSummary>;
  /** Registers a status listener; returns the matching unsubscribe function. */
  subscribe(listener: HeartbeatStatusListener): () => void;
}

export interface HeartbeatQueryRequest {
  cwd: string;
  prompt: string;
  model: string;
  maxTurns: number;
  resumeSessionId: string | null;
  signal: AbortSignal;
}

export interface HeartbeatQueryResult {
  sessionId: string | null;
  success: boolean;
  error: string | null;
}

/** Runs one heartbeat turn against a provider; resolves instead of throwing. */
export type HeartbeatQueryRunner = (request: HeartbeatQueryRequest) => Promise<HeartbeatQueryResult>;

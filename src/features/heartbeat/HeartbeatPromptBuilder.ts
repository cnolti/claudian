import type { HeartbeatState } from './types';

interface PromptContext {
  state: HeartbeatState;
  mode: string;
  needsCompaction: boolean;
  compactionThreshold: number;
  timestamp: string;
}

export class HeartbeatPromptBuilder {
  static build(ctx: PromptContext): string {
    const runCount = ctx.state.run_count + 1;
    const totalRuns = ctx.state.total_runs + 1;
    const runsToCompaction = ctx.compactionThreshold - ctx.state.run_count;

    const dayOfWeek = new Date().toLocaleDateString('de-DE', { weekday: 'long' });

    let memoryContext = '';
    if (ctx.needsCompaction) {
      memoryContext = '\nCOMPACTION FAELLIG: Konsolidiere dein Gedaechtnis bevor du andere Aktionen ausfuehrst.';
    }

    let briefingNote = '';
    if (ctx.mode === 'dawn' && !ctx.state.morning_briefing_sent_today) {
      briefingNote = '\nMORNING BRIEFING: Noch nicht gesendet. Kompiliere und sende jetzt.';
    }

    return `[DAEMON] Heartbeat @ ${ctx.timestamp} (${dayOfWeek})

Modus: ${ctx.mode} | Run #${runCount} | Gesamt: ${totalRuns} | Session-Runs bis Compaction: ${runsToCompaction}${memoryContext}${briefingNote}

Lies .claude/agents/daemon.md und fuehre einen Heartbeat-Zyklus aus.
Aktualisiere am Ende .agentfiles/daemon/state.json mit den neuen Werten.`.trim();
  }
}

import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type { HeartbeatQueryRequest, HeartbeatQueryResult } from '../../../core/types';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { loadClaudeAgentQuery } from '../loadClaudeAgentSDK';
import { createCustomSpawnFunction } from '../runtime/customSpawn';
import { getClaudeProviderSettings, resolveClaudeSettingSources } from '../settings';

/**
 * Heartbeat (fork-only): runs one unattended vault-daemon turn through the
 * Claude SDK. MCP servers come from native Claude settings via the setting
 * sources, like every other Claude launch.
 */
export async function runClaudeHeartbeatQuery(
  host: ProviderHost,
  request: HeartbeatQueryRequest,
): Promise<HeartbeatQueryResult> {
  const cliPath = await host.getResolvedProviderCliPath('claude');
  if (!cliPath) {
    return { sessionId: null, success: false, error: 'Claude CLI not found' };
  }

  // Obsidian's cross-realm AbortSignal must not reach Node spawn; bridge it.
  const abortController = new AbortController();
  const onAbort = (): void => abortController.abort();
  if (request.signal.aborted) abortController.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });

  const customEnv = parseEnvironmentVariables(host.getActiveEnvironmentVariables('claude'));
  const enhancedPath = getEnhancedPath(customEnv.PATH, cliPath);
  const claudeSettings = getClaudeProviderSettings(host.settings);

  let sessionId: string | null = null;
  try {
    const agentQuery = await loadClaudeAgentQuery();
    const conversation = agentQuery({
      prompt: request.prompt,
      options: {
        cwd: request.cwd,
        model: request.model,
        maxTurns: request.maxTurns,
        abortController,
        pathToClaudeCodeExecutable: cliPath,
        env: {
          ...process.env,
          ...customEnv,
          PATH: enhancedPath,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: resolveClaudeSettingSources(claudeSettings.loadUserSettings),
        spawnClaudeCodeProcess: createCustomSpawnFunction(enhancedPath),
        ...(request.resumeSessionId ? { resume: request.resumeSessionId } : {}),
      },
    });

    let resultError: string | null = null;
    for await (const message of conversation) {
      if (message.type === 'system' && message.subtype === 'init' && message.session_id) {
        sessionId = message.session_id;
      } else if (message.type === 'result' && message.is_error) {
        // is_error with subtype "success" carries the API error text in `result`.
        resultError = message.subtype === 'success' && message.result
          ? message.result
          : message.subtype;
      }
    }
    return { sessionId, success: resultError === null, error: resultError };
  } catch (err) {
    return {
      sessionId,
      success: false,
      error: err instanceof Error ? err.message : 'Heartbeat query failed',
    };
  } finally {
    request.signal.removeEventListener('abort', onAbort);
  }
}

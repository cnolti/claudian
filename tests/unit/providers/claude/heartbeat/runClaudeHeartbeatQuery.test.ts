import * as sdkModule from '@anthropic-ai/claude-agent-sdk';

import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { HeartbeatQueryRequest } from '@/core/types';
import { runClaudeHeartbeatQuery } from '@/providers/claude/heartbeat/runClaudeHeartbeatQuery';

const sdkMock = sdkModule as unknown as {
  setMockMessages: (messages: any[], options?: { appendResult?: boolean }) => void;
  resetMockMessages: () => void;
  getLastOptions: () => sdkModule.Options | undefined;
};

jest.mock('@/utils/env', () => ({
  parseEnvironmentVariables: jest.fn().mockReturnValue({ PATH: '/usr/bin' }),
  getEnhancedPath: jest.fn().mockReturnValue('/usr/bin:/mock/bin'),
  findNodeExecutable: jest.fn().mockReturnValue('/usr/bin/node'),
}));

function createHost(cliPath: string | null = '/mock/claude'): ProviderHost {
  return {
    app: {},
    settings: { loadUserClaudeSettings: true },
    getResolvedProviderCliPath: jest.fn().mockResolvedValue(cliPath),
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
  } as unknown as ProviderHost;
}

function createRequest(overrides: Partial<HeartbeatQueryRequest> = {}): HeartbeatQueryRequest {
  return {
    cwd: '/vault',
    prompt: '[DAEMON] Heartbeat',
    model: 'sonnet',
    maxTurns: 25,
    resumeSessionId: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('runClaudeHeartbeatQuery', () => {
  beforeEach(() => {
    sdkMock.resetMockMessages();
  });

  it('runs an unattended daemon turn with native Claude settings and returns the session', async () => {
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'beat-session' },
    ]);

    const result = await runClaudeHeartbeatQuery(createHost(), createRequest());

    expect(result).toEqual({ sessionId: 'beat-session', success: true, error: null });
    const options = sdkMock.getLastOptions();
    expect(options).toEqual(expect.objectContaining({
      cwd: '/vault',
      model: 'sonnet',
      maxTurns: 25,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: '/mock/claude',
      settingSources: ['user', 'project', 'local'],
    }));
    expect(options).not.toHaveProperty('resume');
    expect(options).not.toHaveProperty('mcpServers');
  });

  it('resumes the daemon session when requested', async () => {
    sdkMock.setMockMessages([{ type: 'system', subtype: 'init', session_id: 'beat-session' }]);

    await runClaudeHeartbeatQuery(createHost(), createRequest({ resumeSessionId: 'previous' }));

    expect(sdkMock.getLastOptions()?.resume).toBe('previous');
  });

  it('reports error results such as exhausted turns as failures', async () => {
    sdkMock.setMockMessages([
      { type: 'system', subtype: 'init', session_id: 'beat-session' },
      { type: 'result', subtype: 'error_max_turns', is_error: true },
    ]);

    const result = await runClaudeHeartbeatQuery(createHost(), createRequest());

    expect(result).toEqual({ sessionId: 'beat-session', success: false, error: 'error_max_turns' });
  });

  it('surfaces API error text carried by an erroring success result', async () => {
    sdkMock.setMockMessages([
      { type: 'result', subtype: 'success', is_error: true, result: 'API Error: Connection closed' },
    ]);

    const result = await runClaudeHeartbeatQuery(createHost(), createRequest());

    expect(result).toEqual({ sessionId: null, success: false, error: 'API Error: Connection closed' });
  });

  it('fails without launching when no Claude CLI is available', async () => {
    const result = await runClaudeHeartbeatQuery(createHost(null), createRequest());

    expect(result).toEqual({ sessionId: null, success: false, error: 'Claude CLI not found' });
    expect(sdkMock.getLastOptions()).toBeUndefined();
  });

  it('bridges the caller abort signal into a local controller', async () => {
    sdkMock.setMockMessages([{ type: 'system', subtype: 'init', session_id: 'beat-session' }]);
    const caller = new AbortController();

    await runClaudeHeartbeatQuery(createHost(), createRequest({ signal: caller.signal }));
    const bridged = sdkMock.getLastOptions()?.abortController;
    caller.abort();

    expect(bridged).toBeInstanceOf(AbortController);
    expect(bridged?.signal).not.toBe(caller.signal);
    // The listener is detached once the turn settles.
    expect(bridged?.signal.aborted).toBe(false);
  });
});

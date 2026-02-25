import * as fs from 'fs/promises';

import { loadConfig } from '../../../../src/features/heartbeat/HeartbeatConfig';

jest.mock('fs/promises');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('loadConfig', () => {
  it('should return defaults when config file does not exist', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

    const config = await loadConfig('/vault');

    expect(config.compaction_threshold).toBe(30);
  });

  it('should parse compaction_threshold from YAML', async () => {
    mockFs.readFile.mockResolvedValue(`
daemon:
  compaction_threshold: 50
  mode: active
`);

    const config = await loadConfig('/vault');

    expect(config.compaction_threshold).toBe(50);
  });

  it('should return default threshold when not in YAML', async () => {
    mockFs.readFile.mockResolvedValue(`
daemon:
  mode: active
`);

    const config = await loadConfig('/vault');

    expect(config.compaction_threshold).toBe(30);
  });
});

import * as fs from 'fs/promises';
import * as path from 'path';

import type { DaemonConfig } from './types';

const DEFAULT_CONFIG: DaemonConfig = {
  compaction_threshold: 30,
};

export async function loadConfig(vaultPath: string): Promise<DaemonConfig> {
  const configFile = path.join(vaultPath, '.agentfiles/daemon/config.yaml');
  try {
    const content = await fs.readFile(configFile, 'utf-8');
    const threshold = content.match(/compaction_threshold:\s*(\d+)/);
    return {
      compaction_threshold: threshold ? parseInt(threshold[1], 10) : DEFAULT_CONFIG.compaction_threshold,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

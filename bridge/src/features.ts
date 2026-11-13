import { isExecutableOnPath } from './agents.js';
import { exec } from './exec.js';
import type { BridgeFeature } from './protocol.js';

export async function detectFeatures(cwd: string): Promise<BridgeFeature[]> {
  const features: BridgeFeature[] = ['fs-search'];
  const git = await exec('git', ['--version'], { cwd, timeoutMs: 5000 });
  if (git.code === 0) features.push('git');
  if (isExecutableOnPath('lsof') || isExecutableOnPath('ss')) features.push('ports');
  return features;
}

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** An agent declared in the bridge config file. */
export interface ConfigAgentEntry {
  id: string;
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Shape of `~/.gitnotes-bridge/config.json`. */
export interface BridgeConfigFile {
  token?: string;
  agents?: ConfigAgentEntry[];
  roots?: string[];
}

export const DEFAULT_CONFIG_DIR = join(homedir(), '.gitnotes-bridge');
export const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, 'config.json');

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** 32 random bytes, base64url encoded: the shared secret between app and bridge. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function readConfigFile(path: string): Promise<BridgeConfigFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Config file ${path} is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file ${path} must contain a JSON object`);
  }
  return parsed as BridgeConfigFile;
}

/** Writes the config with owner-only permissions; the directory is created 0700. */
export async function writeConfigFile(path: string, config: BridgeConfigFile): Promise<void> {
  const dir = dirname(path);
  let dirExists = true;
  try {
    await stat(dir);
  } catch {
    dirExists = false;
  }
  if (!dirExists) {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    await chmod(dir, DIR_MODE);
  }
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: FILE_MODE });
  await chmod(path, FILE_MODE);
}

import { accessSync, constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import type { AgentInfo } from './protocol.js';
import type { ConfigAgentEntry } from './config.js';

/** A runnable ACP agent: how to launch it and how to tell whether it exists on this host. */
export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Binary that must resolve on PATH for the agent to be usable. */
  probe: string;
}

/**
 * Built-in agents. `probe` is the real tool binary: `npx` is always present, but
 * the package it fetches is only useful when the underlying CLI is installed.
 */
export const AGENT_PRESETS: readonly AgentDefinition[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp'],
    env: {},
    probe: 'claude',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
    env: {},
    probe: 'opencode',
  },
  {
    id: 'pi',
    name: 'Pi',
    command: 'npx',
    args: ['-y', 'pi-acp'],
    env: {},
    probe: 'pi',
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/codex-acp'],
    env: {},
    probe: 'codex',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    env: {},
    probe: 'gemini',
  },
];

/** True when `binary` can be executed, either directly or through PATH. */
export function isExecutableOnPath(binary: string, pathEnv = process.env.PATH ?? ''): boolean {
  if (!binary) return false;
  if (binary.includes('/')) return canExecute(resolve(binary));
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    if (canExecute(join(dir, binary))) return true;
  }
  return false;
}

function canExecute(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Presets plus config entries; a config entry with a preset id overrides that preset. */
export function resolveAgents(overrides: readonly ConfigAgentEntry[] = []): AgentDefinition[] {
  const byId = new Map<string, AgentDefinition>(
    AGENT_PRESETS.map((preset) => [preset.id, { ...preset }]),
  );

  for (const override of overrides) {
    const preset = byId.get(override.id);
    const command = override.command;
    const args = override.args ?? preset?.args ?? [];
    const probe = preset && preset.command === command ? preset.probe : command;
    byId.set(override.id, {
      id: override.id,
      name: override.name ?? preset?.name ?? override.id,
      command,
      args: [...args],
      env: { ...(preset?.env ?? {}), ...(override.env ?? {}) },
      probe,
    });
  }

  return [...byId.values()];
}

export function toAgentInfo(definition: AgentDefinition): AgentInfo {
  return {
    id: definition.id,
    name: definition.name,
    available: isExecutableOnPath(definition.probe),
    command: [definition.command, ...definition.args].join(' '),
  };
}

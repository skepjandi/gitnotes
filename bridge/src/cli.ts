#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { resolveAgents, toAgentInfo } from './agents.js';
import { generateToken, readConfigFile, writeConfigFile } from './config.js';
import {
  buildPairingLink,
  isLoopbackHost,
  parseArgs,
  resolvePublicUrl,
  usage,
} from './options.js';
import type { AgentInfo } from './protocol.js';
import { BridgeServer } from './server.js';

const VERSION = '0.2.0';

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function printBanner(
  secure: boolean,
  address: string,
  port: number,
  publicUrl: string,
  token: string,
  roots: string[],
  agents: AgentInfo[],
): void {
  const scheme = secure ? 'wss' : 'ws';
  console.log(`gitnotes-bridge ${VERSION}`);
  console.log(`  listening  ${scheme}://${address}:${port}`);
  console.log('  roots');
  for (const root of roots) console.log(`    - ${root}`);
  console.log('  agents');
  for (const agent of agents) {
    const mark = agent.available ? '✓' : '✗';
    console.log(`    ${mark} ${agent.id.padEnd(10)} ${agent.name} — ${agent.command}`);
  }
  if (!agents.some((agent) => agent.available)) {
    console.log('    (no agent launcher found on PATH; install one or add it to the config file)');
  }
  console.log('  pairing link');
  console.log(`    ${buildPairingLink(publicUrl, token, hostname())}`);
}

function printRemoteHint(): void {
  console.log('');
  console.log('  The phone cannot reach 127.0.0.1. For remote access pick one:');
  console.log('    tailscale serve --bg <port>   -> pair with the https://<host>.ts.net URL');
  console.log('    cloudflared tunnel --url ws://localhost:<port>');
  console.log('    --host 0.0.0.0                -> pair with ws://<lan-ip>:<port> (see README for the cleartext caveat)');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage(VERSION));
    return;
  }

  const config = await readConfigFile(options.configPath);
  let token = options.token ?? config.token;
  if (!token) {
    token = generateToken();
    await writeConfigFile(options.configPath, { ...config, token });
    console.log(`Generated a new access token and stored it in ${options.configPath}`);
  }

  const configRoots = config.roots ?? [];
  const roots = (
    options.roots.length > 0 ? options.roots : configRoots.length > 0 ? configRoots : [process.cwd()]
  ).map((root) => resolve(root));
  for (const root of roots) {
    if (!(await pathExists(root))) {
      console.warn(`Warning: root ${root} does not exist, it will be ignored.`);
    }
  }

  const agents = resolveAgents(config.agents ?? []);
  const server = new BridgeServer({
    host: options.host,
    port: options.port,
    token,
    roots,
    agents,
    tls:
      options.tlsCert && options.tlsKey ? { cert: options.tlsCert, key: options.tlsKey } : undefined,
    maxConnections: options.maxConnections,
    idleTtlMs: options.idleTtlMinutes * 60_000,
    bridgeVersion: VERSION,
  });

  const { address, port } = await server.listen();
  const publicUrl = resolvePublicUrl(options, port, Boolean(options.tlsCert));
  printBanner(
    Boolean(options.tlsCert),
    address,
    port,
    publicUrl,
    token,
    roots,
    agents.map(toAgentInfo),
  );
  if (isLoopbackHost(new URL(publicUrl).hostname)) printRemoteHint();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, stopping agents and closing the bridge.`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error(`gitnotes-bridge: ${(error as Error).message}`);
  process.exit(1);
});

import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG_PATH } from './config.js';
import { DEFAULT_PORT } from './protocol.js';

export const DEFAULT_MAX_CONNECTIONS = 8;
export const DEFAULT_IDLE_TTL_MINUTES = 720;

export interface CliOptions {
  port: number;
  host: string;
  roots: string[];
  configPath: string;
  publicUrl: string | undefined;
  tlsCert: string | undefined;
  tlsKey: string | undefined;
  token: string | undefined;
  maxConnections: number;
  idleTtlMinutes: number;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    port: DEFAULT_PORT,
    host: '127.0.0.1',
    roots: [],
    configPath: DEFAULT_CONFIG_PATH,
    publicUrl: undefined,
    tlsCert: undefined,
    tlsKey: undefined,
    token: undefined,
    maxConnections: DEFAULT_MAX_CONNECTIONS,
    idleTtlMinutes: DEFAULT_IDLE_TTL_MINUTES,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const separator = argument.indexOf('=');
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);

    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`Missing value for ${flag}`);
      index += 1;
      return next;
    };

    switch (flag) {
      case '--port':
        options.port = Number(takeValue());
        break;
      case '--host':
        options.host = takeValue();
        break;
      case '--root':
        options.roots.push(takeValue());
        break;
      case '--config':
        options.configPath = resolve(takeValue());
        break;
      case '--public-url':
        options.publicUrl = takeValue();
        break;
      case '--tls-cert':
        options.tlsCert = takeValue();
        break;
      case '--tls-key':
        options.tlsKey = takeValue();
        break;
      case '--token':
        options.token = takeValue();
        break;
      case '--max-connections':
        options.maxConnections = Number(takeValue());
        break;
      case '--idle-ttl-min':
        options.idleTtlMinutes = Number(takeValue());
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`Invalid --port: ${options.port}`);
  }
  if (!Number.isInteger(options.maxConnections) || options.maxConnections < 1) {
    throw new Error(`Invalid --max-connections: ${options.maxConnections}`);
  }
  if (!Number.isFinite(options.idleTtlMinutes) || options.idleTtlMinutes <= 0) {
    throw new Error(`Invalid --idle-ttl-min: ${options.idleTtlMinutes}`);
  }
  if ((options.tlsCert && !options.tlsKey) || (!options.tlsCert && options.tlsKey)) {
    throw new Error('--tls-cert and --tls-key must be used together');
  }

  return options;
}

export function usage(version: string): string {
  return `gitnotes-bridge ${version}

Usage: gitnotes-bridge [options]

Options:
  --port <n>              Port to listen on (default ${DEFAULT_PORT})
  --host <addr>           Address to bind (default 127.0.0.1; use 0.0.0.0 for the LAN)
  --root <dir>            Workspace root, repeatable (default: current directory)
  --config <file>         Config file (default ${DEFAULT_CONFIG_PATH})
  --public-url <url>      URL the phone should use (default: derived from host/port)
  --tls-cert <file>       TLS certificate for wss://
  --tls-key <file>        TLS private key for wss://
  --token <token>         Shared secret (default: generated and stored in the config file)
  --max-connections <n>   Concurrent agents (default ${DEFAULT_MAX_CONNECTIONS})
  --idle-ttl-min <n>      Idle minutes before an unattached agent is killed (default ${DEFAULT_IDLE_TTL_MINUTES})
  -h, --help              Show this help
`;
}

/** First non-internal IPv4 address, used when the bridge binds 0.0.0.0. */
export function bestLanAddress(): string | null {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      const family = info.family as string | number;
      if ((family === 'IPv4' || family === 4) && !info.internal) return info.address;
    }
  }
  return null;
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.');
}

function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https:\/\//i, 'wss://');
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:\/\//i, 'ws://');
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  throw new Error(`--public-url must be a ws:// or wss:// URL (got "${raw}")`);
}

export function resolvePublicUrl(options: CliOptions, port: number, secure: boolean): string {
  if (options.publicUrl) return normalizePublicUrl(options.publicUrl);
  const scheme = secure ? 'wss' : 'ws';
  if (isLoopbackHost(options.host)) return `${scheme}://${options.host}:${port}`;
  if (options.host === '0.0.0.0' || options.host === '::') {
    const lan = bestLanAddress();
    if (lan) return `${scheme}://${lan}:${port}`;
  }
  return `${scheme}://${options.host}:${port}`;
}

export function buildPairingLink(publicUrl: string, token: string, name: string): string {
  const params = new URLSearchParams({ url: publicUrl, token, name });
  return `gitnotes://agents/pair?${params.toString()}`;
}

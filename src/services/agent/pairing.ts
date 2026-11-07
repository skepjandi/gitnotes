import { DEFAULT_PORT, PAIRING_LINK_PREFIX } from '../../../bridge/src/protocol';
import type { PairingLink } from './types';

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):\/\//i;
const AUTHORITY_PATTERN = /^(?:\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::\d{1,5})?$/i;
const HAS_PORT_PATTERN = /(?:\]|[^:]):\d+$/;

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseParams(query: string): Map<string, string> | null {
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const separator = pair.indexOf('=');
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? '' : pair.slice(separator + 1);
    const key = safeDecode(rawKey);
    const value = safeDecode(rawValue);
    if (key === null || value === null) return null;
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

/**
 * Accepts `ws(s)://host[:port][/path]` (also `http(s)://`), or a bare `host[:port]`
 * which defaults to `ws://` and the bridge's default port. Query and fragment are dropped.
 * Throws on anything that cannot be a bridge address.
 */
export function normalizeBridgeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Bridge address is empty');

  const schemeMatch = SCHEME_PATTERN.exec(trimmed);
  let scheme = 'ws';
  let rest = trimmed;
  if (schemeMatch) {
    const given = (schemeMatch[1] as string).toLowerCase();
    if (given === 'ws' || given === 'wss') scheme = given;
    else if (given === 'http') scheme = 'ws';
    else if (given === 'https') scheme = 'wss';
    else throw new Error(`Unsupported bridge address scheme: ${given}`);
    rest = trimmed.slice(schemeMatch[0].length);
  }

  const withoutFragment = rest.split('#')[0] as string;
  const withoutQuery = withoutFragment.split('?')[0] as string;
  const slash = withoutQuery.indexOf('/');
  const authority = slash === -1 ? withoutQuery : withoutQuery.slice(0, slash);
  const path = slash === -1 ? '' : withoutQuery.slice(slash).replace(/\/+$/, '');

  if (!AUTHORITY_PATTERN.test(authority)) throw new Error('Bridge address is not a valid host');
  const port = HAS_PORT_PATTERN.exec(authority) ? Number(authority.slice(authority.lastIndexOf(':') + 1)) : null;
  if (port !== null && (port < 1 || port > 65535)) throw new Error('Bridge port is out of range');

  const host = !schemeMatch && port === null ? `${authority}:${DEFAULT_PORT}` : authority;
  return `${scheme}://${host}${path}`;
}

function parseCustomSchemeLink(input: string): PairingLink | null {
  const rest = input.slice(PAIRING_LINK_PREFIX.length);
  const queryStart = rest.indexOf('?');
  if (queryStart === -1) return null;
  const pathPart = rest.slice(0, queryStart);
  if (pathPart !== '' && pathPart !== '/') return null;
  const params = parseParams(rest.slice(queryStart + 1).split('#')[0] as string);
  if (!params) return null;
  return buildLink(params.get('url'), params.get('token'), params.get('name'));
}

function parseBareUrl(input: string): PairingLink | null {
  const hashIndex = input.indexOf('#');
  const beforeHash = hashIndex === -1 ? input : input.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : input.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf('?');
  const base = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const params = parseParams(queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1));
  if (!params) return null;

  let token = params.get('token');
  if (!token && fragment) {
    const fromFragment = safeDecode(fragment.startsWith('token=') ? fragment.slice('token='.length) : fragment);
    if (fromFragment === null) return null;
    token = fromFragment;
  }
  return buildLink(base, token, params.get('name'));
}

function buildLink(
  url: string | undefined,
  token: string | undefined,
  name: string | undefined,
): PairingLink | null {
  if (!url || !token || !token.trim()) return null;
  let normalized: string;
  try {
    normalized = normalizeBridgeUrl(url);
  } catch {
    return null;
  }
  const label = name?.trim();
  return { url: normalized, token: token.trim(), ...(label ? { name: label } : {}) };
}

export function parsePairingLink(input: string): PairingLink | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith(PAIRING_LINK_PREFIX)) return parseCustomSchemeLink(trimmed);
  if (/^wss?:\/\//i.test(trimmed)) return parseBareUrl(trimmed);
  return null;
}

export function buildPairingLink(link: PairingLink): string {
  const parts = [`url=${encodeURIComponent(link.url)}`, `token=${encodeURIComponent(link.token)}`];
  if (link.name) parts.push(`name=${encodeURIComponent(link.name)}`);
  return `${PAIRING_LINK_PREFIX}?${parts.join('&')}`;
}

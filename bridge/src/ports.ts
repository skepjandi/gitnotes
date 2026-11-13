import { exec } from './exec.js';
import type { ListeningPort } from './protocol.js';

/** `pid` plus every descendant, from one `ps` snapshot. */
export async function processTree(pid: number): Promise<Set<number>> {
  const result = await exec('ps', ['-A', '-o', 'pid=,ppid='], { cwd: process.cwd(), timeoutMs: 5000 });
  const children = new Map<number, number[]>();
  for (const line of result.stdout.toString('utf8').split('\n')) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);
    if (child === undefined || parent === undefined || Number.isNaN(child) || Number.isNaN(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const tree = new Set<number>([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift() as number) ?? []) {
      if (!tree.has(child)) {
        tree.add(child);
        queue.push(child);
      }
    }
  }
  return tree;
}

export async function listeningPorts(pids: ReadonlySet<number>): Promise<ListeningPort[]> {
  const cwd = process.cwd();
  const lsof = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], { cwd, timeoutMs: 5000 });
  let found: ListeningPort[];
  if (!lsof.spawnFailed) {
    found = parseLsof(lsof.stdout.toString('utf8'));
  } else {
    const ss = await exec('ss', ['-ltnpH'], { cwd, timeoutMs: 5000 });
    found = parseSs(ss.stdout.toString('utf8'));
  }
  const byPort = new Map<number, ListeningPort>();
  for (const entry of found) {
    if (entry.pid !== undefined && pids.has(entry.pid) && !byPort.has(entry.port)) {
      byPort.set(entry.port, entry);
    }
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function portOf(address: string): number | null {
  const port = Number(address.slice(address.lastIndexOf(':') + 1));
  return Number.isInteger(port) && port > 0 ? port : null;
}

export function parseLsof(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  let pid: number | undefined;
  let name: string | undefined;
  for (const line of output.split('\n')) {
    const value = line.slice(1);
    if (line.startsWith('p')) {
      pid = Number(value);
      name = undefined;
    } else if (line.startsWith('c')) {
      name = value;
    } else if (line.startsWith('n')) {
      const port = portOf(value);
      if (port !== null) ports.push({ port, pid, ...(name ? { process: name } : {}) });
    }
  }
  return ports;
}

export function parseSs(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];
  for (const line of output.split('\n')) {
    const columns = line.trim().split(/\s+/);
    const port = columns[3] ? portOf(columns[3]) : null;
    if (port === null) continue;
    for (const match of line.matchAll(/\("([^"]*)",pid=(\d+)/g)) {
      ports.push({ port, pid: Number(match[2]), process: match[1] });
    }
  }
  return ports;
}

import type { AgentCommand } from '../../models/Chat';

const SLASH_QUERY = /^\/(\S*)$/;
const MAX_SUGGESTIONS = 8;

/** Commands to suggest while the composer holds only a `/query`; empty once a space or other text follows. */
export function matchSlashCommands(text: string, commands: readonly AgentCommand[] | undefined): AgentCommand[] {
  if (!commands || commands.length === 0) return [];
  const match = SLASH_QUERY.exec(text);
  if (!match) return [];
  const query = match[1].toLowerCase();
  const prefix = commands.filter((command) => command.name.toLowerCase().startsWith(query));
  const rest = commands.filter(
    (command) => !prefix.includes(command) && command.name.toLowerCase().includes(query),
  );
  return [...prefix, ...rest].slice(0, MAX_SUGGESTIONS);
}

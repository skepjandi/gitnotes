import type { AgentConfigChoice, AgentConfigOption } from '../../models/Chat';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseChoice(raw: unknown, group?: string): AgentConfigChoice | null {
  if (!isRecord(raw) || typeof raw.value !== 'string') return null;
  return {
    value: raw.value,
    name: typeof raw.name === 'string' && raw.name ? raw.name : raw.value,
    ...(typeof raw.description === 'string' && raw.description ? { description: raw.description } : {}),
    ...(group ? { group } : {}),
  };
}

/** ACP `SessionConfigSelectOptions`: a flat list of choices or a list of `{ group, name, options }`. */
function flattenChoices(raw: unknown[]): AgentConfigChoice[] {
  const choices: AgentConfigChoice[] = [];
  for (const entry of raw) {
    if (isRecord(entry) && Array.isArray(entry.options)) {
      const label = typeof entry.name === 'string' && entry.name ? entry.name : typeof entry.group === 'string' ? entry.group : undefined;
      for (const nested of entry.options) {
        const choice = parseChoice(nested, label);
        if (choice) choices.push(choice);
      }
      continue;
    }
    const choice = parseChoice(entry);
    if (choice) choices.push(choice);
  }
  return choices;
}

function parseOption(raw: unknown): AgentConfigOption | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const base = {
    id: raw.id,
    name: raw.name,
    ...(typeof raw.description === 'string' && raw.description ? { description: raw.description } : {}),
    ...(typeof raw.category === 'string' && raw.category ? { category: raw.category } : {}),
  };
  if (raw.type === 'select' && typeof raw.currentValue === 'string' && Array.isArray(raw.options)) {
    return { ...base, type: 'select', currentValue: raw.currentValue, options: flattenChoices(raw.options) };
  }
  if (raw.type === 'boolean' && typeof raw.currentValue === 'boolean') {
    return { ...base, type: 'boolean', currentValue: raw.currentValue };
  }
  return null;
}

/** Parses the `configOptions` of a `session/new` / `session/load` / `config_option_update` payload; unknown option types are dropped. */
export function parseConfigOptions(raw: unknown): AgentConfigOption[] {
  if (!Array.isArray(raw)) return [];
  const options: AgentConfigOption[] = [];
  for (const entry of raw) {
    const option = parseOption(entry);
    if (option) options.push(option);
  }
  return options;
}

export function withConfigValue(options: AgentConfigOption[], configId: string, value: string | boolean): AgentConfigOption[] {
  return options.map((option) => (option.id === configId ? { ...option, currentValue: value } : option));
}

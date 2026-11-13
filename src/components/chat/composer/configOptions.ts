import type { AgentConfigOption, ThreadBackend } from '../../../models/Chat';

export type ConfigGroupKey = 'model' | 'effort' | 'mode';

export interface ConfigGroup {
  key: ConfigGroupKey;
  options: AgentConfigOption[];
}

type AgentBackend = Extract<ThreadBackend, { type: 'agent' }>;

export const LEGACY_MODE_OPTION_ID = 'mode';

/** The agent's config options in its own order; older bridges that only report modes get one synthesized `mode` select. */
export function configOptionsFor(agent: AgentBackend): AgentConfigOption[] {
  if (agent.configOptions && agent.configOptions.length > 0) return agent.configOptions;
  if (!agent.availableModes || agent.availableModes.length === 0) return [];
  return [
    {
      id: LEGACY_MODE_OPTION_ID,
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: agent.modeId ?? '',
      options: agent.availableModes.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description,
      })),
    },
  ];
}

function groupKeyFor(option: AgentConfigOption): ConfigGroupKey {
  if (option.category === 'mode') return 'mode';
  if (option.category === 'thought_level') return 'effort';
  return 'model';
}

/** Model and model-config (and any uncategorized) options share one popover; effort and mode get their own chip. */
export function groupConfigOptions(options: readonly AgentConfigOption[]): ConfigGroup[] {
  const groups: ConfigGroup[] = [];
  for (const option of options) {
    const key = groupKeyFor(option);
    const group = groups.find((candidate) => candidate.key === key);
    if (group) group.options.push(option);
    else groups.push({ key, options: [option] });
  }
  return groups;
}

/** The chip's text: the selected choice of the group's lead select option, or the boolean's name. */
export function currentChoiceLabel(option: AgentConfigOption): string {
  if (option.type === 'boolean') return option.name;
  return option.options?.find((choice) => choice.value === option.currentValue)?.name ?? option.name;
}

import { parseConfigOptions, withConfigValue } from '../../../src/services/agent/acpConfig';
import { mapSessionUpdate } from '../../../src/services/agent/acpMapper';

describe('parseConfigOptions', () => {
  it('reads a select option with a flat choice list', () => {
    const [option] = parseConfigOptions([
      { id: 'model', name: 'Model', type: 'select', currentValue: 'sonnet', options: [{ value: 'sonnet', name: 'Sonnet' }] },
    ]);
    expect(option).toEqual({
      id: 'model',
      name: 'Model',
      type: 'select',
      currentValue: 'sonnet',
      options: [{ value: 'sonnet', name: 'Sonnet' }],
    });
  });

  it('flattens grouped choices into group labels', () => {
    const [option] = parseConfigOptions([
      {
        id: 'model',
        name: 'Model',
        type: 'select',
        currentValue: 'opus',
        options: [
          { group: 'fast', name: 'Fast models', options: [{ value: 'haiku', name: 'Haiku' }] },
          { group: 'smart', options: [{ value: 'opus', name: 'Opus' }] },
        ],
      },
    ]);
    expect(option?.options).toEqual([
      { value: 'haiku', name: 'Haiku', group: 'Fast models' },
      { value: 'opus', name: 'Opus', group: 'smart' },
    ]);
  });

  it('reads boolean options', () => {
    const [option] = parseConfigOptions([{ id: 'fast', name: 'Fast mode', type: 'boolean', currentValue: true }]);
    expect(option).toEqual({ id: 'fast', name: 'Fast mode', type: 'boolean', currentValue: true });
  });

  it('drops unknown option types and malformed entries', () => {
    expect(
      parseConfigOptions([
        { id: 'x', name: 'X', type: 'number', currentValue: 1 },
        { id: 'y', name: 'Y', type: 'select', currentValue: 3, options: [] },
        { name: 'no id', type: 'boolean', currentValue: false },
        'nonsense',
      ]),
    ).toEqual([]);
  });

  it('keeps the description and category', () => {
    const [option] = parseConfigOptions([
      { id: 'effort', name: 'Effort', description: 'How hard to think', category: 'thought_level', type: 'select', currentValue: 'high', options: [] },
    ]);
    expect(option).toMatchObject({ description: 'How hard to think', category: 'thought_level' });
  });

  it('returns nothing for a non-array payload', () => {
    expect(parseConfigOptions(undefined)).toEqual([]);
    expect(parseConfigOptions({ id: 'x' })).toEqual([]);
  });
});

describe('withConfigValue', () => {
  it('changes only the option with the given id', () => {
    const options = parseConfigOptions([
      { id: 'model', name: 'Model', type: 'select', currentValue: 'sonnet', options: [] },
      { id: 'fast', name: 'Fast', type: 'boolean', currentValue: false },
    ]);
    const updated = withConfigValue(options, 'model', 'opus');
    expect(updated[0]?.currentValue).toBe('opus');
    expect(updated[1]?.currentValue).toBe(false);
  });
});

describe('config_option_update', () => {
  it('maps the update to an agent-state event with the full option list', () => {
    const events = mapSessionUpdate({
      sessionUpdate: 'config_option_update',
      configOptions: [
        { id: 'model', name: 'Model', type: 'select', currentValue: 'opus', options: [{ value: 'opus', name: 'Opus' }] },
      ],
    });
    expect(events).toEqual([
      {
        type: 'agent-state',
        configOptions: [
          { id: 'model', name: 'Model', type: 'select', currentValue: 'opus', options: [{ value: 'opus', name: 'Opus' }] },
        ],
      },
    ]);
  });

  it('ignores an update without options', () => {
    expect(mapSessionUpdate({ sessionUpdate: 'config_option_update', configOptions: [] })).toEqual([]);
  });
});

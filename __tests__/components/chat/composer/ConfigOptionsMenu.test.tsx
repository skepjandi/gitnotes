import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ConfigOptionsMenu } from '@/components/chat/composer/ConfigOptionsMenu';
import { configOptionsFor, groupConfigOptions } from '@/components/chat/composer/configOptions';
import type { AgentConfigOption } from '@/models/Chat';

const model: AgentConfigOption = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'sonnet',
  options: [
    { value: 'sonnet', name: 'Claude Sonnet 4.5 with a rather long display name', description: 'Balanced' },
    { value: 'opus', name: 'Opus', description: 'Deepest reasoning' },
  ],
};
const think: AgentConfigOption = { id: 'think', name: 'Extended thinking', category: 'model_config', type: 'boolean', currentValue: false };
const effort: AgentConfigOption = {
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  type: 'select',
  currentValue: 'medium',
  options: [{ value: 'medium', name: 'Medium' }, { value: 'high', name: 'High' }],
};
const mode: AgentConfigOption = {
  id: 'mode',
  name: 'Mode',
  category: 'mode',
  type: 'select',
  currentValue: 'default',
  options: [{ value: 'default', name: 'Manual' }, { value: 'plan', name: 'Plan' }],
};

describe('groupConfigOptions', () => {
  it('puts model and model_config together, effort and mode on their own, in agent order', () => {
    const groups = groupConfigOptions([mode, model, effort, think]);
    expect(groups.map((group) => [group.key, group.options.map((option) => option.id)])).toEqual([
      ['mode', ['mode']],
      ['model', ['model', 'think']],
      ['effort', ['effort']],
    ]);
  });
});

describe('configOptionsFor', () => {
  const base = { type: 'agent' as const, bridgeId: 'b', agentId: 'a', agentName: 'A', cwd: '/c' };

  it('prefers real config options over the legacy modes', () => {
    expect(configOptionsFor({ ...base, configOptions: [model], availableModes: [{ id: 'x', name: 'X' }] })).toEqual([model]);
  });

  it('synthesizes a mode select from legacy modes', () => {
    const [option] = configOptionsFor({ ...base, modeId: 'plan', availableModes: [{ id: 'plan', name: 'Plan' }] });
    expect(option).toMatchObject({ category: 'mode', type: 'select', currentValue: 'plan' });
    expect(option.options).toEqual([{ value: 'plan', name: 'Plan', description: undefined }]);
  });

  it('is empty when the agent exposes neither', () => {
    expect(configOptionsFor(base)).toEqual([]);
  });
});

describe('ConfigOptionsMenu', () => {
  it('renders one chip per group and the selected choice as its label', () => {
    const { getByTestId, queryByTestId } = render(<ConfigOptionsMenu options={[model, effort, mode]} onChange={jest.fn()} />);

    expect(getByTestId('chat-config.chip.model.label').props.numberOfLines).toBe(1);
    expect(getByTestId('chat-config.chip.model.label').props.children).toContain('Claude Sonnet');
    expect(getByTestId('chat-config.chip.effort.label').props.children).toBe('Medium');
    expect(getByTestId('chat-config.chip.mode.label').props.children).toBe('Manual');
    expect(queryByTestId('chat-config.sheet.model')).toBeNull();
  });

  it('opens the sheet with descriptions and a checkmark, and selects a choice', () => {
    const onChange = jest.fn();
    const { getByTestId, getByText, queryByTestId } = render(<ConfigOptionsMenu options={[model, think]} onChange={onChange} />);

    fireEvent.press(getByTestId('chat-config.chip.model'));
    expect(getByText('Deepest reasoning')).toBeTruthy();
    fireEvent.press(getByTestId('chat-config.choice.model.opus'));

    expect(onChange).toHaveBeenCalledWith('model', 'opus');
    expect(queryByTestId('chat-config.sheet.model')).toBeNull();
  });

  it('does not re-send the already selected choice', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<ConfigOptionsMenu options={[model]} onChange={onChange} />);

    fireEvent.press(getByTestId('chat-config.chip.model'));
    fireEvent.press(getByTestId('chat-config.choice.model.sonnet'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders boolean options as a toggle row that stays open', () => {
    const onChange = jest.fn();
    const { getByTestId } = render(<ConfigOptionsMenu options={[model, think]} onChange={onChange} />);

    fireEvent.press(getByTestId('chat-config.chip.model'));
    fireEvent.press(getByTestId('chat-config.toggle.think'));

    expect(onChange).toHaveBeenCalledWith('think', true);
    expect(getByTestId('chat-config.sheet.model')).toBeTruthy();
  });

  it('labels a model group without a model option generically', () => {
    const { getByTestId } = render(<ConfigOptionsMenu options={[think]} onChange={jest.fn()} />);
    expect(getByTestId('chat-config.chip.model.label')).toBeTruthy();
  });

  it('disables the chips when asked', () => {
    const { getByTestId } = render(<ConfigOptionsMenu options={[mode]} onChange={jest.fn()} disabled />);
    expect(getByTestId('chat-config.chip.mode').props.accessibilityState?.disabled ?? getByTestId('chat-config.chip.mode').props.disabled).toBeTruthy();
  });
});

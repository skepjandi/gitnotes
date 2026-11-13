import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ElicitationCard, parseUrlTarget } from '@/components/chat/ElicitationCard';
import type { ElicitationField, ElicitationRequest } from '@/services/chat/types';


const reactNative = require('react-native') as { Linking: { openURL: jest.Mock } };
reactNative.Linking = { openURL: jest.fn(async () => true) };

const form = (fields: ElicitationField[]): ElicitationRequest => ({ mode: 'form', id: 'e1', message: 'Need a few answers', fields });

function setup(request: ElicitationRequest) {
  const onResolve = jest.fn();
  const utils = render(<ElicitationCard request={request} agentName="Claude Code" onResolve={onResolve} />);
  return { onResolve, ...utils };
}

describe('ElicitationCard form mode', () => {
  it('shows the agent and message', () => {
    const { getByTestId } = setup(form([]));
    expect(getByTestId('chat-elicitation.message').props.children).toBe('Need a few answers');
    expect(getByTestId('chat-elicitation.agent').props.children).toBe('Claude Code');
    expect(getByTestId('chat-elicitation.header')).toBeTruthy();
  });

  it('collects every field kind and submits typed values', () => {
    const { getByTestId, onResolve } = setup(
      form([
        { key: 'db', label: 'Database', required: true, kind: 'enum', options: [{ value: 'pg', label: 'Postgres' }, { value: 'my', label: 'MySQL' }] },
        { key: 'features', label: 'Features', required: false, kind: 'multi-enum', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] },
        { key: 'ci', label: 'CI', required: false, kind: 'boolean' },
        { key: 'name', label: 'Name', required: true, kind: 'string' },
        { key: 'notes', label: 'Notes', required: false, kind: 'string', multiline: true },
        { key: 'port', label: 'Port', required: true, kind: 'integer', minimum: 1024, maximum: 65535 },
        { key: 'ratio', label: 'Ratio', required: false, kind: 'number' },
      ]),
    );

    fireEvent.press(getByTestId('chat-elicitation.option.db.pg'));
    fireEvent.press(getByTestId('chat-elicitation.option.db.my'));
    fireEvent.press(getByTestId('chat-elicitation.option.features.a'));
    fireEvent.press(getByTestId('chat-elicitation.option.features.c'));
    fireEvent.press(getByTestId('chat-elicitation.option.features.a'));
    fireEvent.press(getByTestId('chat-elicitation.switch.ci'));
    fireEvent.changeText(getByTestId('chat-elicitation.input.name'), 'app');
    fireEvent.changeText(getByTestId('chat-elicitation.input.port'), '8080');
    fireEvent.changeText(getByTestId('chat-elicitation.input.ratio'), '0.5');
    expect(getByTestId('chat-elicitation.input.notes').props.multiline).toBe(true);
    expect(getByTestId('chat-elicitation.input.name').props.multiline).toBe(false);

    fireEvent.press(getByTestId('chat-elicitation.button.submit'));

    expect(onResolve).toHaveBeenCalledWith('e1', {
      action: 'accept',
      content: { db: 'my', features: ['c'], ci: true, name: 'app', port: 8080, ratio: 0.5 },
    });
  });

  it('prefills defaults', () => {
    const { getByTestId, onResolve } = setup(
      form([
        { key: 'name', label: 'Name', required: true, kind: 'string', default: 'demo' },
        { key: 'count', label: 'Count', required: true, kind: 'integer', default: 3 },
        { key: 'ci', label: 'CI', required: false, kind: 'boolean', default: true },
        { key: 'tags', label: 'Tags', required: false, kind: 'multi-enum', options: [{ value: 'x', label: 'X' }], default: ['x'] },
        { key: 'db', label: 'DB', required: false, kind: 'enum', options: [{ value: 'pg', label: 'PG' }], default: 'pg' },
      ]),
    );

    expect(getByTestId('chat-elicitation.input.name').props.value).toBe('demo');
    fireEvent.press(getByTestId('chat-elicitation.button.submit'));

    expect(onResolve).toHaveBeenCalledWith('e1', {
      action: 'accept',
      content: { name: 'demo', count: 3, ci: true, tags: ['x'], db: 'pg' },
    });
  });

  it('omits empty optional fields', () => {
    const { getByTestId, onResolve } = setup(form([{ key: 'note', label: 'Note', required: false, kind: 'string' }]));
    fireEvent.press(getByTestId('chat-elicitation.button.submit'));
    expect(onResolve).toHaveBeenCalledWith('e1', { action: 'accept', content: {} });
  });

  it('blocks submit with missing required fields and shows the error', () => {
    const { getByTestId, queryByTestId, onResolve } = setup(
      form([
        { key: 'name', label: 'Name', required: true, kind: 'string' },
        { key: 'db', label: 'DB', required: true, kind: 'enum', options: [{ value: 'pg', label: 'PG' }] },
        { key: 'tags', label: 'Tags', required: true, kind: 'multi-enum', options: [{ value: 'x', label: 'X' }] },
      ]),
    );

    expect(queryByTestId('chat-elicitation.error.name')).toBeNull();
    fireEvent.press(getByTestId('chat-elicitation.button.submit'));

    expect(onResolve).not.toHaveBeenCalled();
    expect(getByTestId('chat-elicitation.error.name')).toBeTruthy();
    expect(getByTestId('chat-elicitation.error.db')).toBeTruthy();
    expect(getByTestId('chat-elicitation.error.tags')).toBeTruthy();
  });

  it.each([
    ['abc', 'integer', undefined, undefined],
    ['1.5', 'integer', undefined, undefined],
    ['5', 'number', 10, 20],
    ['25', 'number', 10, 20],
  ] as const)('rejects %s for a %s field in [%s, %s]', (input, kind, minimum, maximum) => {
    const { getByTestId, onResolve } = setup(form([{ key: 'n', label: 'N', required: true, kind, minimum, maximum }]));
    fireEvent.changeText(getByTestId('chat-elicitation.input.n'), input);
    fireEvent.press(getByTestId('chat-elicitation.button.submit'));

    expect(onResolve).not.toHaveBeenCalled();
    expect(getByTestId('chat-elicitation.error.n')).toBeTruthy();
  });

  it('accepts the bounds themselves', () => {
    const { getByTestId, onResolve } = setup(form([{ key: 'n', label: 'N', required: true, kind: 'number', minimum: 10, maximum: 20 }]));
    fireEvent.changeText(getByTestId('chat-elicitation.input.n'), '20');
    fireEvent.press(getByTestId('chat-elicitation.button.submit'));
    expect(onResolve).toHaveBeenCalledWith('e1', { action: 'accept', content: { n: 20 } });
  });

  it('declines and cancels without validating', () => {
    const { getByTestId, onResolve } = setup(form([{ key: 'name', label: 'Name', required: true, kind: 'string' }]));

    fireEvent.press(getByTestId('chat-elicitation.button.decline'));
    expect(onResolve).toHaveBeenLastCalledWith('e1', { action: 'decline' });
    fireEvent.press(getByTestId('chat-elicitation.button.cancel'));
    expect(onResolve).toHaveBeenLastCalledWith('e1', { action: 'cancel' });
  });
});

describe('ElicitationCard url mode', () => {
  beforeEach(() => {
    jest.mocked(Alert.alert).mockClear();
  });

  const request: ElicitationRequest = { mode: 'url', id: 'u1', message: 'Sign in to continue', url: 'https://user@auth.example.com/login?x=1' };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the host and full URL and does nothing until Open is confirmed', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const open = reactNative.Linking.openURL as jest.Mock;
    const { getByTestId, onResolve } = setup(request);

    expect(getByTestId('chat-elicitation.host').props.children).toBe('auth.example.com');
    expect(getByTestId('chat-elicitation.url').props.children).toBe(request.mode === 'url' ? request.url : '');
    expect(open).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('chat-elicitation.button.open'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2] ?? [];
    buttons[buttons.length - 1].onPress?.();
    expect(open).toHaveBeenCalledWith('https://user@auth.example.com/login?x=1');
    expect(onResolve).toHaveBeenCalledWith('u1', { action: 'accept', content: {} });
  });

  it('declines and cancels', () => {
    const { getByTestId, onResolve } = setup(request);
    fireEvent.press(getByTestId('chat-elicitation.button.decline'));
    expect(onResolve).toHaveBeenLastCalledWith('u1', { action: 'decline' });
    fireEvent.press(getByTestId('chat-elicitation.button.cancel'));
    expect(onResolve).toHaveBeenLastCalledWith('u1', { action: 'cancel' });
  });

  it('refuses to open non-http schemes', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByTestId } = setup({ mode: 'url', id: 'u2', message: 'm', url: 'javascript:alert(1)' });

    fireEvent.press(getByTestId('chat-elicitation.button.open'));
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('parseUrlTarget', () => {
  it('extracts the host without credentials or port path', () => {
    expect(parseUrlTarget('http://a.dev:8080/x')).toEqual({ scheme: 'http', host: 'a.dev:8080' });
    expect(parseUrlTarget('https://trusted.com@evil.test/')).toEqual({ scheme: 'https', host: 'evil.test' });
    expect(parseUrlTarget('ftp://a.dev')).toBeNull();
    expect(parseUrlTarget('not a url')).toBeNull();
  });
});

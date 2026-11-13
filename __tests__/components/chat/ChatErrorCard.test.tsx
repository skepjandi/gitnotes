import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatErrorCard, isRateLimitMessage } from '@/components/chat/ChatErrorCard';

describe('ChatErrorCard', () => {
  it.each(['HTTP 429 from provider', 'Rate limit exceeded', 'rate_limit_error', 'Too many requests'])(
    'treats "%s" as a rate limit',
    (message) => expect(isRateLimitMessage(message)).toBe(true),
  );

  it('does not flag ordinary failures', () => {
    expect(isRateLimitMessage('Bridge disconnected')).toBe(false);
    expect(isRateLimitMessage('port 14290 refused')).toBe(false);
  });

  it('renders a calm, non-alert notice for rate limits but keeps retry and dismiss', () => {
    const onRetry = jest.fn();
    const onDismiss = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <ChatErrorCard message="429 Too Many Requests" canRetry onRetry={onRetry} onDismiss={onDismiss} />,
    );

    expect(getByTestId('chat-error.rate-limit').props.accessibilityRole).toBeUndefined();
    expect(queryByTestId('chat-error.card')).toBeNull();
    fireEvent.press(getByTestId('chat-error.button.retry'));
    fireEvent.press(getByTestId('chat-error.button.dismiss'));
    expect(onRetry).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('keeps the quiet alert card and raw message for other errors', () => {
    const { getByTestId, queryByTestId } = render(
      <ChatErrorCard message="Bridge disconnected" canRetry={false} onRetry={jest.fn()} onDismiss={jest.fn()} />,
    );

    expect(getByTestId('chat-error.card').props.accessibilityRole).toBe('alert');
    expect(getByTestId('chat-error.message').props.children).toBe('Bridge disconnected');
    expect(queryByTestId('chat-error.button.retry')).toBeNull();
  });
});

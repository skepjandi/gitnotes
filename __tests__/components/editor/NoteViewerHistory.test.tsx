/**
 * NoteViewerHistory.test.tsx
 *
 * Focused tests for NoteViewer history entry point:
 * - History button visibility based on canViewHistory
 * - onOpenHistory callback
 * - No history button for PDF notes (canViewHistory false)
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { NoteViewer } from '@/components/editor/NoteViewer';

jest.mock('@/contexts/ThemeContext', () => {
  const { SAFE_DEFAULT_TOKENS, SAFE_DEFAULT_THEME } = jest.requireActual(
    '@/contexts/ThemeContext',
  );
  return {
    useTheme: () => SAFE_DEFAULT_THEME,
    useTokens: () => SAFE_DEFAULT_TOKENS,
  };
});

jest.mock('@/utils/haptics', () => ({
  HapticService: { selection: jest.fn(), light: jest.fn() },
}));

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { View } = jest.requireActual('react-native');
  return {
    IconButton: ({ testID, children, onPress }: { testID?: string; children?: React.ReactNode; onPress?: () => void }) => (
      <View testID={testID} onTouchEnd={onPress}>{children}</View>
    ),
    Modal: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? <View>{children}</View> : null,
  };
});

jest.mock('@/components/editor/NotePreviewPane', () => {
  const { View } = jest.requireActual('react-native');
  return {
    NotePreviewPane: () => <View testID="note-preview-pane" />,
  };
});

const defaultProps = {
  noteId: 'note-123',
  title: 'Test Note',
  noteFormat: 'markdown' as const,
  canEdit: true,
  canSpeak: false,
  isSpeaking: false,
  tocEntries: [],
  showToc: false,
  onBack: jest.fn(),
  onToggleToc: jest.fn(),
  onToggleSpeak: jest.fn(),
  onEdit: jest.fn(),
  onCloseToc: jest.fn(),
  onTocPress: jest.fn(),
  onNavigateToNote: jest.fn(),
  previewContent: '# Test Content',
  parsedStructuredContent: null,
  markdownStyles: {},
  notePreviewRenderer: null,
  pdfViewerUri: '',
  pdfLoadError: null,
  onPdfError: jest.fn(),
  previewScrollRef: { current: null },
  onPreviewScroll: jest.fn(),
  onPreviewContentSizeChange: jest.fn(),
};

describe('NoteViewer History Integration', () => {
  it('renders history button when canViewHistory is true', () => {
    render(
      <NoteViewer
        {...defaultProps}
        canViewHistory={true}
        onOpenHistory={jest.fn()}
      />,
    );

    expect(screen.getByTestId('note-viewer.button.history')).toBeTruthy();
  });

  it('does not render history button when canViewHistory is false', () => {
    render(
      <NoteViewer
        {...defaultProps}
        canViewHistory={false}
        onOpenHistory={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('note-viewer.button.history')).toBeNull();
  });

  it('does not render history button when onOpenHistory is not provided', () => {
    render(
      <NoteViewer
        {...defaultProps}
        canViewHistory={true}
      />,
    );

    expect(screen.queryByTestId('note-viewer.button.history')).toBeNull();
  });

  it('history button calls onOpenHistory when pressed', () => {
    const onOpenHistory = jest.fn();
    render(
      <NoteViewer
        {...defaultProps}
        canViewHistory={true}
        onOpenHistory={onOpenHistory}
      />,
    );

    const historyBtn = screen.getByTestId('note-viewer.button.history');
    fireEvent(historyBtn, 'press');
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it('history button is not rendered for PDF notes (canViewHistory=false)', () => {
    render(
      <NoteViewer
        {...defaultProps}
        noteFormat="pdf"
        canViewHistory={false}
        onOpenHistory={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('note-viewer.button.history')).toBeNull();
  });

  it('edit button is still rendered when history button is not shown', () => {
    render(
      <NoteViewer
        {...defaultProps}
        canViewHistory={false}
        onOpenHistory={jest.fn()}
      />,
    );

    expect(screen.getByTestId('note-viewer.button.edit')).toBeTruthy();
  });

  it('both edit and history buttons are rendered when both are available', () => {
    render(
      <NoteViewer
        {...defaultProps}
        canViewHistory={true}
        onOpenHistory={jest.fn()}
      />,
    );

    expect(screen.getByTestId('note-viewer.button.edit')).toBeTruthy();
    expect(screen.getByTestId('note-viewer.button.history')).toBeTruthy();
  });

  it('history button calls onOpenHistory without triggering save/cancel/navigation', () => {
    const onOpenHistory = jest.fn();
    const onEdit = jest.fn();
    const onBack = jest.fn();
    render(
      <NoteViewer
        {...defaultProps}
        canViewHistory={true}
        onOpenHistory={onOpenHistory}
        onEdit={onEdit}
        onBack={onBack}
      />,
    );

    const historyBtn = screen.getByTestId('note-viewer.button.history');
    fireEvent(historyBtn, 'press');
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});

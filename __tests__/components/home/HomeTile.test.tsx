import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HomeTile } from '../../../src/components/home/HomeTile';
import { INK_ON_FILLED, ON_FILLED } from '../../../src/theme/tokens';

jest.mock('../../../src/contexts/ThemeContext', () => {
  const React = require('react');
  const { createContext, useContext } = React;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _mockOverride: any = null;

  const DefaultContext = createContext<Record<string, unknown>>(null as unknown as Record<string, unknown>);

  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(DefaultContext.Provider, { value: _mockOverride }, children),

    useTheme: () => {
      const ctx = useContext(DefaultContext);
      return (
        ctx ?? {
          theme: 'light',
          isDark: false,
          style: 'flat',
          setTheme: jest.fn(),
          setStyle: jest.fn(),
          colors: {
            bg: '#f2f2f7',
            surface: '#ffffff',
            highlight: '#ffffff',
            shadow: '#000000',
            text: '#1c1c1e',
            textSecondary: '#6e6e73',
            accent: '#007AFF',
            accentMuted: '#5AC8FA',
            error: '#ff3b30',
            success: '#34C759',
            warning: '#FF9500',
            background: '#f2f2f7',
            surfaceSecondary: '#f2f2f7',
            primary: '#007AFF',
            border: '#c6c6c8',
            card: '#ffffff',
            elevated: '#ffffff',
          },
          tokens: {
            colors: {
              bg: '#f2f2f7',
              surface: '#ffffff',
              highlight: '#ffffff',
              shadow: '#000000',
              text: '#1c1c1e',
              textSecondary: '#6e6e73',
              accent: '#007AFF',
              accentMuted: '#5AC8FA',
              error: '#ff3b30',
              success: '#34C759',
              warning: '#FF9500',
              background: '#f2f2f7',
              surfaceSecondary: '#f2f2f7',
              primary: '#007AFF',
              border: '#c6c6c8',
              card: '#ffffff',
              elevated: '#ffffff',
            },
            radii: { sm: 12, md: 18, lg: 24, pill: 999 },
            spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 },
            type: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28 },
          },
        }
      );
    },

    useTokens: () => ({
      colors: {
        bg: '#f2f2f7',
        surface: '#ffffff',
        highlight: '#ffffff',
        shadow: '#000000',
        text: '#1c1c1e',
        textSecondary: '#6e6e73',
        accent: '#007AFF',
        accentMuted: '#5AC8FA',
        error: '#ff3b30',
        success: '#34C759',
        warning: '#FF9500',
        background: '#f2f2f7',
        surfaceSecondary: '#f2f2f7',
        primary: '#007AFF',
        border: '#c6c6c8',
        card: '#ffffff',
        elevated: '#ffffff',
      },
      radii: { sm: 12, md: 18, lg: 24, pill: 999 },
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 },
      type: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28 },
    }),

    __resetTheme: () => { _mockOverride = null; },
    __overrideTheme: (v: Record<string, unknown>) => { _mockOverride = v; },
  };
});

const renderWithTheme = (ui: React.ReactElement) => {
  return render(ui);
};

const flatten = (style: unknown): Record<string, unknown> => {
  const items = Array.isArray(style) ? style.flat(Infinity) : [style];
  return items.reduce<Record<string, unknown>>((merged, item) => ({ ...merged, ...((item as object) ?? {}) }), {});
};

describe('HomeTile', () => {
  const defaultProps = {
    variant: 'primary' as const,
    icon: 'document-text' as const,
    title: 'Test Title',
    subtitle: 'Test subtitle',
    onPress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.requireMock('../../../src/contexts/ThemeContext').__resetTheme();
  });

  it('renders title and subtitle', () => {
    const { getByText } = renderWithTheme(<HomeTile {...defaultProps} />);
    expect(getByText('Test Title')).toBeTruthy();
    expect(getByText('Test subtitle')).toBeTruthy();
  });

  it('announces title and subtitle together', () => {
    const { getByLabelText } = renderWithTheme(<HomeTile {...defaultProps} />);
    expect(getByLabelText('Test Title, Test subtitle')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(<HomeTile {...defaultProps} onPress={onPress} testID="test-tile" />);
    fireEvent.press(getByTestId('test-tile'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onLongPress when long-pressed', () => {
    const onLongPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <HomeTile {...defaultProps} onLongPress={onLongPress} testID="test-tile" />,
    );
    fireEvent(getByTestId('test-tile'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it.each(['primary', 'secondary', 'accent'] as const)(
    'lets %s copy grow the tile instead of overlapping the badge',
    (variant) => {
      const { getByTestId } = renderWithTheme(<HomeTile {...defaultProps} variant={variant} testID="tile" />);
      const tileStyle = flatten(getByTestId('tile').props.style({ pressed: false }));
      const badgeStyle = flatten(getByTestId('tile.badge').props.style);

      expect(tileStyle.minHeight).toBeGreaterThan(0);
      expect(tileStyle.height).toBeUndefined();
      expect(badgeStyle.position).toBeUndefined();
    },
  );

  it('shares row width through flex unless laid out as a block', () => {
    const cell = renderWithTheme(<HomeTile {...defaultProps} testID="cell" />);
    const block = renderWithTheme(<HomeTile {...defaultProps} block testID="block" />);

    expect(flatten(cell.getByTestId('cell').props.style({ pressed: false })).flex).toBe(1);
    expect(flatten(block.getByTestId('block').props.style({ pressed: false })).flex).toBeUndefined();
  });

  it('hides the decorative watermark from assistive tech', () => {
    const { getByTestId } = renderWithTheme(<HomeTile {...defaultProps} testID="tile" />);
    expect(getByTestId('tile.watermark', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('uses dark ink when the primary fill is too bright for white', () => {
    const brightPrimary = '#FFB347';
    const { ThemeProvider, __overrideTheme } = jest.requireMock('../../../src/contexts/ThemeContext');
    __overrideTheme({
      colors: { surface: '#ffffff', text: '#1c1c1e', textSecondary: '#6e6e73', border: '#c6c6c8', primary: brightPrimary, accent: brightPrimary },
    });
    const { getByText } = render(
      <ThemeProvider>
        <HomeTile {...defaultProps} />
      </ThemeProvider>,
    );
    expect(flatten(getByText('Test Title').props.style).color).toBe(INK_ON_FILLED);
  });

  it('keeps white ink on the standard blue fill', () => {
    const { getByText } = renderWithTheme(<HomeTile {...defaultProps} />);
    expect(flatten(getByText('Test Title').props.style).color).toBe(ON_FILLED);
  });
});

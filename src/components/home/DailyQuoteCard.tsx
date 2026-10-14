import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import type { DailyQuote } from '../../services/DailyQuoteService';
import { useTranslation } from 'react-i18next';

interface DailyQuoteCardProps {
  quote: DailyQuote | null;
  isLoading: boolean;
  error?: string | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

/**
 * Daily Quote strip — a borderless, typographic element that integrates
 * into the HomeScreen scroll content without feeling like a pasted-in widget.
 * Replaces the original "card" design.
 *
 * Layout:
 *   [“] Quote text in italics…                      [↻]
 *       — Philosopher Name
 *       Small AI-personalized description tied to your journals
 *
 * Parent ScrollView already provides horizontal padding (20px), so this
 * component uses NO horizontal margin — avoiding the nested-box effect
 * that made the card look like a bolted-on widget.
 */
export function DailyQuoteCard({
  quote,
  isLoading,
  error,
  onRefresh,
  isRefreshing = false,
}: DailyQuoteCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Feature disabled / no content / not loading → render nothing.
  if (!quote && !isLoading && !error) return null;

  // Loading state — small spinner + subtle text.
  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.textSecondary} size="small" />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          {t('home.dailyQuote.loading', { defaultValue: 'Finding your quote' })}
        </Text>
      </View>
    );
  }

  // Error-only state — muted, non-alarming, with a retry affordance.
  if (error && !quote) {
    return (
      <View style={styles.container}>
        <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        {onRefresh ? (
          <TouchableOpacity
            testID="daily-quote.retry"
            onPress={onRefresh}
            disabled={isRefreshing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('common.retry', { defaultValue: 'Retry' })}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (!quote) return null;

  return (
    <View style={styles.container}>
      <View style={styles.quoteRow}>
        <View style={styles.quoteIconColumn}>
          <Text style={[styles.quoteIcon, { color: colors.primary }]}>“</Text>
        </View>
        <Text style={[styles.quoteText, { color: colors.text }]}>{quote.text}</Text>
        {onRefresh ? (
          <TouchableOpacity
            onPress={onRefresh}
            disabled={isRefreshing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.refreshButton}
            accessibilityLabel={t('common.refresh', { defaultValue: 'Refresh' })}
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons name="refresh-outline" size={14} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[styles.author, { color: colors.primary }]}>
        — {quote.author}{quote.source ? `, ${quote.source}` : ''}
      </Text>
      {quote.description ? (
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {quote.description}
        </Text>
      ) : null}
    </View>
  );
}

const TYPOGRAPHY_LEFT = 20 + 6;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 4,
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
  },
  quoteIconColumn: {
    width: 20,
    marginRight: 6,
  },
  quoteIcon: {
    marginTop: 4,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: '700',
  },
  quoteText: {
    flex: 1,
    fontSize: 15,
    fontStyle: 'italic',
    lineHeight: 22,
    fontWeight: '500',
  },
  refreshButton: {
    padding: 2,
    marginLeft: 6,
    marginTop: 2,
  },
  author: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: TYPOGRAPHY_LEFT,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginLeft: TYPOGRAPHY_LEFT,
    marginRight: 0,
  },
  loadingText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  errorText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

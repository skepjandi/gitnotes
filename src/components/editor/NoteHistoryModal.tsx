/**
 * NoteHistoryModal.tsx
 *
 * Read-only bottom-sheet modal for browsing a note's Git revision history.
 * Displays a horizontal gesture slider, commit metadata, and the exact file
 * content at the selected commit. Edit is disabled; Close is always available.
 */

import { format } from 'date-fns';
import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { useTheme } from '../../contexts/ThemeContext';
import { HapticService } from '../../utils/haptics';
import { Modal } from '../ui/Modal';
import type { FileHistoryEntry } from '../../services/note/NoteHistoryService';
import type { UseNoteHistoryResult } from '../../hooks/useNoteHistory';

const CARD_WIDTH = 120;
const CARD_GAP = 8;
const TOTAL_CARD = CARD_WIDTH + CARD_GAP;
const SPRING_CONFIG = { damping: 22, stiffness: 320 };

interface RevisionCardProps {
  entry: FileHistoryEntry;
  isSelected: boolean;
  index: number;
  onSelect: (commitId: string) => void;
}

function RevisionCard({ entry, isSelected, index, onSelect }: RevisionCardProps) {
  const { colors } = useTheme();
  const date = new Date(entry.authorTime * 1000);
  const dateStr = format(date, 'MMM d');
  const timeStr = format(date, 'h:mm a');

  return (
    <TouchableOpacity
      testID={`note-history.card.${index}`}
      accessibilityRole="button"
      accessibilityLabel={`Revision ${index + 1}: ${entry.summary}, ${dateStr} ${timeStr}`}
      accessibilityState={{ selected: isSelected }}
      onPress={() => onSelect(entry.id)}
      style={[
        styles.revisionCard,
        {
          backgroundColor: isSelected ? colors.primary + '15' : colors.surface,
          borderColor: isSelected ? colors.primary : colors.border,
        },
      ]}
    >
      <View style={styles.revisionCardIndex}>
        <Text
          style={[
            styles.revisionCardIndexText,
            { color: isSelected ? colors.primary : colors.textSecondary },
          ]}
        >
          {index + 1}
        </Text>
      </View>
      <Text
        style={[styles.revisionCardDate, { color: colors.textSecondary }]}
        numberOfLines={1}
      >
        {dateStr}
      </Text>
      <Text
        style={[styles.revisionCardTime, { color: colors.textSecondary }]}
        numberOfLines={1}
      >
        {timeStr}
      </Text>
      <Text
        style={[
          styles.revisionCardMessage,
          { color: isSelected ? colors.primary : colors.text },
        ]}
        numberOfLines={2}
      >
        {entry.summary}
      </Text>
    </TouchableOpacity>
  );
}

interface SliderThumbProps {
  currentIndex: SharedValue<number>;
}

function SliderThumb({ currentIndex }: SliderThumbProps) {
  const { colors } = useTheme();

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: colors.primary,
    transform: [{ translateX: currentIndex.value * TOTAL_CARD }],
  }));

  return (
    <Animated.View
      style={[styles.sliderThumb, animatedStyle]}
      pointerEvents="none"
    />
  );
}

interface NoteHistoryModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** History hook result */
  history: UseNoteHistoryResult;
  /** Called when modal requests to close */
  onClose: () => void;
}

export function NoteHistoryModal({ visible, history, onClose }: NoteHistoryModalProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();

  const {
    state,
    selectedCommitId,
    selectedBlob,
    isLoadingBlob,
    hasMore,
    unavailableReason,
    isDirty,
    loadHistory,
    selectCommit,
    loadMore,
    close: historyClose,
  } = history;

  const handleClose = useCallback(() => {
    historyClose();
    onClose();
  }, [historyClose, onClose]);

  const scrollViewRef = React.useRef<ScrollView>(null);

  // Shared value for the currently snapped card index
  const currentIndex = useSharedValue(0);
  // Shared value for the raw drag offset during gesture
  const dragOffset = useSharedValue(0);
  // Saved index before gesture started
  const savedIndex = useSharedValue(0);

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      currentIndex.value = 0;
      dragOffset.value = 0;
      savedIndex.value = 0;
      loadHistory();
    }
  }, [visible, loadHistory, currentIndex, dragOffset, savedIndex]);

  // Auto-select first entry when modal is visible with ready history and no selection
  useEffect(() => {
    if (!visible || state.status !== 'ready' || selectedCommitId !== null) return;
    const entries = state.status === 'ready' ? state.entries : [];
    if (entries.length > 0) {
      selectCommit(entries[0].id);
    }
  }, [visible, state, selectedCommitId, selectCommit]);

  // Auto-scroll to selected card when selectedCommitId changes
  useEffect(() => {
    if (!visible || !selectedCommitId || state.status !== 'ready') return;
    const entries = state.status === 'ready' ? state.entries : [];
    const idx = entries.findIndex((e) => e.id === selectedCommitId);
    if (idx < 0 || !scrollViewRef.current) return;
    scrollViewRef.current.scrollTo({
      x: Math.max(0, idx * TOTAL_CARD - (viewportWidth - CARD_WIDTH) / 2 + TOTAL_CARD / 2),
      animated: true,
    });
    currentIndex.value = idx;
    savedIndex.value = idx;
  }, [visible, selectedCommitId, state, viewportWidth, currentIndex, savedIndex]);

  const handleSelectCommit = useCallback(
    (commitId: string) => {
      HapticService.selection();
      const entries = state.status === 'ready' ? state.entries : [];
      const idx = entries.findIndex((e) => e.id === commitId);
      currentIndex.value = idx;
      savedIndex.value = idx;
      selectCommit(commitId);
    },
    [state, selectCommit, currentIndex, savedIndex],
  );

  const scrollHandler = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    dragOffset.value = event.nativeEvent.contentOffset.x;
  };

  // Pan gesture for the slider track
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-10, 10])
    .failOffsetY([-8, 8])
    .onStart(() => {
      savedIndex.value = currentIndex.value;
    })
    .onUpdate((event) => {
      dragOffset.value = savedIndex.value * TOTAL_CARD + event.translationX;
    })
    .onEnd((event) => {
      const entries = state.status === 'ready' ? state.entries : [];
      const totalCards = entries.length;

      // Calculate which card we landed on
      const projectedIndex = Math.round(
        Math.max(0, Math.min(totalCards - 1, (savedIndex.value * TOTAL_CARD + event.translationX) / TOTAL_CARD)),
      );

      currentIndex.value = withSpring(projectedIndex, SPRING_CONFIG);
      savedIndex.value = projectedIndex;

      if (projectedIndex < totalCards) {
        const commitId = entries[projectedIndex]?.id;
        if (commitId && commitId !== selectedCommitId) {
          handleSelectCommit(commitId);
        }
      }
    });

  const entries = state.status === 'ready' ? state.entries : [];
  const totalCards = entries.length;
  const selectedIndex = entries.findIndex((e) => e.id === selectedCommitId);

  // Blob content is already decoded as string by the service
  const previewText = useMemo(() => {
    if (!selectedBlob) return null;
    if (selectedBlob.kind === 'Error') return null;
    return selectedBlob.content;
  }, [selectedBlob]);

  const renderContent = () => {
    // Loading state
    if (state.status === 'loading' || state.status === 'idle') {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            {t('noteHistory.loading')}
          </Text>
        </View>
      );
    }

    // Unavailable state
    if (state.status === 'unavailable') {
      return (
        <View style={styles.centerState}>
          <Ionicons name="time-outline" size={40} color={colors.textSecondary} />
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            {t(`noteHistory.unavailable.${unavailableReason ?? 'default'}`)}
          </Text>
          <TouchableOpacity
            testID="note-history.button.close-from-unavailable"
            style={[styles.closeButton, { borderColor: colors.border }]}
            onPress={handleClose}
          >
            <Text style={[styles.closeButtonText, { color: colors.text }]}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Empty state
    if (state.status === 'empty') {
      return (
        <View style={styles.centerState}>
          <Ionicons name="document-text-outline" size={40} color={colors.textSecondary} />
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            {t('noteHistory.empty')}
          </Text>
          <TouchableOpacity
            testID="note-history.button.close-from-empty"
            style={[styles.closeButton, { borderColor: colors.border }]}
            onPress={handleClose}
          >
            <Text style={[styles.closeButtonText, { color: colors.text }]}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Error state
    if (state.status === 'error') {
      return (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
          <Text style={[styles.stateText, { color: colors.error }]}>
            {state.message}
          </Text>
          <TouchableOpacity
            testID="note-history.button.close-from-error"
            style={[styles.closeButton, { borderColor: colors.border }]}
            onPress={handleClose}
          >
            <Text style={[styles.closeButtonText, { color: colors.text }]}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Ready state
    if (totalCards === 0) {
      return (
        <View style={styles.centerState}>
          <Ionicons name="document-text-outline" size={40} color={colors.textSecondary} />
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            {t('noteHistory.empty')}
          </Text>
        </View>
      );
    }

    // Slider + preview
    return (
      <View style={styles.sliderContainer}>
        {/* Revision slider */}
        <View style={styles.sliderSection}>
          <Text style={[styles.sliderLabel, { color: colors.textSecondary }]}>
            {t('noteHistory.revisions')}
          </Text>
          <View style={styles.sliderTrack}>
            <GestureDetector gesture={panGesture}>
              <View style={styles.sliderScrollContainer}>
                <ScrollView
                  ref={scrollViewRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.sliderContent}
                  scrollEventThrottle={16}
                  onScroll={scrollHandler}
                >
                  {entries.map((entry, index) => (
                    <RevisionCard
                      key={entry.id}
                      entry={entry}
                      isSelected={entry.id === selectedCommitId}
                      index={index}
                      onSelect={handleSelectCommit}
                    />
                  ))}
                </ScrollView>
              </View>
            </GestureDetector>
            <SliderThumb currentIndex={currentIndex} />
          </View>
          {/* Position indicator */}
          <View style={styles.positionIndicator}>
            <Text style={[styles.positionText, { color: colors.textSecondary }]}>
              {totalCards > 0
                ? `${Math.max(1, selectedIndex + 1)} / ${totalCards}`
                : '0 / 0'}
            </Text>
          </View>
          {/* Load more */}
          {hasMore && (
            <TouchableOpacity
              testID="note-history.button.load-more"
              style={[styles.loadMoreButton, { borderColor: colors.border }]}
              onPress={() => {
                HapticService.selection();
                loadMore();
              }}
            >
              <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                {t('noteHistory.loadMore')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Selected commit metadata */}
        {selectedCommitId && entries.find((e) => e.id === selectedCommitId) && (
          <View style={[styles.commitMeta, { borderTopColor: colors.border }]}>
            {(() => {
              const entry = entries.find((e) => e.id === selectedCommitId)!;
              return (
                <>
                  <Text style={[styles.commitMessage, { color: colors.text }]} numberOfLines={1}>
                    {entry.message}
                  </Text>
                  <Text style={[styles.commitAuthor, { color: colors.textSecondary }]}>
                    {entry.authorName} &bull; {format(new Date(entry.authorTime * 1000), 'MMM d, yyyy h:mm a')}
                  </Text>
                  <Text style={[styles.commitIdLabel, { color: colors.textSecondary }]}>
                    {t('noteHistory.commitId')}: {entry.shortId}
                  </Text>
                </>
              );
            })()}
          </View>
        )}

        {/* Content preview */}
        <View style={[styles.previewSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.previewLabel, { color: colors.textSecondary }]}>
            {t('noteHistory.preview')}
          </Text>
          {isLoadingBlob ? (
            <View style={styles.previewLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.previewLoadingText, { color: colors.textSecondary }]}>
                {t('noteHistory.loadingBlob')}
              </Text>
            </View>
          ) : selectedBlob?.kind === 'Error' ? (
            <View style={styles.previewError}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
              <Text style={[styles.previewErrorText, { color: colors.error }]}>
                {t(`noteHistory.blobError.${selectedBlob.errorKind}`, { defaultValue: selectedBlob.message })}
              </Text>
            </View>
          ) : previewText !== null ? (
            <ScrollView
              style={styles.previewScroll}
              contentContainerStyle={styles.previewContent}
              showsVerticalScrollIndicator={true}
            >
              <Text
                style={[styles.previewText, { color: colors.text }]}
                selectable
                testID="note-history.preview.text"
              >
                {previewText}
              </Text>
            </ScrollView>
          ) : (
            <View style={styles.previewEmpty}>
              <Text style={[styles.previewEmptyText, { color: colors.textSecondary }]}>
                {t('noteHistory.noPreview')}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={handleClose}
      bottomSheet
      accessibilityLabel={t('noteHistory.accessibilityLabel')}
      contentStyle={styles.modalContent}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t('noteHistory.title')}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            testID="note-history.button.edit"
            disabled
            accessibilityLabel={t('noteHistory.editDisabled')}
            accessibilityState={{ disabled: true }}
            style={styles.headerButton}
          >
            <Ionicons name="create-outline" size={20} color={colors.textSecondary + '60'} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="note-history.button.close"
            accessibilityLabel={t('common.close')}
            onPress={handleClose}
            style={styles.headerButton}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Dirty editor notice */}
      {isDirty && (
        <View
          testID="note-history.notice.dirty"
          style={[styles.dirtyNotice, { backgroundColor: colors.warning + '20' }]}
          accessibilityRole="alert"
          accessibilityLabel={t('noteHistory.dirtyNotice')}
        >
          <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
          <Text style={[styles.dirtyNoticeText, { color: colors.warning }]}>
            {t('noteHistory.dirtyNotice')}
          </Text>
        </View>
      )}

      {/* Body */}
      <View style={styles.body}>{renderContent()}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    height: '85%',
    padding: 0,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    padding: 4,
  },
  body: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  stateText: {
    fontSize: 15,
    textAlign: 'center',
  },
  closeButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  sliderContainer: {
    flex: 1,
  },
  sliderSection: {
    paddingTop: 12,
  },
  sliderLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  sliderTrack: {
    position: 'relative',
    height: CARD_WIDTH + 24,
  },
  sliderScrollContainer: {
    flex: 1,
  },
  sliderContent: {
    paddingHorizontal: 16,
    gap: CARD_GAP,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sliderThumb: {
    position: 'absolute',
    bottom: 0,
    width: CARD_WIDTH,
    height: 4,
    borderRadius: 2,
    marginLeft: 16,
  },
  revisionCard: {
    width: CARD_WIDTH,
    height: CARD_WIDTH,
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
    justifyContent: 'flex-start',
  },
  revisionCardIndex: {
    marginBottom: 4,
  },
  revisionCardIndexText: {
    fontSize: 11,
    fontWeight: '600',
  },
  revisionCardDate: {
    fontSize: 10,
  },
  revisionCardTime: {
    fontSize: 10,
  },
  revisionCardMessage: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 14,
    flex: 1,
  },
  positionIndicator: {
    alignItems: 'center',
    marginTop: 6,
  },
  positionText: {
    fontSize: 12,
  },
  loadMoreButton: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: '500',
  },
  commitMeta: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  commitMessage: {
    fontSize: 13,
    fontWeight: '600',
  },
  commitAuthor: {
    fontSize: 12,
  },
  commitIdLabel: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  previewSection: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  previewScroll: {
    flex: 1,
  },
  previewContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  previewLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  previewLoadingText: {
    fontSize: 14,
  },
  previewError: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 8,
  },
  previewErrorText: {
    fontSize: 14,
    flex: 1,
  },
  previewEmpty: {
    padding: 24,
    alignItems: 'center',
  },
  previewEmptyText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  dirtyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  dirtyNoticeText: {
    fontSize: 13,
    flex: 1,
  },
});

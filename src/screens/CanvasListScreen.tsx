import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useCanvases } from '../contexts/CanvasContext';
import { useTheme } from '../contexts/ThemeContext';
import { useRepos } from '../contexts/RepoContext';
import { RootStackParamList } from '../navigation/types';
import { Canvas } from '../models/Canvas';
import SearchBar from '../components/SearchBar';
import { ScreenHeader, IconButton, useScreenHeaderHeight, useTabBarHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { EntityFilterModal } from '../components/EntityFilterModal';
import { ActiveFilterStrip } from '../components/ActiveFilterStrip';
import { useEntityFilter } from '../hooks/useEntityFilter';
import { useTranslation } from 'react-i18next';
import { useProGate } from '../hooks/useProGate';
import CanvasCard from '../components/CanvasCard';
import { SwipeableListItem } from '../components/list/SwipeableListItem';
import { BulkActionBar } from '../components/list/BulkActionBar';
import { HapticService } from '../utils/haptics';
import { ON_FILLED } from '../../theme/tokens';

type CanvasViewMode = 'list' | 'grid';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const CANVAS_PRESET_KEYS = ['canvases.presets.phone', 'canvases.presets.tablet', 'canvases.presets.landscape', 'canvases.presets.square', 'canvases.presets.a4'] as const;
const CANVAS_PRESET_DIMS: Record<(typeof CANVAS_PRESET_KEYS)[number], { w: number; h: number; desc: string }> = {
  'canvases.presets.phone': { w: 1080, h: 1920, desc: '1080 × 1920' },
  'canvases.presets.tablet': { w: 1536, h: 2048, desc: '1536 × 2048' },
  'canvases.presets.landscape': { w: 1920, h: 1080, desc: '1920 × 1080' },
  'canvases.presets.square': { w: 1024, h: 1024, desc: '1024 × 1024' },
  'canvases.presets.a4': { w: 794, h: 1123, desc: '794 × 1123' },
};

interface CanvasCardContainerProps {
  canvas: Canvas;
  onOpen: (id: string) => void;
  onDelete: (canvas: Canvas) => void;
}

function CanvasCardContainer({ canvas, onOpen, onDelete }: CanvasCardContainerProps) {
  const handlePress = useCallback(() => {
    onOpen(canvas.id);
  }, [canvas.id, onOpen]);

  const handleLongPress = useCallback(() => {
    onDelete(canvas);
  }, [canvas, onDelete]);

  return (
    <CanvasCard
      canvas={canvas}
      onPress={handlePress}
      onLongPress={handleLongPress}
    />
  );
}

export default function CanvasListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const { isPro, openPaywall } = useProGate();
  const headerHeight = useScreenHeaderHeight();
  const tabBarHeight = useTabBarHeight();
  const { canvases, filteredCanvases, searchQuery, setSearchQuery, deleteCanvas, refreshCanvases } = useCanvases();
  const { repositories } = useRepos();
  const filter = useEntityFilter<Canvas>(canvases);
  const displayCanvases = useMemo(() => filter.applyFilters(filteredCanvases), [filter, filteredCanvases]);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showViewModePicker, setShowViewModePicker] = useState(false);
  const [customW, setCustomW] = useState('800');
  const [customH, setCustomH] = useState('600');
  const [canvasTitle, setCanvasTitle] = useState('');
  const [viewMode, setViewMode] = useState<CanvasViewMode>('list');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const isDeletingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      refreshCanvases();
    }, [refreshCanvases]),
  );

  const handleCreate = useCallback(() => {
    if (!isPro) {
      openPaywall();
      return;
    }
    setCanvasTitle('');
    setCustomW('800');
    setCustomH('600');
    setShowSizePicker(true);
  }, [isPro, openPaywall]);

  const handlePickSize = useCallback(
    (w: number, h: number) => {
      setShowSizePicker(false);
      navigation.navigate('CanvasEditor', {
        canvasWidth: w,
        canvasHeight: h,
        canvasTitle: canvasTitle.trim() || undefined,
      });
    },
    [navigation, canvasTitle],
  );

  const handleCustomSize = useCallback(() => {
    const w = parseInt(customW, 10) || 800;
    const h = parseInt(customH, 10) || 600;
    handlePickSize(Math.max(100, Math.min(w, 4096)), Math.max(100, Math.min(h, 4096)));
  }, [customW, customH, handlePickSize]);

  const handleOpen = useCallback(
    (id: string) => {
      if (!isPro) {
        openPaywall();
        return;
      }
      navigation.navigate('CanvasEditor', { canvasId: id });
    },
    [navigation, isPro, openPaywall],
  );

  const handleDelete = useCallback(
    (canvas: Canvas) => {
      Alert.alert(t('canvases.deleteConfirmTitle'), t('canvases.deleteConfirmBody', { title: canvas.title }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteCanvas(canvas.id),
        },
      ]);
    },
    [deleteCanvas, t],
  );

  const selectionMode = selectedIds.size > 0;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || isDeletingRef.current) return;

    Alert.alert(
      t('common.deleteBulkConfirm', { count: ids.length, noun: t('canvases.canvas') }),
      t('common.cannotBeUndone'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (isDeletingRef.current) return;
            isDeletingRef.current = true;
            try {
              let failed = false;
              const selectedCanvases = canvases.filter((canvas) => selectedIds.has(canvas.id));
              for (const canvas of selectedCanvases) {
                if (!(await deleteCanvas(canvas.id))) failed = true;
              }
              if (failed) {
                HapticService.warning();
              } else {
                HapticService.success();
                clearSelection();
              }
            } finally {
              isDeletingRef.current = false;
            }
          },
        },
      ],
    );
  }, [canvases, clearSelection, deleteCanvas, selectedIds, t]);

  const handleViewModeChange = useCallback((mode: CanvasViewMode) => {
    setViewMode(mode);
    setShowViewModePicker(false);
  }, []);

  const renderCanvas = useCallback(
    ({ item }: { item: Canvas }) => (
      <SwipeableListItem
        itemId={item.id}
        selected={selectedIds.has(item.id)}
        selectionMode={selectionMode}
        onToggleSelect={() => toggleSelected(item.id)}
      >
        <CanvasCardContainer canvas={item} onOpen={handleOpen} onDelete={handleDelete} />
      </SwipeableListItem>
    ),
    [handleDelete, handleOpen, selectedIds, selectionMode, toggleSelected],
  );

  return (
    <SafeAreaView edges={['bottom']} className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="px-4 py-2" style={{ paddingTop: headerHeight + 8 }}>
        <SearchBar
          testID="canvas-list.search-bar.search"
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('canvases.searchPlaceholder')}
        />
      </View>

      <ActiveFilterStrip filter={filter} />

      <EntityFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        filter={filter}
        repositories={repositories}
      />

      <FlatList
        data={displayCanvases}
        keyExtractor={(item) => item.id}
        renderItem={renderCanvas}
        numColumns={viewMode === 'grid' ? 2 : 1}
        key={`canvases-${viewMode}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: tabBarHeight + 24 }}
        columnWrapperStyle={viewMode === 'grid' ? { gap: 12 } : undefined}
        ListEmptyComponent={
          <View className="items-center justify-center pt-15 px-6">
            <Ionicons name="easel-outline" size={48} color={colors.textSecondary} />
            <Text className="text-xl font-bold mt-4 mb-1.5" style={{ color: colors.text }}>{t('canvases.emptyTitle')}</Text>
            <Text className="text-base text-center mb-5" style={{ color: colors.textSecondary }}>
              {t('canvases.emptySubtitle')}
            </Text>
            <TouchableOpacity
              testID="canvas-list.button.create"
              className="px-6 py-3 rounded-sm"
              style={{ backgroundColor: colors.primary }}
              onPress={handleCreate}
            >
              <Text className="text-white text-base font-semibold">{t('canvases.createCanvas')}</Text>
            </TouchableOpacity>
          </View>
        }
        />

      <BulkActionBar
        count={selectedIds.size}
        itemNoun={t('canvases.canvas')}
        itemNounPlural={t('canvases.canvases')}
        bottomOffset={tabBarHeight + 12}
        onCancel={clearSelection}
        onDelete={handleBulkDelete}
      />

      <Modal
        visible={showViewModePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowViewModePicker(false)}
      >
        <TouchableOpacity
          style={styles.viewModeBackdrop}
          activeOpacity={1}
          onPress={() => setShowViewModePicker(false)}
        >
          <View style={[styles.viewModeSheet, { backgroundColor: colors.surface }]}>
            <View style={[styles.viewModeHandle, { backgroundColor: colors.border + '40' }]} />
             <Text style={[styles.viewModeTitle, { color: colors.textSecondary }]}>{t('common.viewMode')}</Text>
            <View style={styles.viewModeOptions}>
              <TouchableOpacity
                testID="canvas-view-mode.button.change-list"
                style={[styles.viewModeOption, viewMode === 'list' && { backgroundColor: colors.primary + '15' }]}
                onPress={() => handleViewModeChange('list')}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="list"
                  size={22}
                  color={viewMode === 'list' ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.viewModeLabel, { color: viewMode === 'list' ? colors.primary : colors.text }]}>
                  List
                </Text>
                {viewMode === 'list' && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
              <TouchableOpacity
                testID="canvas-view-mode.button.change-grid"
                style={[styles.viewModeOption, viewMode === 'grid' && { backgroundColor: colors.primary + '15' }]}
                onPress={() => handleViewModeChange('grid')}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="grid"
                  size={22}
                  color={viewMode === 'grid' ? colors.primary : colors.textSecondary}
                />
                <Text style={[styles.viewModeLabel, { color: viewMode === 'grid' ? colors.primary : colors.text }]}>
                  Grid
                </Text>
                {viewMode === 'grid' && <Ionicons name="checkmark" size={18} color={colors.primary} />}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showSizePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSizePicker(false)}
      >
        <TouchableOpacity
          testID="canvas-list.overlay.size-picker"
          className="flex-1 justify-center items-center p-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          activeOpacity={1}
          accessible={false}
          onPress={() => setShowSizePicker(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%' }}
          >
            <View className="w-full rounded-lg p-5" style={{ backgroundColor: colors.surface }} onStartShouldSetResponder={() => true}>
            <Text className="text-lg font-bold text-center mb-3" style={{ color: colors.text }}>{t('canvases.newCanvas')}</Text>

            <TextInput
              testID="canvas-list.input.title"
              className="border rounded-sm px-3 py-2.5 text-base mb-3.5"
              style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
              value={canvasTitle}
              onChangeText={setCanvasTitle}
              placeholder={t('canvases.namePlaceholder')}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="sentences"
              maxLength={60}
            />

            {CANVAS_PRESET_KEYS.map((key) => {
              const dims = CANVAS_PRESET_DIMS[key];
              const label = t(key);
              return (
                <TouchableOpacity
                  key={key}
                  testID={`canvas-list.button.pick-size-${label.toLowerCase()}`}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${label}, ${dims.desc}`}
                  className="flex-row justify-between items-center py-3 px-4 rounded-sm border mb-2"
                  style={{ borderColor: colors.border }}
                  onPress={() => handlePickSize(dims.w, dims.h)}
                  activeOpacity={0.7}
                >
                  <Text className="text-base font-semibold" style={{ color: colors.text }}>{label}</Text>
                  <Text className="text-xs font-mono" style={{ color: colors.textSecondary }}>{dims.desc}</Text>
                </TouchableOpacity>
              );
            })}

            <Text className="text-xs font-semibold uppercase mt-2 mb-2" style={{ color: colors.textSecondary }}>{t('canvases.customSize')}</Text>
            <View className="flex-row items-center gap-2 mb-3">
              <TextInput
                testID="canvas-list.input.custom-width"
                className="flex-1 border rounded-sm px-3 py-2.5 text-base font-mono"
                style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
                value={customW}
                onChangeText={setCustomW}
                keyboardType="number-pad"
                placeholder={t('canvases.widthPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                maxLength={4}
              />
              <Text className="text-lg font-semibold" style={{ color: colors.textSecondary }}>×</Text>
              <TextInput
                testID="canvas-list.input.custom-height"
                className="flex-1 border rounded-sm px-3 py-2.5 text-base font-mono"
                style={{ backgroundColor: colors.background, color: colors.text, borderColor: colors.border }}
                value={customH}
                onChangeText={setCustomH}
                keyboardType="number-pad"
                placeholder={t('canvases.heightPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                maxLength={4}
              />
            </View>

            <TouchableOpacity
              className="py-3 rounded-sm items-center mb-2"
              style={{ backgroundColor: colors.primary }}
              onPress={handleCustomSize}
            >
              <Text className="text-white text-base font-semibold">{t('canvases.createCustom')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="py-3 rounded-sm border items-center"
              style={{ borderColor: colors.border }}
              onPress={() => setShowSizePicker(false)}
            >
              <Text className="text-base" style={{ color: colors.textSecondary }}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
      <ScreenHeader
        title={t('canvases.title')}
        onBack={() => navigation.goBack()}
        actions={
          <>
            <IconButton
              size="sm"
              testID="canvas-list.icon-button.view-mode"
              onPress={() => setShowViewModePicker(true)}
              accessibilityLabel={t('common.viewMode')}
            >
              <Ionicons
                name={viewMode === 'list' ? 'list' : 'grid'}
                size={18}
                color={colors.textSecondary}
              />
            </IconButton>
            <IconButton
              size="sm"
              testID="canvas-list.icon-button.filters"
              active={filter.activeCount > 0}
              onPress={() => setShowFilterModal(true)}
              accessibilityLabel={t('common.filters')}
            >
              <Ionicons
                name="funnel-outline"
                size={18}
                color={filter.activeCount > 0 ? colors.accent : colors.textSecondary}
              />
            </IconButton>
            <IconButton size="sm" testID="canvas-list.icon-button.new-canvas" onPress={handleCreate} accessibilityLabel={t('canvases.newCanvasA11y')}>
              <Ionicons name="add" size={20} color={colors.accent} />
            </IconButton>
          </>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  viewModeBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  viewModeSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  viewModeHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  viewModeTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  viewModeOptions: {
    paddingHorizontal: 12,
  },
  viewModeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 12,
  },
  viewModeLabel: {
    fontSize: 16,
    flex: 1,
  },
});

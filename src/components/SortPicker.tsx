import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useTheme } from '../contexts/ThemeContext';
import { Modal } from './ui';
import { EntityType, SortDirection, SortField, SortMode } from '../types/SortTypes';

export interface SortPickerProps {
  currentSort: SortMode;
  onSortChange: (mode: SortMode) => void;
  entityType: EntityType;
  /**
   * `chip` matches the 32px filter-chip row used in NotesListHeader.
   * `bar` matches the 40px SearchBar row used in TodosListHeader.
   */
  size?: 'chip' | 'bar';
  iconOnly?: boolean;
}

const SORT_FIELDS: Array<{ field: SortField; label: string }> = [
  { field: 'modified', label: 'Modified' },
  { field: 'created', label: 'Created' },
  { field: 'title', label: 'Title' },
];

const DIRECTION_LABELS: Record<SortField, Record<SortDirection, string>> = {
  modified: { asc: 'Oldest', desc: 'Newest' },
  created: { asc: 'Oldest', desc: 'Newest' },
  title: { asc: 'A-Z', desc: 'Z-A' },
};

function isSortField(value: unknown): value is SortField {
  return value === 'modified' || value === 'created' || value === 'title';
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === 'asc' || value === 'desc';
}

function parseStoredSort(value: string | null): SortMode | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<SortMode>;
    if (!isSortField(parsed.field) || !isSortDirection(parsed.direction)) return null;
    return { field: parsed.field, direction: parsed.direction };
  } catch {
    return null;
  }
}

function formatSortLabel(mode: SortMode): string {
  return `${DIRECTION_LABELS[mode.field][mode.direction]} ${SORT_FIELDS.find((item) => item.field === mode.field)?.label ?? ''}`;
}

export default function SortPicker({ currentSort, onSortChange, entityType, size = 'chip', iconOnly = false }: SortPickerProps) {
  const { colors, tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true);
  const isBar = size === 'bar';
  const triggerHeight = isBar ? 44 : 32;
  const triggerPadH = isBar ? 14 : 10;
  const triggerRadius = triggerHeight / 2;
  const triggerGap = isBar ? 6 : 4;
  const iconSize = isBar ? 18 : 14;
  const textSize = isBar ? 13 : 12;

  const storageKey = useMemo(() => `sort-${entityType}`, [entityType]);

  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(storageKey)
      .then((stored) => {
        if (!active) return;
        const parsed = parseStoredSort(stored);
        if (parsed) onSortChange(parsed);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsHydrating(false);
      });

    return () => {
      active = false;
    };
  }, [onSortChange, storageKey]);

  const persistSort = useCallback(
    (mode: SortMode) => {
      AsyncStorage.setItem(storageKey, JSON.stringify(mode)).catch(() => undefined);
    },
    [storageKey],
  );

  const handleSelect = useCallback(
    (mode: SortMode) => {
      persistSort(mode);
      onSortChange(mode);
      setOpen(false);
    },
    [onSortChange, persistSort],
  );

  return (
    <>
      <TouchableOpacity
        testID="sort-picker-trigger"
        accessibilityRole="button"
        accessibilityLabel="Sort options"
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: triggerHeight,
          gap: triggerGap,
          paddingHorizontal: triggerPadH,
          borderRadius: triggerRadius,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Ionicons name="swap-vertical" size={iconSize} color={colors.primary} />
        {!iconOnly && <Text style={{ color: colors.textSecondary, fontSize: textSize }}>{formatSortLabel(currentSort)}</Text>}
      </TouchableOpacity>

      <Modal visible={open} onRequestClose={() => setOpen(false)} fullWidth>
        <View style={{ padding: tokens.spacing[4], gap: tokens.spacing[4] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Sort</Text>
            <Pressable testID="sort-picker-close" onPress={() => setOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {isHydrating ? (
            <ActivityIndicator testID="sort-picker-loading" color={colors.primary} />
          ) : (
            SORT_FIELDS.map(({ field, label }) => (
              <View key={field} style={{ gap: tokens.spacing[2] }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, textTransform: 'uppercase' }}>{label}</Text>
                <View style={{ flexDirection: 'row', gap: tokens.spacing[2] }}>
                  {(['desc', 'asc'] as SortDirection[]).map((direction) => {
                    const selected = currentSort.field === field && currentSort.direction === direction;
                    return (
                      <TouchableOpacity
                        key={`${field}-${direction}`}
                        testID={`sort-option-${field}-${direction}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => handleSelect({ field, direction })}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          paddingVertical: tokens.spacing[3],
                          paddingHorizontal: tokens.spacing[3],
                          borderRadius: tokens.radii.md,
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary + '18' : colors.surfaceSecondary,
                        }}
                      >
                        <Text style={{ color: selected ? colors.primary : colors.text, fontSize: 14, fontWeight: '500' }}>
                          {DIRECTION_LABELS[field][direction]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))
          )}
        </View>
      </Modal>
    </>
  );
}

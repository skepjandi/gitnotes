import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useTheme } from '../contexts/ThemeContext';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useRepos } from '../contexts/RepoContext';
import { useRenderStyleStore } from '../stores/renderStyleStore';
import { RenderStyleService, DiscoveredBinding } from '../services/RenderStyleService';
import { RENDER_FORMATS, formatLabel } from '../types/RenderStyle';
import { GitHubService } from '../services/GitHubService';
import { Chip } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RenderStyleSettings'>;

export default function RenderStyleSettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { colors } = useTheme();
  const { repositories } = useRepos();
  const binding = useRenderStyleStore((s) => s.binding);
  const settings = useRenderStyleStore((s) => s.settings);
  const isLoading = useRenderStyleStore((s) => s.isLoading);
  const setBinding = useRenderStyleStore((s) => s.setBinding);
  const error = useRenderStyleStore((s) => s.error);

  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredBinding[]>([]);

  useEffect(() => {
    if (!showRepoPicker) return;
    let cancelled = false;
    setDiscovering(true);
    void (async () => {
      const isAuthAvailable = await GitHubService.isAuthenticatedAsync();
      if (cancelled) return;
      if (!isAuthAvailable) {
        setDiscovering(false);
        return;
      }
      const result = await RenderStyleService.discoverExisting();
      if (!cancelled) setDiscovered(result);
      if (!cancelled) setDiscovering(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [showRepoPicker]);

  const handlePickRepo = useCallback(
    async (owner: string, name: string, branch: string) => {
      await setBinding({ owner, name, branch });
      setShowRepoPicker(false);
    },
    [setBinding],
  );

  const handleClearBinding = useCallback(() => {
    Alert.alert(
      'Disconnect render styles repo?',
      'Render styles will reset to theme defaults until you re-bind a repo. The settings/render.json file in the repo is left untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => void setBinding(null) },
      ],
    );
  }, [setBinding]);

  const overrideCount = useMemo(
    () => Object.values(settings.formats).filter(Boolean).length,
    [settings],
  );

  const blocked = useProScreenGuard();

  if (blocked) return null;

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="flex-row items-center justify-between px-4 py-3 border-b" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text className="text-[17px] font-semibold" style={{ color: colors.text }}>Note rendering</Text>
        <View className="w-6" />
      </View>

      <ScrollView contentContainerClassName="pb-8">
        <Text className="text-xs font-semibold uppercase tracking-wide px-4 mt-4 mb-2" style={{ color: colors.textSecondary, letterSpacing: 0.5 }}>Storage</Text>
        <View className="rounded-sm mx-3 py-1" style={{ backgroundColor: colors.surface }}>
          {binding ? (
            <>
              <View className="flex-row items-center gap-3 px-4 py-3">
                <Ionicons name="cloud-outline" size={18} color={colors.textSecondary} />
                <View className="flex-1">
                  <Text className="text-[15px] font-medium" style={{ color: colors.text }}>{binding.owner}/{binding.name}</Text>
                  <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                    settings/render.json on {binding.branch}
                  </Text>
                </View>
                {isLoading ? <ActivityIndicator color={colors.primary} /> : null}
              </View>
              <TouchableOpacity className="flex-row items-center gap-3 px-4 py-3" onPress={() => setShowRepoPicker(true)}>
                <Ionicons name="repeat" size={18} color={colors.primary} />
                <Text className="text-[15px] font-medium" style={{ color: colors.primary }}>Change repo</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-row items-center gap-3 px-4 py-3" onPress={handleClearBinding}>
                <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                <Text className="text-[15px] font-medium" style={{ color: colors.error }}>Disconnect</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity className="flex-row items-center gap-3 px-4 py-3" onPress={() => setShowRepoPicker(true)}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text className="text-[15px] font-medium" style={{ color: colors.primary }}>Pick a repo for render styles</Text>
            </TouchableOpacity>
          )}
          {error ? <Text className="text-xs px-4 pt-1" style={{ color: colors.error }}>{error}</Text> : null}
          <Text className="text-xs leading-[18px] px-4 pt-2 pb-3" style={{ color: colors.textSecondary }}>
            Styles persist to {binding ? `${binding.owner}/${binding.name}/settings/render.json` : 'a repo of your choice'} so they sync across devices. Active overrides: {overrideCount}.
          </Text>
        </View>

        <Text className="text-xs font-semibold uppercase tracking-wide px-4 mt-4 mb-2" style={{ color: colors.textSecondary, letterSpacing: 0.5 }}>Formats</Text>
        <View className="rounded-sm mx-3 py-1" style={{ backgroundColor: colors.surface }}>
          {RENDER_FORMATS.map((fmt) => {
            const hasOverrides = !!settings.formats[fmt] && Object.keys(settings.formats[fmt] ?? {}).length > 0;
            const isBeta = fmt === 'neorg';
            return (
              <TouchableOpacity
                key={fmt}
                className="flex-row items-center px-4 py-3.5 border-b"
                style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
                onPress={() => navigation.navigate('RenderStyleEditor', { format: fmt })}
              >
                <View className="flex-1">
                  <View className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-[15px] font-medium" style={{ color: colors.text }}>{formatLabel(fmt)}</Text>
                    {isBeta ? <Chip label="BETA" /> : null}
                  </View>
                  <Text className="text-xs mt-0.5" style={{ color: colors.textSecondary }}>
                    {hasOverrides ? 'Custom overrides applied' : 'Theme defaults'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            );
          })}
        </View>

        <Text className="text-xs leading-[18px] px-4 pt-2 pb-3" style={{ color: colors.textSecondary }}>
          Tip: pick the same repo where you store notes so render styles travel with the content.
        </Text>
      </ScrollView>

      {showRepoPicker ? (
        <RepoPickerSheet
          repositories={repositories.map((r) => ({ owner: r.path.split('/')[0] ?? '', name: r.path.split('/')[1] ?? r.name, label: r.path }))}
          discovered={discovered}
          discovering={discovering}
          onClose={() => setShowRepoPicker(false)}
          onSelect={(owner, name, branch) => handlePickRepo(owner, name, branch)}
        />
      ) : null}
    </SafeAreaView>
  );
}

interface RepoChoice {
  owner: string;
  name: string;
  label: string;
}

interface RepoPickerProps {
  repositories: RepoChoice[];
  discovered: DiscoveredBinding[];
  discovering: boolean;
  onClose: () => void;
  onSelect: (owner: string, name: string, branch: string) => void;
}

function RepoPickerSheet(props: RepoPickerProps) {
  const { repositories, discovered, discovering, onClose, onSelect } = props;
  const { colors } = useTheme();

  return (
    <View
      className="absolute inset-0 justify-end"
      style={{ backgroundColor: colors.background + 'cc' }}
    >
      <View
        className="border-tl-2xl border-tr-2xl border max-h-[80%]"
        style={{ backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <View className="flex-row justify-between items-center px-4 py-3.5 border-b" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text className="text-base font-semibold" style={{ color: colors.text }}>Pick a repo</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerClassName="pb-6">
          {discovering ? (
            <View className="flex-row items-center gap-3 px-4 py-3">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}

          {discovered.length > 0 ? (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wide px-4 mt-3 mb-2" style={{ color: colors.textSecondary, letterSpacing: 0.5 }}>
                {discovered.length === 1 ? 'Existing render styles repo found' : `${discovered.length} repos already host render styles`}
              </Text>
              {discovered.map((d) => (
                <TouchableOpacity
                  key={`${d.owner}/${d.name}`}
                  className="flex-row items-center px-4 py-3.5 border-b"
                  style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
                  onPress={() => onSelect(d.owner, d.name, d.branch)}
                >
                  <Ionicons name="cloud-done-outline" size={18} color={colors.primary} />
                  <Text className="text-[15px] font-medium flex-1 ml-2" style={{ color: colors.text }}>{d.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </>
          ) : null}

          <Text className="text-xs font-semibold uppercase tracking-wide px-4 mt-4 mb-2" style={{ color: colors.textSecondary, letterSpacing: 0.5 }}>Your repos</Text>
          {repositories.length === 0 ? (
            <Text className="text-xs leading-[18px] px-4 pt-2 pb-3" style={{ color: colors.textSecondary }}>
              Add a repo from Settings → Repositories first.
            </Text>
          ) : (
            repositories.map((r) => (
              <TouchableOpacity
                key={`${r.owner}/${r.name}`}
                className="flex-row items-center px-4 py-3.5 border-b"
                style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
                onPress={() => onSelect(r.owner, r.name, 'main')}
              >
                <Ionicons name="git-branch-outline" size={18} color={colors.text} />
                <Text className="text-[15px] font-medium flex-1 ml-2" style={{ color: colors.text }}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}

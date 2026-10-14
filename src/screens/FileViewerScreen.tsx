import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../contexts/ThemeContext';
import { GitHubService } from '../services/GitHubService';
import FileContentRenderer from '../components/FileContentRenderer';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { HapticService } from '../utils/haptics';
import { classifyFile } from '../utils/fileLanguage';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export default function FileViewerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'FileViewer'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'FileViewer'>>();
  const { owner, repo, branch, path, title, size } = route.params;
  const { colors, isDark } = useTheme();

  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileName = useMemo(() => path.split('/').pop() ?? path, [path]);
  const classification = useMemo(() => classifyFile(fileName), [fileName]);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    (async () => {
      const result = await GitHubService.getFileContent(owner, repo, path, branch);
      if (cancelled) return;
      if (result === null) {
        setError('Could not load file content from GitHub.');
        return;
      }
      setContent(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, path]);

  const handleOpenNote = useMemo(
    () =>
      (targetPath: string, _fragment?: string): boolean => {
        const targetTitle = targetPath.split('/').pop() ?? targetPath;
        navigation.navigate('FileViewer', {
          owner,
          repo,
          branch,
          path: targetPath,
          title: targetTitle,
        });
        return true;
      },
    [navigation, owner, repo, branch],
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1" style={{ backgroundColor: colors.background }}>
      <View
        className="flex-row items-center px-2 py-2 border-b"
        style={{ borderBottomWidth: 0.5, borderBottomColor: colors.border, backgroundColor: colors.surface }}
      >
        <TouchableOpacity
          testID="file-viewer.icon-button.back"
          onPress={() => { HapticService.light(); navigation.goBack(); }}
          className="p-2 w-10"
        >
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <View className="flex-1 px-1">
          <Text className="text-base font-semibold" style={{ color: colors.text }} numberOfLines={1}>
            {title || fileName}
          </Text>
          <Text className="text-[11px] mt-0.5" style={{ color: colors.textSecondary }} numberOfLines={1}>
            {[classification.mode.toUpperCase(), formatBytes(size), branch ?? 'main'].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View className="p-2 w-10" />
      </View>

      {error ? (
        <View className="flex-1 items-center justify-center p-6 gap-3" testID="file-viewer.error">
          <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
          <Text className="text-sm text-center" style={{ color: colors.error }}>{error}</Text>
        </View>
      ) : content == null ? (
        <View className="flex-1 items-center justify-center p-6 gap-3" testID="file-viewer.loading">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="p-4 pb-10"
          showsVerticalScrollIndicator
        >
          <FileContentRenderer
            content={content}
            path={fileName}
            classification={classification}
            isDark={isDark}
            colors={colors}
            onOpenNote={handleOpenNote}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

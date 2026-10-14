import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';

import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { GitFsService } from '@/services/git/GitFsService';
import { isBinaryPath } from '@/components/explore/exploreShared';
import { useRepoStore } from '@/stores/repoStore';
import { useTokens, useTheme } from '@/contexts/ThemeContext';
import type { RootStackParamList } from '@/navigation/types';
import { parseLfsPointer } from '@/services/git/lfs';
import { WorkingTreeDocumentService, workingTreeDocument } from '@/services/documents/WorkingTreeDocumentService';
import { useCheckoutSafety } from '@/contexts/CheckoutSafetyContext';
import { GitBranchCoordinator } from '@/services/git/GitBranchCoordinator';
import { subscribeGitContentRefresh } from '@/hooks/useGitRefreshEvent';
import FileContentRenderer from '@/components/FileContentRenderer';
import { classifyFile } from '@/utils/fileLanguage';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ExploreFile'>;

/** View and edit a single file from the local working tree.
 * Plain-text editor for non-binary, non-LFS-pointer files.
 * Binary and LFS pointer files are shown as read-only placeholders. */
export default function ExploreFileScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<Route>();
  const { colors } = useTokens();
  const { repoId, path: filePath } = route.params;

  useEffect(() => {
    return subscribeGitContentRefresh((event) => {
      if (event.kind === 'checkout') {
        navigation.navigate('MainTabs', { screen: 'ExploreTab' });
      }
    });
  }, [navigation]);

  const storedRepo = useRepoStore((state) =>
    state.repositories.find((candidate) => candidate.id === repoId),
  );

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorText, setEditorText] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const checkoutSafety = useCheckoutSafetySafe();
  const isCheckingOut = checkoutSafety?.isCheckingOut ?? false;

  const fileName = useMemo(() => filePath.split('/').pop() ?? filePath, [filePath]);

  const isBinary = useMemo(() => isBinaryPath(filePath), [filePath]);

  const isLfsPointer = useMemo(
    () => (content != null ? parseLfsPointer(content) !== null : false),
    [content],
  );

  const isReadOnly = isBinary || isLfsPointer;

  const fileLanguage = useMemo(() => classifyFile(filePath), [filePath]);

  const [mode, setMode] = useState<'preview' | 'edit'>(
    () => fileLanguage.mode === 'plain' ? 'edit' : 'preview',
  );

  const eligibleForPreview = useMemo(
    () => !isBinary && !isLfsPointer && fileLanguage.mode !== 'plain',
    [isBinary, isLfsPointer, fileLanguage.mode],
  );

  const { isDark } = useTheme();

  useEffect(() => {
    if (!storedRepo) return;
    if (isBinary) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setContent(null);
    setError(null);
    setLoading(true);
    setIsDirty(false);
    setSaveError(null);
    setSavedAt(null);
    setMode(fileLanguage.mode === 'plain' ? 'edit' : 'preview');
    (async () => {
      try {
        const workingTreeUri = GitFsService.workingTreeUri({ repoPath: storedRepo.path });
        const fullPath = `${workingTreeUri}/${filePath}`;
        const file = new File(fullPath);
        if (!file.exists) {
          if (!cancelled) setError('File not found in working tree.');
          return;
        }
        const result = await file.text();
        if (cancelled) return;
        setContent(result);
        setEditorText(result);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedRepo, filePath, isBinary, fileLanguage.mode]);

  const handleSave = useCallback(async () => {
    if (isSaving || isCheckingOut || !isDirty || !storedRepo) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const workingTreeUri = GitFsService.workingTreeUri({ repoPath: storedRepo.path });
      const doc = workingTreeDocument(filePath, editorText, 'explore');
      const service = new WorkingTreeDocumentService(workingTreeUri, filePath, doc);
      await service.update(doc.id, { body: editorText });
      setIsDirty(false);
      setSavedAt(Date.now());
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, isCheckingOut, isDirty, storedRepo, editorText, filePath]);

  const handleCancel = useCallback(() => {
    if (!isDirty) {
      navigation.goBack();
      return;
    }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes that will be lost.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => navigation.goBack(),
        },
      ],
    );
  }, [isDirty, navigation]);

  const handleBack = useCallback(() => {
    if (isDirty) {
      Alert.alert(
        'Discard changes?',
        'You have unsaved changes that will be lost.',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => navigation.goBack(),
          },
        ],
      );
    } else {
      navigation.goBack();
    }
  }, [isDirty, navigation]);

  if (!storedRepo) {
    return (
      <SafeAreaView className="flex-1" style={{ flex: 1, backgroundColor: colors.background }}>
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Text style={{ color: colors.textSecondary }}>Repository not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1" style={{ flex: 1, backgroundColor: colors.background }} testID="explore-file.root">
      <View
        className="flex-row items-center gap-2 px-4 py-2.5"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Pressable
          onPress={handleBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="explore-file.back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Heading className="text-lg" style={{ color: colors.text }} numberOfLines={1}>
            {fileName}
          </Heading>
          <Text className="text-xs font-mono" style={{ color: colors.textSecondary }} numberOfLines={1}>
            {filePath}
          </Text>
        </View>

        {!loading && !error && content != null && !isReadOnly && eligibleForPreview && (
          <Pressable
            onPress={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={mode === 'preview' ? 'Switch to edit mode' : 'Switch to preview mode'}
            testID="explore-file.mode-toggle"
            style={({ pressed }) => [
              styles.headerAction,
              {
                backgroundColor: mode === 'edit'
                  ? colors.accent + '1a'
                  : colors.accent + '12',
                borderColor: mode === 'edit'
                  ? colors.accent + '66'
                  : colors.accent + '33',
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Ionicons
              name={mode === 'preview' ? 'create-outline' : 'eye-outline'}
              size={16}
              color={colors.accent}
            />
            <Text style={{ color: colors.accent, fontWeight: '700' }}>
              {mode === 'preview' ? 'Edit' : 'Preview'}
            </Text>
          </Pressable>
        )}

        {!loading && !error && content != null && !isReadOnly && mode === 'edit' && (
          <>
            <Pressable
              onPress={handleCancel}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              testID="explore-file.cancel"
              disabled={isSaving}
              style={({ pressed }) => [
                styles.headerAction,
                {
                  backgroundColor: isSaving ? colors.surfaceSecondary : colors.error + '10',
                  borderColor: isSaving ? colors.border : colors.error + '44',
                  opacity: pressed && !isSaving ? 0.72 : 1,
                },
              ]}
            >
              <Ionicons
                name="close-outline"
                size={16}
                color={isSaving ? colors.textSecondary : colors.error}
              />
              <Text style={{ color: isSaving ? colors.textSecondary : colors.error, fontWeight: '600' }}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              testID="explore-file.save"
              disabled={isSaving || !isDirty || isCheckingOut}
              style={({ pressed }) => [
                styles.headerAction,
                {
                  backgroundColor: isSaving || !isDirty || isCheckingOut
                    ? colors.surfaceSecondary
                    : colors.accent,
                  borderColor: isSaving || !isDirty || isCheckingOut
                    ? colors.border
                    : colors.accent,
                  opacity: pressed && !(isSaving || !isDirty || isCheckingOut) ? 0.8 : 1,
                },
              ]}
            >
              <Ionicons
                name={savedAt ? 'checkmark-circle-outline' : 'save-outline'}
                size={16}
                color={isSaving || !isDirty || isCheckingOut ? colors.textSecondary : colors.background}
              />
              <Text
                style={{
                  color: isSaving || !isDirty || isCheckingOut ? colors.textSecondary : colors.background,
                  fontWeight: '700',
                }}
              >
                {isSaving ? 'Saving…' : savedAt ? 'Saved' : 'Save'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {error ? (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
          <Text className="mt-2 text-center text-sm" style={{ color: colors.error }} testID="explore-file.error">{error}</Text>
        </View>
      ) : loading ? (
        <View className="flex-1 items-center justify-center gap-2" style={{ flex: 1 }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={{ color: colors.textSecondary }}>Reading file…</Text>
        </View>
      ) : isBinary ? (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="cube-outline" size={44} color={colors.textSecondary} />
          <Text className="mt-2 text-center" style={{ color: colors.textSecondary }} testID="explore-file.binary-message">
            Binary file — no textual preview available.
          </Text>
        </View>
      ) : content == null ? (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="document-outline" size={40} color={colors.textSecondary} />
          <Text className="mt-2 text-center text-sm" style={{ color: colors.textSecondary }}>
            Empty file.
          </Text>
        </View>
      ) : isLfsPointer ? (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="git-branch-outline" size={44} color={colors.textSecondary} />
          <Text className="mt-2 text-center" style={{ color: colors.textSecondary }} testID="explore-file.lfs-pointer-message">
            LFS pointer file — content is stored in Git LFS.
          </Text>
        </View>
      ) : mode === 'preview' && eligibleForPreview ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pb-10"
          testID="explore-file.preview-content"
        >
          <FileContentRenderer
            content={content}
            path={filePath}
            classification={fileLanguage}
            isDark={isDark}
            colors={colors}
          />
        </ScrollView>
      ) : (
        <ScrollView className="flex-1" keyboardDismissMode="interactive">
          <TextInput
            testID="explore-file.editor"
            style={{
              flex: 1,
              color: colors.text,
              fontSize: 14,
              lineHeight: 20,
              paddingHorizontal: 16,
              paddingVertical: 12,
              fontFamily: 'monospace',
            }}
            value={editorText}
            onChangeText={(text) => {
              setEditorText(text);
              setIsDirty(text !== content);
              setSavedAt(null);
            }}
            multiline
            scrollEnabled={false}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
            placeholder="Empty file"
            placeholderTextColor={colors.textSecondary}
            editable={!isSaving && !isCheckingOut}
          />
        </ScrollView>
      )}

      {saveError && (
        <View
          className="px-4 py-3"
          style={{ borderTopWidth: 1, borderTopColor: colors.error }}
        >
          <Text style={{ color: colors.error }} testID="explore-file.save-error">
            {saveError}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = {
  headerAction: {
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: 4,
  },
};

/** Fallback checkout safety using GitBranchCoordinator when outside provider context. */
function useCheckoutSafetySafe(): { isCheckingOut: boolean } | null {
  try {
    return useCheckoutSafety();
  } catch {
    const [isCheckingOut, setIsCheckingOut] = useState(
      GitBranchCoordinator.getState() === 'checkout-running',
    );
    useEffect(() => {
      const unsubscribe = GitBranchCoordinator.onStateChange((state) => {
        setIsCheckingOut(state === 'checkout-running');
      });
      return unsubscribe;
    }, []);
    return isCheckingOut ? { isCheckingOut } : null;
  }
}

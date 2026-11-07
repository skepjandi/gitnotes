import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { Button } from '@/components/ui/Button';
import * as GitEngine from '@/services/git/engine/GitEngine';
import type { ConflictBlobs } from '@/services/git/engine/GitEngine';
import { GitFsService } from '@/services/git/GitFsService';
import {
  computeCrdtMerge,
  computeSidecarOnlyMerge,
  getConflictChoiceContent,
  resolveConflictAndSync,
  resolveSidecarConflictAndSync,
  type ConflictChoice,
} from '@/services/git/conflictResolution';
import { isCrdtNotePath, notePathForSidecar } from '@/services/crdt/crdtSidecar';
import { useRepoStore } from '@/stores/repoStore';
import { useGitButtonActionStore } from '@/stores/gitButtonActionStore';
import { useTokens } from '@/contexts/ThemeContext';
import type { RootStackParamList } from '@/navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'ConflictResolve'>;

export default function ConflictResolveScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<Route>();
  const { colors } = useTokens();
  const { repoId, path } = route.params;
  const setPending = useGitButtonActionStore((s) => s.setPending);

  const storedRepo = useRepoStore((state) =>
    state.repositories.find((candidate) => candidate.id === repoId),
  );

  let localPath: string | null = null;
  let fileUri: string | null = null;
  if (storedRepo) {
    try {
      localPath = GitFsService.workingTreeUri({ repoPath: storedRepo.path });
      if (localPath) fileUri = `${localPath}/${path}`;
    } catch {
      localPath = null;
    }
  }

  const [rawContent, setRawContent] = useState('');
  const [blobs, setBlobs] = useState<ConflictBlobs | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<ConflictChoice | 'crdt'>('edit');
  const [crdtMerged, setCrdtMerged] = useState<string | null>(null);
  const sidecarNotePath = storedRepo?.crdtMergeEnabled ? notePathForSidecar(path) : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!fileUri || fileUri.trim() === '' || !localPath) {
      setError('File not found on device. The repository may not be cloned.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (storedRepo && sidecarNotePath) {
          const merged = await computeSidecarOnlyMerge(storedRepo, sidecarNotePath);
          if (!cancelled) {
            setCrdtMerged(merged);
            setSelectedChoice('crdt');
            setRawContent(merged);
          }
          return;
        }
        const blobs = await GitEngine.getConflictBlobs(localPath, path);
        if (!cancelled) {
          if (blobs.ours === '' && blobs.theirs === '') {
            setError('File is empty. The conflict may already be resolved.');
          } else {
            setBlobs(blobs);
            setRawContent(getConflictChoiceContent(blobs, 'edit'));
          }
        }
        if (storedRepo?.crdtMergeEnabled && isCrdtNotePath(path)) {
          const merged = await computeCrdtMerge(storedRepo, path).catch((caught: unknown) => {
            console.warn('[ConflictResolve] CRDT merge unavailable:', caught);
            return null;
          });
          if (!cancelled && merged !== null) {
            setCrdtMerged(merged);
            setSelectedChoice('crdt');
            setRawContent(merged);
          }
        }
      } catch (caught) {
        if (!cancelled) {
          const msg = caught instanceof Error ? caught.message : String(caught);
          setError(msg || 'Failed to read file. The conflict may already be resolved.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUri, localPath, path, storedRepo, sidecarNotePath]);

  const handleResolve = async () => {
    if (!storedRepo || !fileUri || !localPath) return;
    setResolving(true);
    try {
      if (sidecarNotePath) {
        await resolveSidecarConflictAndSync(storedRepo, sidecarNotePath, rawContent);
      } else {
        await resolveConflictAndSync(storedRepo, path, rawContent);
      }
      setPending({ repoId, section: 'staging' });
      navigation.navigate('MainTabs', { screen: 'ExploreTab' });
    } catch (caught) {
      setResolving(false);
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.includes('already-running')) {
        navigation.navigate('MainTabs', { screen: 'ExploreTab' });
      } else {
        Alert.alert(
          'Failed to resolve',
          message,
        );
      }
    }
  };

  const handleChoice = (choice: ConflictChoice) => {
    if (!blobs || resolving) return;
    setSelectedChoice(choice);
    setRawContent(getConflictChoiceContent(blobs, choice));
  };

  const handleCrdtChoice = () => {
    if (crdtMerged === null || resolving) return;
    setSelectedChoice('crdt');
    setRawContent(crdtMerged);
  };

  if (!storedRepo || !localPath || !fileUri) {
    return (
      <SafeAreaView
        edges={['top']}
        className="flex-1"
        testID="conflict-resolve.screen"
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <View className="flex-row items-center gap-2 px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Heading className="text-lg" style={{ color: colors.text }}>Resolve conflict</Heading>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="warning-outline" size={40} color={colors.error} />
          <Text className="mt-2 text-center text-sm" style={{ color: colors.textSecondary }}>
            Repository not found.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      className="flex-1"
      testID="conflict-resolve.screen"
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View
        className="flex-row items-center gap-2 px-4 py-3"
        style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          testID="conflict-resolve.back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Heading className="text-lg" style={{ color: colors.text }}>Resolve conflict</Heading>
          <Text className="text-xs" style={{ color: colors.textSecondary }} numberOfLines={1}>
            {path}
          </Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-2" style={{ flex: 1 }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text className="text-sm" style={{ color: colors.textSecondary }}>Reading file…</Text>
        </View>
      ) : error || !rawContent ? (
        <View className="flex-1 items-center justify-center px-8" style={{ flex: 1 }}>
          <Ionicons name="warning-outline" size={40} color={colors.error} />
          <Text className="mt-2 text-center text-sm" style={{ color: colors.error }}>
            {error || 'File not found or empty. The conflict may already be resolved.'}
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          className="flex-1"
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            className="flex-1"
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="text-xs font-semibold mb-2" style={{ color: colors.textSecondary }}>
              Choose a version or edit the combined file below, then tap Mark resolved.
            </Text>
            <View className="gap-2 mb-4">
              {crdtMerged !== null ? (
                <Button
                  size="sm"
                  variant={selectedChoice === 'crdt' ? 'primary' : 'outline'}
                  disabled={resolving}
                  onPress={handleCrdtChoice}
                  testID="conflict-resolve.use-crdt"
                >
                  Use CRDT merge
                </Button>
              ) : null}
              {blobs ? (
                <>
                  <Button
                    size="sm"
                    variant={selectedChoice === 'ours' ? 'primary' : 'outline'}
                    disabled={resolving}
                    onPress={() => handleChoice('ours')}
                    testID="conflict-resolve.accept-ours"
                  >
                    Accept ours
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedChoice === 'theirs' ? 'primary' : 'outline'}
                    disabled={resolving}
                    onPress={() => handleChoice('theirs')}
                    testID="conflict-resolve.accept-theirs"
                  >
                    Accept theirs
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedChoice === 'both' ? 'primary' : 'outline'}
                    disabled={resolving}
                    onPress={() => handleChoice('both')}
                    testID="conflict-resolve.accept-both"
                  >
                    Accept both
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedChoice === 'edit' ? 'primary' : 'outline'}
                    disabled={resolving}
                    onPress={() => handleChoice('edit')}
                    testID="conflict-resolve.full-edit"
                  >
                    Full edit
                  </Button>
                </>
              ) : null}
            </View>
            <View
              className="rounded-lg mb-4 p-3"
              style={{ backgroundColor: colors.card, borderColor: colors.error, borderWidth: 2 }}
            >
              <TextInput
                testID="conflict-resolve.editor"
                className="text-sm font-mono min-h-[300]"
                style={{
                  color: colors.text,
                  backgroundColor: colors.surface,
                  borderRadius: 8,
                  padding: 12,
                  minHeight: 300,
                }}
                multiline
                value={rawContent}
                onChangeText={setRawContent}
                placeholder="File content with conflict markers…"
                placeholderTextColor={colors.textSecondary}
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Button
              variant="primary"
              disabled={resolving}
              onPress={handleResolve}
              testID="conflict-resolve.save"
            >
              {resolving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                'Mark resolved & Push'
              )}
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

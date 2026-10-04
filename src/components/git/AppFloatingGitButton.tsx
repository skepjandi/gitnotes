import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useToast, Toast, ToastDescription, ToastTitle } from '@/components/ui/toast';
import { useRepoStore } from '@/stores/repoStore';
import { useAllReposStatus } from '@/hooks/useAllReposStatus';
import { useGitButtonActionStore } from '@/stores/gitButtonActionStore';
import { stageAllPending, commitAll, pushAll, type RepoOpOutcome } from '@/services/git/multiRepoGitOps';
import { CommitService } from '@/services/git/CommitService';
import type { Author } from '@/services/git/engine/GitEngine';
import { emitGitContentRefresh, emitGitRefresh } from '@/hooks/useGitRefreshEvent';
import FloatingGitButton from './FloatingGitButton';
import type { ReleaseSegment } from './useFloatingGitButtonAffordances';
import type { RootStackParamList } from '@/navigation/types';
import { getFloatingGitNavigationTarget } from './floatingGitButtonNavigation';

const HINT_SEEN_KEY = '@gitnotes:gitbutton_hint_seen';

/**
 * App-level wrapper around `FloatingGitButton`. Owns:
 *   - the aggregated per-repo state from `useAllReposStatus`
 *   - the smart-navigate tap: queues a pending action (target repo +
 *     section) and jumps to ExploreTab. ExploreScreen reads the pending
 *     action on mount/update, applies repo + section, then clears it.
 *
 * Hold-to-release performs git stage/commit/push across all repos.
 * Disabled (grayed out) when nothing is pending anywhere.
 *
 * Hides itself on full-screen modals and the paywall/onboarding so it never
 * floats over content that needs the full viewport.
 */
export default function AppFloatingGitButton() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const repos = useRepoStore((s) => s.repositories);
  const aggregatedState = useAllReposStatus();
  const setPending = useGitButtonActionStore((s) => s.setPending);
  const toast = useToast();
  const hintFiredRef = useRef(false);

  const hasAnyAction =
    aggregatedState.totalUncommitted > 0 ||
    aggregatedState.totalStaged > 0 ||
    aggregatedState.totalAhead > 0 ||
    aggregatedState.anyConflicts;
  const isDisabled = !hasAnyAction;

  const isOperationActiveRef = useRef(false);

  const handleReleaseSegment = useCallback(
    async (segment: ReleaseSegment) => {
      if (isOperationActiveRef.current) return;
      isOperationActiveRef.current = true;

      let pushFailedCount = 0;

      try {
        if (repos.length === 0) {
          toast.show({
            placement: 'top',
            duration: 3000,
            render: ({ id }: { id: string }) => (
              <Toast action="error" nativeID={`gitbutton-norepos-${id}`}>
                <ToastTitle>Cannot {segment}</ToastTitle>
                <ToastDescription>No repositories connected. Add a repo in Settings.</ToastDescription>
              </Toast>
            ),
          });
          return;
        }
        const stageResult = await stageAllPending(repos);
        if (segment === 'stage') {
          toast.show({
            placement: 'top',
            duration: 2000,
            render: ({ id }: { id: string }) => (
              <Toast action="success" nativeID={`gitbutton-stage-${id}`}>
                <ToastTitle>Staged {stageResult.totalActed} file(s)</ToastTitle>
              </Toast>
            ),
          });
          void aggregatedState.refresh();
          emitGitRefresh();
          emitGitContentRefresh();
          return;
        }

        const author: Author = await CommitService.resolveAuthor();
        if (!author.email.trim()) {
          toast.show({
            placement: 'top',
            duration: 3000,
            render: ({ id }: { id: string }) => (
              <Toast action="error" nativeID={`gitbutton-noauthor-${id}`}>
                <ToastTitle>Cannot commit</ToastTitle>
                <ToastDescription>No commit email found. Enter one in the staging page.</ToastDescription>
              </Toast>
            ),
          });
          return;
        }

        const message = await CommitService.generateCommitMessage(
          repos[0]?.id ?? '',
          stageResult.totalActed,
        );
        await commitAll(repos, message, author);
        if (segment === 'commit') {
          toast.show({
            placement: 'top',
            duration: 2000,
            render: ({ id }: { id: string }) => (
              <Toast action="success" nativeID={`gitbutton-commit-${id}`}>
                <ToastTitle>Staged and committed</ToastTitle>
              </Toast>
            ),
          });
          void aggregatedState.refresh();
          emitGitRefresh();
          emitGitContentRefresh();
          return;
        }

        const pushResult = await pushAll(repos);
        pushFailedCount = pushResult.failures.length;

        if (pushFailedCount === repos.length) {
          toast.show({
            placement: 'top',
            duration: 4000,
            render: ({ id }: { id: string }) => (
              <Toast action="error" nativeID={`gitbutton-push-error-${id}`}>
                <ToastTitle>Push failed</ToastTitle>
                <ToastDescription>
                  {pushResult.failures.map((f) => f.repoName).join(', ')}
                </ToastDescription>
              </Toast>
            ),
          });
        } else {
          const pushedCount = repos.length - pushFailedCount;
          toast.show({
            placement: 'top',
            duration: 3000,
            render: ({ id }: { id: string }) => (
              <Toast
                action={pushFailedCount > 0 ? 'error' : 'success'}
                nativeID={`gitbutton-push-${id}`}
              >
                <ToastTitle>
                  {pushFailedCount > 0
                    ? `Pushed ${pushedCount} repos, ${pushFailedCount} failed`
                    : `Pushed to ${pushedCount} repos`}
                </ToastTitle>
              </Toast>
            ),
          });
          const navigatedToConflicts = new Set<string>();
          const nonConflictFailures: RepoOpOutcome[] = [];
          for (const failure of pushResult.failures) {
            if (failure.failureKind === 'rejected') {
              if (!navigatedToConflicts.has(failure.repoId)) {
                navigatedToConflicts.add(failure.repoId);
                navigation.navigate('ExploreConflict', { repoId: failure.repoId });
              }
            } else {
              nonConflictFailures.push(failure);
            }
          }
          if (nonConflictFailures.length > 0) {
            const kind = nonConflictFailures[0].failureKind ?? 'unknown';
            const isAuthOrPermission = kind === 'auth' || kind === 'permission';
            toast.show({
              placement: 'top',
              duration: 4000,
              render: ({ id }: { id: string }) => (
                <Toast action="error" nativeID={`gitbutton-push-nonauthr-${id}`}>
                  <ToastTitle>{isAuthOrPermission ? 'Authentication required' : 'Push failed'}</ToastTitle>
                  <ToastDescription>
                    {isAuthOrPermission
                      ? 'Check your credentials in Settings.'
                      : nonConflictFailures
                          .map((f) => (f.error ? `${f.repoName}: ${f.error}` : f.repoName))
                          .join(', ')}
                  </ToastDescription>
                </Toast>
              ),
            });
          }
        }
        void aggregatedState.refresh();
        emitGitRefresh();
        emitGitContentRefresh();
      } finally {
        isOperationActiveRef.current = false;
      }
    },
    [repos, toast, aggregatedState, navigation],
  );

  /**
   * First-use discoverability hint. When the user first encounters the
   * button with something pending, show a long-duration toast that explains
   * the tap. Persists `seen` in AsyncStorage so it only fires once.
   */
  useEffect(() => {
    if (hintFiredRef.current || !hasAnyAction) return;
    hintFiredRef.current = true;
    let cancelled = false;
    void AsyncStorage.getItem(HINT_SEEN_KEY).then((seen) => {
      if (cancelled || seen === 'true') return;
      toast.show({
        placement: 'top',
        duration: 6000,
        render: ({ id }: { id: string }) => (
          <Toast action="success" nativeID={`gitbutton-hint-toast-${id}`}>
            <ToastTitle>Tip: tap the git button</ToastTitle>
            <ToastDescription>
              It jumps straight to your pending changes, staged files, or unpushed commits.
            </ToastDescription>
          </Toast>
        ),
      });
      void AsyncStorage.setItem(HINT_SEEN_KEY, 'true').catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [hasAnyAction, toast]);

  // All hooks must run before this conditional return — the route name
  // changes while the component stays mounted, and an early return before a
  // hook would change the hook count between renders.
  const onQuickTap = useCallback(() => {
    if (aggregatedState.anyConflicts) {
      const conflictRepoId = Array.from(aggregatedState.perRepo.entries()).find(
        ([, entry]) => entry.conflicts,
      )?.[0];
      if (!conflictRepoId) return;
      navigation.navigate('ExploreConflict', { repoId: conflictRepoId });
      return;
    }
    const target = getFloatingGitNavigationTarget(aggregatedState);
    const targetRepoId = target?.repoId ?? repos[0]?.id ?? null;
    const section = target?.section ?? null;
    if (!section || !targetRepoId) return;
    setPending({ repoId: targetRepoId, section });
    navigation.navigate('MainTabs', { screen: 'ExploreTab' });
  }, [aggregatedState, repos, setPending, navigation]);

  return (
    <FloatingGitButton
      aggregatedState={aggregatedState}
      onQuickTap={onQuickTap}
      onReleaseSegment={handleReleaseSegment}
      disabled={isDisabled}
    />
  );
}

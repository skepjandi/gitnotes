import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { Button } from '@/components/ui/Button';
import { InputField } from '@/components/ui/Input';
import { TextareaInput } from '@/components/ui/textarea';
import * as GitEngine from '@/services/git/engine/GitEngine';
import type { FileStatus } from '@/services/git/engine/GitEngine';
import { useAccounts } from '@/contexts/AccountsContext';
import type { RepoLike } from './exploreShared';
import { useTokens } from '@/contexts/ThemeContext';
import { buildCommitMessageDraft } from './commitMessageDraft';
import { CommitService } from '@/services/git/CommitService';
import { AccountStorage } from '@/services/AccountStorage';

const MESSAGE_PLACEHOLDER = 'feat: what changed? (conventional commit)';

interface CommitComposerProps {
  repo: RepoLike;
  /** Every path with any working-tree change (staged + unstaged), for "Stage all". */
  changedPaths: string[];
  /** Every working-tree status entry, used to draft the commit message. */
  statuses: FileStatus[];
  stagedCount: number;
  /** Reload section data + refresh the shell header after a commit lands. */
  onCommitted: () => void;
  embedded?: boolean;
}

export function CommitComposer({ repo, changedPaths, statuses, stagedCount, onCommitted, embedded = false }: CommitComposerProps) {
  const { accounts, activeAccountId, authState } = useAccounts();
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  const { colors } = useTokens();
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [busy, setBusy] = useState<'stageAll' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repoRemembered = await AccountStorage.getRememberedCommitAuthorForRepo(repo.id);
      if (cancelled) return;
      if (repoRemembered) {
        if (!nameTouched) setAuthorName(repoRemembered.name ?? '');
        if (!emailTouched) setAuthorEmail(repoRemembered.email);
        return;
      }
      const hostId = repo.hostId ?? null;
      if (hostId) {
        const remembered = await AccountStorage.getRememberedCommitAuthor(hostId);
        if (cancelled) return;
        if (remembered) {
          if (!nameTouched) setAuthorName(remembered.name ?? '');
          if (!emailTouched) setAuthorEmail(remembered.email);
          return;
        }
      }
      if (nameTouched || emailTouched) return;
      const author = await CommitService.resolveAuthor(repo.id);
      if (cancelled) return;
      if (emailTouched) return;
      if (!nameTouched) setAuthorName(author.name);
      if (!emailTouched) setAuthorEmail(author.email);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo.id, repo.hostId, activeAccount, authState.user, nameTouched, emailTouched]);

  useEffect(() => {
    if (draftDismissed) return;
    const draft = buildCommitMessageDraft(statuses);
    if (draft.length === 0) return;
    setMessage((prev) => (prev.trim().length === 0 ? draft : prev));
  }, [statuses, draftDismissed]);

  const clearMessage = useCallback(() => {
    setMessage('');
    setError(null);
    setDraftDismissed(true);
  }, []);

  const validate = useCallback((): string | null => {
    if (message.trim().length === 0) return 'Enter a commit message first.';
    if (authorName.trim().length === 0 || authorEmail.trim().length === 0) {
      return 'Author name and email are required.';
    }
    return null;
  }, [message, authorName, authorEmail]);

  const runCommit = useCallback(
    async (mode: 'stageAll' | 'commit') => {
      setError(null);
      setSuccess(null);
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }
      setBusy(mode);
      try {
        if (mode === 'stageAll' && changedPaths.length > 0) {
          await GitEngine.stage(repo.localPath, changedPaths);
        }
        const commit = await GitEngine.commit(repo.localPath, message.trim(), {
          name: authorName.trim(),
          email: authorEmail.trim(),
        });

        if (
          (nameTouched || emailTouched)
          && authorName.trim().length > 0
          && authorEmail.trim().length > 0
        ) {
          await AccountStorage.setRememberedCommitAuthorForRepo(repo.id, {
            email: authorEmail.trim(),
            name: authorName.trim(),
          });
        }

        setMessage('');
        setDraftDismissed(false);
        setSuccess(`Committed ${commit.shortId} — ${commit.summary}`);
        onCommitted();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
      }
    },
    [validate, changedPaths, repo.localPath, repo.id, message, authorName, authorEmail, onCommitted, nameTouched, emailTouched],
  );

  const nothingToStageAll = changedPaths.length === 0;
  const nothingStaged = stagedCount === 0;

  return (
    <View
      style={embedded
        ? { backgroundColor: 'transparent', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, minWidth: 0 }
        : { borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, overflow: 'hidden', marginHorizontal: 16, marginVertical: 8, minWidth: 0 }}
      testID="explore.commit-composer"
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name="git-commit-outline" size={14} color={colors.accent} />
        <Heading className="text-sm" style={{ color: colors.text }}>Commit</Heading>
        {stagedCount > 0 && (
          <View className="rounded px-1.5 py-0.5" style={{ backgroundColor: `${colors.accent}26` }} testID="explore.commit-composer.staged-count">
            <Text className="text-[10px] font-semibold" style={{ color: colors.accent }}>{stagedCount} staged</Text>
          </View>
        )}
        {message.length > 0 && (
          <View className="ml-auto">
            <Button
              size="sm"
              variant="ghost"
              onPress={clearMessage}
              accessibilityLabel={t('common.clear')}
              testID="explore.commit-composer.clear"
              label={t('common.clear')}
            />
          </View>
        )}
      </View>

      <View
        className="mt-3 flex-row items-start rounded-md"
        style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 8, minHeight: 92 }}
        testID="explore.commit-composer.message"
      >
        <TextareaInput
          value={message}
          onChangeText={setMessage}
          placeholder={MESSAGE_PLACEHOLDER}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Commit message"
          style={{ minHeight: 74, paddingVertical: 0 }}
          testID="explore.commit-composer.message.input"
        />
      </View>

      <View className="mt-3 gap-2">
        <View className="flex-row items-center rounded-md" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 12, minHeight: 44 }}>
          <InputField
            value={authorName}
            onChangeText={(value) => {
              setNameTouched(true);
              setAuthorName(value);
            }}
            placeholder="Author name"
            accessibilityLabel="Author name"
            testID="explore.commit-composer.author-name"
          />
        </View>
        <View className="flex-row items-center rounded-md" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 12, minHeight: 44 }}>
          <InputField
            value={authorEmail}
            onChangeText={(value) => {
              setEmailTouched(true);
              setAuthorEmail(value);
            }}
            placeholder="author@email.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Author email"
            testID="explore.commit-composer.author-email"
          />
        </View>
      </View>

      {error && (
        <Text className="mt-2 text-xs" style={{ color: colors.error }} testID="explore.commit-composer.error">
          {error}
        </Text>
      )}
      {success && (
        <Text className="mt-2 text-xs" style={{ color: colors.accent }} testID="explore.commit-composer.success">
          {success}
        </Text>
      )}

      <View className="mt-4 gap-2">
        <Button
          fullWidth
          variant="primary"
          disabled={busy !== null || (nothingToStageAll && nothingStaged)}
          onPress={() => void runCommit('stageAll')}
          style={{ minHeight: 44 }}
          testID="explore.commit-composer.stage-all-commit"
          label={busy === 'stageAll' ? undefined : 'Stage all + Commit'}
          leadingIcon={busy === 'stageAll' ? <ActivityIndicator size="small" color="#fff" /> : undefined}
        />
        <Button
          fullWidth
          variant="outline"
          disabled={busy !== null || nothingStaged}
          onPress={() => void runCommit('commit')}
          style={{ minHeight: 44 }}
          testID="explore.commit-composer.commit"
          label={busy === 'commit' ? undefined : 'Commit staged'}
          leadingIcon={busy === 'commit' ? <ActivityIndicator size="small" color={colors.text} /> : undefined}
        />
      </View>
    </View>
  );
}

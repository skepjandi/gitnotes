import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';

import { ChatHintChips } from '../components/ai/ChatHintChips';
import { ChatInputBar } from '../components/ai/ChatInputBar';
import ContextPickerModal from '../components/ai/ContextPickerModal';
import { folderName } from '../components/agent/format';
import { AgentModeChip } from '../components/chat/AgentModeChip';
import { ChatErrorCard } from '../components/chat/ChatErrorCard';
import { ChatTimelineList } from '../components/chat/ChatTimelineList';
import { LiveLine } from '../components/chat/LiveLine';
import { MessageActionSheet } from '../components/chat/MessageActionSheet';
import { MissionControlContent, MissionControlSheet, selectMission } from '../components/chat/mission';
import { TextPromptModal } from '../components/chat/TextPromptModal';
import VoiceInputModal from '../components/VoiceInputModal';
import { EmptyState, IconButton, ScreenHeader, useScreenHeaderHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { useTokens } from '../contexts/ThemeContext';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';
import type { AIContextItem } from '../models/AIProvider';
import type { ChatMessage } from '../models/Chat';
import type { RootStackParamList } from '../navigation/types';
import { useChatSession } from '../services/chat';
import { useAIStore } from '../stores/aiStore';
import { HapticService } from '../utils/haptics';

type ChatScreenRouteProp = RouteProp<RootStackParamList, 'ChatScreen'>;

/** At this width the mission control panel docks beside the transcript instead of opening as a sheet. */
const SIDE_INSPECTOR_MIN_WIDTH = 900;
const SIDE_INSPECTOR_WIDTH = 340;

export default function ChatScreen() {
  const { t } = useTranslation();
  const safeBack = useSafeBack();
  const route = useRoute<ChatScreenRouteProp>();
  const { colors, spacing } = useTokens();
  const headerHeight = useScreenHeaderHeight({ subtitle: true });
  const { width } = useWindowDimensions();
  const { threadId } = route.params;

  const session = useChatSession(threadId);
  const { thread, messages, status, loadState } = session;

  const [attachedContexts, setAttachedContexts] = useState<AIContextItem[]>([]);
  const [contextPickerVisible, setContextPickerVisible] = useState(false);
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [missionVisible, setMissionVisible] = useState(false);
  const [chatText, setChatText] = useState('');
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  const backend = thread?.backend;
  const agent = backend?.type === 'agent' ? backend : null;
  const isDemo = backend?.type === 'demo';
  const sideInspector = width >= SIDE_INSPECTOR_MIN_WIDTH;

  const selectedModelId = useAIStore((state) => state.selectedModelId);
  const providers = useAIStore((state) => state.providers);
  const activeModel = useMemo(() => {
    if (!selectedModelId) return undefined;
    for (const provider of providers) {
      if (!provider.isEnabled) continue;
      const model = provider.models.find((candidate) => candidate.id === selectedModelId);
      if (model) return { model: model.name, provider: provider.name };
    }
    return undefined;
  }, [selectedModelId, providers]);

  const mission = useMemo(
    () =>
      selectMission({
        messages,
        pendingPermissions: session.pendingPermissions,
        backend,
        status,
        streamStartedAt: session.streamStartedAt,
        now: Date.now(),
      }),
    [messages, session.pendingPermissions, backend, status, session.streamStartedAt],
  );

  const handleSend = useCallback(
    (text: string) => {
      const contexts = attachedContexts;
      setAttachedContexts([]);
      void session.send(text, contexts);
    },
    [attachedContexts, session],
  );

  const handleHintPress = useCallback((text: string) => setChatText(text), []);

  const handleVoiceDone = useCallback((text: string) => {
    setVoiceModalVisible(false);
    const trimmed = text.trim();
    if (trimmed) {
      setChatText((prev) => (prev.trim() ? `${prev.trim()} ${trimmed}` : trimmed));
    }
  }, []);

  const handleMessageLongPress = useCallback((message: ChatMessage) => {
    HapticService.selection();
    setActionMessage(message);
  }, []);

  const handleCopy = useCallback(async (message: ChatMessage) => {
    await Clipboard.setStringAsync(message.content);
    HapticService.success();
  }, []);

  const handleEditConfirm = useCallback(
    (text: string) => {
      const target = editingMessage;
      setEditingMessage(null);
      if (target) void session.editAndResend(target.id, text);
    },
    [editingMessage, session],
  );

  const handleRegenerate = useCallback(
    (message: ChatMessage) => {
      void session.regenerate(message.id);
    },
    [session],
  );

  const blocked = useProScreenGuard();
  if (blocked) return null;

  const busy = status === 'running' || status === 'awaiting-permission';
  const ready = loadState === 'ready' && thread !== null;
  const needsYou = session.pendingPermissions.length > 0;

  const renderBody = () => {
    if (loadState === 'loading') {
      return (
        <View className="flex-1 items-center justify-center" testID="chat.state.loading">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }
    if (loadState === 'not-found') {
      return (
        <View className="flex-1 justify-center" testID="chat.state.not-found">
          <EmptyState icon="chatbubbles-outline" title={t('chat.notFoundTitle')} subtitle={t('chat.notFoundBody')} />
        </View>
      );
    }
    if (loadState === 'error') {
      return (
        <View className="flex-1 justify-center" testID="chat.state.error">
          <EmptyState
            icon="alert-circle-outline"
            iconColor={colors.error}
            title={t('chat.loadErrorTitle')}
            subtitle={session.loadError ?? t('chat.loadErrorBody')}
          />
        </View>
      );
    }

    const empty = (
      <View className="flex-1 justify-center items-center" style={{ paddingVertical: spacing[6] }}>
        <Text className="text-xl font-bold mb-2 text-text" style={{ marginHorizontal: spacing[4], textAlign: 'center' }}>
          {agent
            ? t('chat.agentEmptyTitle', { agent: agent.agentName })
            : isDemo
              ? t('chat.demoEmptyTitle')
              : t('chat.startConversation')}
        </Text>
        <Text className="text-md text-center text-text-secondary" style={{ marginHorizontal: spacing[4] }}>
          {agent
            ? t('chat.agentEmptyBody', { folder: folderName(agent.cwd) })
            : isDemo
              ? t('chat.demoEmptyBody')
              : t('chat.emptyStateBody')}
        </Text>
        {agent || isDemo ? null : <ChatHintChips onPressHint={handleHintPress} />}
      </View>
    );

    return (
      <ChatTimelineList
        messages={messages}
        pendingPermissions={session.pendingPermissions}
        queuedPrompts={session.queuedPrompts}
        isRunning={status === 'running'}
        headerHeight={headerHeight}
        empty={empty}
        onLongPress={handleMessageLongPress}
        onResolvePermission={session.resolvePermission}
        onCancelQueued={session.cancelQueued}
        onRetryQueued={session.retryQueued}
      />
    );
  };

  const subtitle = agent
    ? t('chat.agentSubtitle', { agent: agent.agentName, folder: folderName(agent.cwd) })
    : isDemo
      ? t('chat.demoSubtitle')
      : thread
        ? t('chat.messageCount', { count: messages.length })
        : t('chat.loadingConversation');

  const modeAccessory =
    agent?.availableModes && agent.availableModes.length > 0 ? (
      <AgentModeChip
        modes={agent.availableModes}
        currentModeId={agent.modeId}
        onSelect={(modeId) => void session.setMode(modeId)}
      />
    ) : null;

  const missionButton = ready ? (
    <IconButton
      testID="chat.button.mission"
      size="sm"
      onPress={() => (sideInspector ? setMissionVisible((open) => !open) : setMissionVisible(true))}
      accessibilityLabel={t('chat.mission.title')}
    >
      <Ionicons name="albums-outline" size={18} color={needsYou ? colors.warning : colors.accent} />
    </IconButton>
  ) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'left', 'right']}>
      <View className="flex-1" style={{ flexDirection: 'row' }}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <View className="flex-1">
            {renderBody()}

            <ChatErrorCard
              message={session.error}
              canRetry={session.retryable && !busy}
              onRetry={() => void session.retry()}
              onDismiss={session.dismissError}
            />

            <LiveLine
              status={status}
              statusLine={session.statusLine}
              actor={agent ? agent.agentName : activeModel?.model}
              startedAt={session.streamStartedAt}
              onStop={session.stop}
            />

            <ChatInputBar
              onSend={handleSend}
              onAttach={() => setContextPickerVisible(true)}
              onVoicePress={() => setVoiceModalVisible(true)}
              attachedContexts={attachedContexts}
              onRemoveContext={(index) => setAttachedContexts((current) => current.filter((_, i) => i !== index))}
              isStreaming={busy}
              onStop={session.stop}
              disabled={!ready}
              contextWarning={
                session.contextBudget?.message
                  ? { level: session.contextBudget.warningLevel, message: session.contextBudget.message }
                  : null
              }
              value={chatText}
              onChangeText={setChatText}
              commands={agent?.availableCommands}
              accessory={modeAccessory}
            />
          </View>
        </KeyboardAvoidingView>

        {sideInspector && missionVisible ? (
          <View
            testID="chat.mission.panel"
            style={{
              width: SIDE_INSPECTOR_WIDTH,
              borderLeftWidth: 1,
              borderLeftColor: colors.border,
              paddingTop: headerHeight,
            }}
          >
            <MissionControlContent mission={mission} onResolvePermission={session.resolvePermission} />
          </View>
        ) : null}
      </View>

      <MissionControlSheet
        visible={!sideInspector && missionVisible}
        onClose={() => setMissionVisible(false)}
        mission={mission}
        onResolvePermission={session.resolvePermission}
      />

      <MessageActionSheet
        message={actionMessage}
        onClose={() => setActionMessage(null)}
        onEdit={setEditingMessage}
        onRegenerate={handleRegenerate}
        onCopy={handleCopy}
      />

      <TextPromptModal
        visible={editingMessage !== null}
        title={t('chat.editMessageTitle')}
        message={t('chat.editMessageBody')}
        initialValue={editingMessage?.content ?? ''}
        confirmLabel={t('chat.send')}
        multiline
        testIDPrefix="chat-edit"
        onConfirm={handleEditConfirm}
        onCancel={() => setEditingMessage(null)}
      />

      <VoiceInputModal
        visible={voiceModalVisible}
        onDone={handleVoiceDone}
        onClose={() => setVoiceModalVisible(false)}
      />

      <ContextPickerModal
        visible={contextPickerVisible}
        onClose={() => setContextPickerVisible(false)}
        initialSelected={attachedContexts}
        onConfirm={(items) => {
          setAttachedContexts(items);
          setContextPickerVisible(false);
        }}
      />

      <ScreenHeader
        title={thread?.title ?? t('chat.title')}
        subtitle={subtitle}
        onBack={safeBack}
        actions={missionButton}
      />
    </SafeAreaView>
  );
}

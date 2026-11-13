import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { ChatHintChips } from '../ai/ChatHintChips';
import { ChatInputBar } from '../ai/ChatInputBar';
import ContextPickerModal from '../ai/ContextPickerModal';
import { folderName } from '../agent/format';
import VoiceInputModal from '../VoiceInputModal';
import { EmptyState, IconButton, ScreenHeader, useScreenHeaderHeight } from '../ui';
import { SafeAreaView } from '../ui/SafeAreaView';
import { useTokens } from '../../contexts/ThemeContext';
import { useProScreenGuard } from '../../hooks/useProScreenGuard';
import type { AIContextItem } from '../../models/AIProvider';
import type { ChatMessage, ImageAttachment } from '../../models/Chat';
import { bridgeTools, type BridgeFeature } from '../../services/agent/bridgeTools';
import { useChatSession } from '../../services/chat';
import { useAIStore } from '../../stores/aiStore';
import { HapticService } from '../../utils/haptics';
import type { RootStackParamList } from '../../navigation/types';
import { ChatErrorCard } from './ChatErrorCard';
import { ChatTimelineList } from './ChatTimelineList';
import { configOptionsFor, LEGACY_MODE_OPTION_ID } from './composer/configOptions';
import { ConfigOptionsMenu } from './composer/ConfigOptionsMenu';
import { ImageViewerModal } from './composer/ImageViewerModal';
import { useImageAttachments } from './composer/useImageAttachments';
import { LiveLine } from './LiveLine';
import { MessageActionSheet } from './MessageActionSheet';
import { MissionControlContent, MissionControlSheet, selectMission } from './mission';
import { TextPromptModal } from './TextPromptModal';

/** At this width the mission control panel docks beside the transcript instead of opening as a sheet. */
const SIDE_INSPECTOR_MIN_WIDTH = 900;
const SIDE_INSPECTOR_WIDTH = 340;

export interface ChatConversationProps {
  threadId: string;
  /** Header back button; omit when the conversation sits beside the thread list. */
  onBack?: () => void;
  /** Rendered inside a split pane: the mission inspector never docks, it opens as a sheet. */
  embedded?: boolean;
}

export function ChatConversation({ threadId, onBack, embedded = false }: ChatConversationProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTokens();
  const headerHeight = useScreenHeaderHeight({ subtitle: true });
  const { width } = useWindowDimensions();

  const session = useChatSession(threadId);
  const { thread, messages, status, loadState } = session;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const wasBusy = useRef(false);
  useEffect(() => {
    const active = status === 'running' || status === 'awaiting-permission';
    if (wasBusy.current && !active) void (status === 'error' ? HapticService.error() : HapticService.success());
    wasBusy.current = active;
  }, [status]);

  const imageAttachments = useImageAttachments(threadId);
  const [viewerImage, setViewerImage] = useState<ImageAttachment | null>(null);
  const [bridgeFeatures, setBridgeFeatures] = useState<readonly BridgeFeature[]>([]);
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
  const bridgeId = agent?.bridgeId;
  const sideInspector = !embedded && width >= SIDE_INSPECTOR_MIN_WIDTH;

  useEffect(() => {
    if (!bridgeId) {
      setBridgeFeatures([]);
      return;
    }
    let cancelled = false;
    bridgeTools.features(bridgeId).then(
      (features) => {
        if (!cancelled) setBridgeFeatures(features);
      },
      () => {
        if (!cancelled) setBridgeFeatures([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bridgeId]);

  const agentCwd = agent?.cwd;
  const fileSearch = useMemo(
    () =>
      bridgeId && agentCwd && bridgeFeatures.includes('fs-search')
        ? async (query: string) => (await bridgeTools.searchFiles(bridgeId, agentCwd, query)).items
        : undefined,
    [bridgeId, agentCwd, bridgeFeatures],
  );

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
      const images = imageAttachments.images;
      setAttachedContexts([]);
      imageAttachments.clear();
      void session.send(text, contexts, images);
    },
    [attachedContexts, imageAttachments, session],
  );

  const supportsImages = agent !== null && agent.supportsImages !== false;
  const pickImage = useCallback(
    async (source: 'library' | 'camera') => {
      const failure = await imageAttachments.pick(source);
      if (failure) {
        Alert.alert(t(failure === 'permission' ? 'chat.images.permissionDenied' : 'chat.images.pickFailed'));
      }
    },
    [imageAttachments, t],
  );

  const changeConfigOption = useCallback(
    (optionId: string, value: string | boolean) => {
      if (optionId === LEGACY_MODE_OPTION_ID && !agent?.configOptions?.length) void session.setMode(String(value));
      else void session.setConfigOption(optionId, value);
    },
    [agent?.configOptions?.length, session],
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
  const needsYou = session.pendingPermissions.length > 0 || session.pendingElicitations.length > 0;

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
        pendingElicitations={session.pendingElicitations}
        agentName={agent?.agentName}
        isRunning={status === 'running'}
        headerHeight={headerHeight}
        empty={empty}
        onLongPress={handleMessageLongPress}
        onResolvePermission={session.resolvePermission}
        onResolveElicitation={session.resolveElicitation}
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

  const configOptions = agent ? configOptionsFor(agent) : [];
  const configAccessory =
    configOptions.length > 0 ? <ConfigOptionsMenu options={configOptions} onChange={changeConfigOption} /> : null;

  const bridgeRef = agent ? { bridgeId: agent.bridgeId, cwd: agent.cwd, connectionId: agent.connectionId } : null;
  const openReview = bridgeRef
    ? (path?: string) => {
        setMissionVisible(false);
        navigation.navigate('ReviewScreen', { bridgeId: bridgeRef.bridgeId, cwd: bridgeRef.cwd, path });
      }
    : undefined;

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
              accessory={configAccessory}
              attachedImages={imageAttachments.images}
              onRemoveImage={imageAttachments.remove}
              onImagePress={setViewerImage}
              onPickImage={supportsImages ? (source) => void pickImage(source) : undefined}
              fileSearch={fileSearch}
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
            <MissionControlContent
              mission={mission}
              onResolvePermission={session.resolvePermission}
              bridge={bridgeRef}
              onOpenReview={openReview}
            />
          </View>
        ) : null}
      </View>

      <MissionControlSheet
        visible={!sideInspector && missionVisible}
        onClose={() => setMissionVisible(false)}
        mission={mission}
        onResolvePermission={session.resolvePermission}
        bridge={bridgeRef}
        onOpenReview={openReview}
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

      <ImageViewerModal image={viewerImage} onClose={() => setViewerImage(null)} />

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
        onBack={onBack}
        actions={missionButton}
      />
    </SafeAreaView>
  );
}

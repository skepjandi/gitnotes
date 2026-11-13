import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { listBridgeAgents, listWorkspaces } from '../../services/agent/bridgeApi';
import type { AgentBridge, AgentInfo, WorkspaceInfo } from '../../services/agent/types';
import { createAgentThread, createDemoThread } from '../../services/chat';
import { useAgentBridgeStore } from '../../stores/agentBridgeStore';
import { HapticService } from '../../utils/haptics';
import { Button, Modal } from '../ui';
import { bridgeErrorMessage } from './bridgeErrors';
import { folderName } from './format';

type Loadable<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; error: unknown };

type Step = { kind: 'choose' } | { kind: 'workspace'; bridge: AgentBridge; agent: AgentInfo };

export interface NewChatPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelectModel: () => void;
  onAgentThreadCreated: (threadId: string) => void;
}

interface RowProps {
  testID: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  disabled?: boolean;
  trailing?: ReactNode;
  onPress?: () => void;
}

function PickerRow({ testID, icon, title, subtitle, disabled, trailing, onPress }: RowProps) {
  const { colors, spacing, type } = useTokens();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[3],
        paddingHorizontal: spacing[4],
        paddingVertical: spacing[3],
        minHeight: 56,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: pressed ? `${colors.shadow}14` : 'transparent',
      })}
    >
      <Ionicons name={icon} size={22} color={disabled ? colors.textSecondary : colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: type.md, fontWeight: '500' }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />}
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { colors, spacing } = useTokens();
  return (
    <Text
      style={{
        color: colors.textSecondary,
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        paddingHorizontal: spacing[4],
        paddingTop: spacing[3],
        paddingBottom: spacing[1],
      }}
    >
      {children}
    </Text>
  );
}

function InlineNotice({ testID, message, onRetry }: { testID: string; message: string; onRetry?: () => void }) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  return (
    <View testID={testID} style={{ paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[2] }}>
      <Text style={{ color: colors.textSecondary, fontSize: type.sm }}>{message}</Text>
      {onRetry ? <Button size="sm" variant="secondary" label={t('common.retry')} onPress={onRetry} /> : null}
    </View>
  );
}

export function NewChatPicker({ visible, onClose, onSelectModel, onAgentThreadCreated }: NewChatPickerProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const bridges = useAgentBridgeStore((state) => state.bridges);
  const setLastWorkspace = useAgentBridgeStore((state) => state.setLastWorkspace);

  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [agentsByBridge, setAgentsByBridge] = useState<Record<string, Loadable<AgentInfo[]>>>({});
  const [workspaces, setWorkspaces] = useState<Loadable<WorkspaceInfo[]>>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep({ kind: 'choose' });
    setCreateError(null);
  }, [visible]);

  useEffect(() => {
    if (!visible || step.kind !== 'choose') return;
    const controller = new AbortController();
    setAgentsByBridge(Object.fromEntries(bridges.map((bridge) => [bridge.id, { status: 'loading' } as const])));
    for (const bridge of bridges) {
      listBridgeAgents(bridge.id, controller.signal)
        .then((probe) => {
          if (controller.signal.aborted) return;
          setAgentsByBridge((previous) => ({ ...previous, [bridge.id]: { status: 'ready', value: probe.agents } }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setAgentsByBridge((previous) => ({
            ...previous,
            [bridge.id]: { status: 'error', error },
          }));
        });
    }
    return () => controller.abort();
  }, [visible, step.kind, bridges, reloadToken]);

  const workspaceBridgeId = step.kind === 'workspace' ? step.bridge.id : null;
  useEffect(() => {
    if (workspaceBridgeId === null) return;
    const controller = new AbortController();
    setWorkspaces({ status: 'loading' });
    listWorkspaces(workspaceBridgeId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setWorkspaces({ status: 'ready', value: items });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setWorkspaces({ status: 'error', error });
      });
    return () => controller.abort();
  }, [workspaceBridgeId, reloadToken]);

  const workspaceRows = useMemo(() => {
    if (step.kind !== 'workspace' || workspaces.status !== 'ready') return [];
    const last = step.bridge.lastWorkspace;
    const items = [...workspaces.value];
    if (last && !items.some((item) => item.path === last)) {
      items.unshift({ path: last, name: folderName(last), isRoot: false });
    }
    return items.sort((a, b) => Number(b.path === last) - Number(a.path === last));
  }, [step, workspaces]);

  const handleSelectModel = useCallback(() => {
    HapticService.selection();
    onSelectModel();
  }, [onSelectModel]);

  const handleSelectWorkspace = useCallback(
    async (bridge: AgentBridge, agent: AgentInfo, cwd: string) => {
      if (creating) return;
      setCreating(true);
      setCreateError(null);
      try {
        const thread = await createAgentThread({
          bridgeId: bridge.id,
          agentId: agent.id,
          agentName: agent.name,
          cwd,
        });
        setLastWorkspace(bridge.id, cwd);
        HapticService.success();
        onAgentThreadCreated(thread.id);
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : t('chat.createFailed'));
        HapticService.error();
      } finally {
        setCreating(false);
      }
    },
    [creating, onAgentThreadCreated, setLastWorkspace, t],
  );

  const handleSelectDemo = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const thread = await createDemoThread();
      HapticService.success();
      onAgentThreadCreated(thread.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t('chat.createFailed'));
      HapticService.error();
    } finally {
      setCreating(false);
    }
  }, [creating, onAgentThreadCreated, t]);

  const renderChoose = () => (
    <>
      <PickerRow
        testID="new-chat-picker.model"
        icon="sparkles-outline"
        title={t('agents.picker.aiModel')}
        subtitle={t('agents.picker.aiModelHint')}
        onPress={handleSelectModel}
      />
      {bridges.map((bridge) => {
        const state = agentsByBridge[bridge.id] ?? { status: 'loading' as const };
        return (
          <View key={bridge.id}>
            <SectionLabel>{bridge.name}</SectionLabel>
            {state.status === 'loading' ? (
              <View style={{ padding: spacing[4], alignItems: 'flex-start' }}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : state.status === 'error' ? (
              <InlineNotice
                testID={`new-chat-picker.error.${bridge.id}`}
                message={bridgeErrorMessage(t, state.error)}
                onRetry={() => setReloadToken((token) => token + 1)}
              />
            ) : state.value.length === 0 ? (
              <InlineNotice testID={`new-chat-picker.no-agents.${bridge.id}`} message={t('agents.noAgentsReported')} />
            ) : (
              state.value.map((agent) => (
                <PickerRow
                  key={agent.id}
                  testID={`new-chat-picker.agent.${bridge.id}.${agent.id}`}
                  icon="terminal-outline"
                  title={t('agents.picker.agentOn', { agent: agent.name, bridge: bridge.name })}
                  subtitle={agent.available ? agent.command : t('agents.agentNotInstalled', { command: agent.command })}
                  disabled={!agent.available}
                  onPress={() => {
                    HapticService.selection();
                    setStep({ kind: 'workspace', bridge, agent });
                  }}
                />
              ))
            )}
          </View>
        );
      })}
      <SectionLabel>{t('chat.demoSection')}</SectionLabel>
      <PickerRow
        testID="new-chat-picker.demo"
        icon="rocket-outline"
        title={t('chat.demoAgent')}
        subtitle={t('chat.demoAgentSubtitle')}
        disabled={creating}
        onPress={() => void handleSelectDemo()}
      />
    </>
  );

  const renderWorkspace = (current: Extract<Step, { kind: 'workspace' }>) => (
    <>
      <Pressable
        testID="new-chat-picker.back"
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        onPress={() => setStep({ kind: 'choose' })}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingHorizontal: spacing[4], paddingTop: spacing[3] }}
      >
        <Ionicons name="chevron-back" size={16} color={colors.accent} />
        <Text style={{ color: colors.accent, fontSize: type.sm, fontWeight: '600' }}>
          {t('agents.picker.agentOn', { agent: current.agent.name, bridge: current.bridge.name })}
        </Text>
      </Pressable>
      <SectionLabel>{t('agents.picker.chooseWorkspace')}</SectionLabel>
      {workspaces.status === 'loading' ? (
        <View testID="new-chat-picker.workspaces.loading" style={{ padding: spacing[4], alignItems: 'flex-start' }}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : workspaces.status === 'error' ? (
        <InlineNotice
          testID="new-chat-picker.workspaces.error"
          message={bridgeErrorMessage(t, workspaces.error)}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : workspaceRows.length === 0 ? (
        <InlineNotice testID="new-chat-picker.workspaces.empty" message={t('agents.picker.workspaceEmpty')} />
      ) : (
        workspaceRows.map((workspace) => (
          <PickerRow
            key={workspace.path}
            testID={`new-chat-picker.workspace.${workspace.path}`}
            icon={workspace.isRoot ? 'folder-open-outline' : 'folder-outline'}
            title={workspace.name}
            subtitle={
              workspace.path === current.bridge.lastWorkspace
                ? `${t('agents.picker.lastUsed')} · ${workspace.path}`
                : workspace.path
            }
            disabled={creating}
            trailing={
              creating ? <ActivityIndicator size="small" color={colors.textSecondary} /> : undefined
            }
            onPress={() => void handleSelectWorkspace(current.bridge, current.agent, workspace.path)}
          />
        ))
      )}
      {createError ? <InlineNotice testID="new-chat-picker.create-error" message={createError} /> : null}
    </>
  );

  return (
    <Modal visible={visible} onRequestClose={onClose} bottomSheet contentStyle={{ padding: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text style={{ flex: 1, color: colors.text, fontSize: type.lg, fontWeight: '700' }}>
          {t('agents.picker.title')}
        </Text>
        <Pressable testID="new-chat-picker.close" accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: spacing[4] }}>
        {step.kind === 'choose' ? renderChoose() : renderWorkspace(step)}
      </ScrollView>
    </Modal>
  );
}

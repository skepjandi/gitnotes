import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { bridgeTools } from '../../services/agent/bridgeTools';
import { BridgeError, type AgentBridge, type BridgeSessionInfo } from '../../services/agent/types';
import { adoptAgentSession, findAgentThreadIdsByConnection } from '../../services/chat';
import { HapticService } from '../../utils/haptics';
import { Group, GroupRow } from '../ui';
import { bridgeErrorMessage } from './bridgeErrors';
import { folderName, sessionAge } from './format';

type Listing =
  | { status: 'loading' }
  | { status: 'ready'; sessions: BridgeSessionInfo[]; threadIds: Map<string, string> }
  | { status: 'hidden' }
  | { status: 'error'; error: unknown };

export interface OpenSessionsListProps {
  bridge: AgentBridge;
  /** Changing this value reloads the list (screen focus, pull-to-refresh, "Check connection"). */
  refreshToken: number;
  onOpenThread: (threadId: string) => void;
  /** Shown inside the new-chat picker: generic title and the bridge name on every row. */
  embedded?: boolean;
}

const SILENT_KINDS: ReadonlySet<string> = new Set(['unreachable', 'timeout', 'unauthorized', 'cleartext-blocked']);

function isContinuable(session: BridgeSessionInfo): boolean {
  return session.cwd !== null && session.sessionId !== null;
}

function ageLabel(t: TFunction, startedAt: number): string {
  const age = sessionAge(startedAt, Date.now());
  return age.unit === 'now' ? t('agents.sessions.startedNow') : t(`agents.sessions.started.${age.unit}`, { count: age.count });
}

async function loadListing(bridge: AgentBridge): Promise<Listing> {
  try {
    const sessions = (await bridgeTools.listSessions(bridge.id)).filter(isContinuable);
    const threadIds = await findAgentThreadIdsByConnection(bridge.id);
    return { status: 'ready', sessions, threadIds };
  } catch (error) {
    if (error instanceof BridgeError && (error.code === 'unsupported' || SILENT_KINDS.has(error.kind))) {
      return { status: 'hidden' };
    }
    return { status: 'error', error };
  }
}

export function OpenSessionsList({ bridge, refreshToken, onOpenThread, embedded = false }: OpenSessionsListProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadListing(bridge).then((next) => {
      if (!cancelled) setListing(next);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, refreshToken]);

  const handleOpen = useCallback(
    async (session: BridgeSessionInfo) => {
      if (busyId) return;
      setBusyId(session.connectionId);
      setOpenError(null);
      try {
        const thread = await adoptAgentSession(bridge, session);
        HapticService.success();
        onOpenThread(thread.id);
      } catch (error) {
        setOpenError(error instanceof Error ? error.message : t('chat.createFailed'));
        HapticService.error();
      } finally {
        setBusyId(null);
      }
    },
    [bridge, busyId, onOpenThread, t],
  );

  if (listing.status === 'hidden') return null;
  if (listing.status === 'loading') return null;
  if (listing.status === 'ready' && listing.sessions.length === 0) return null;

  const title = embedded ? t('agents.sessions.continueTitle') : t('agents.sessions.title', { bridge: bridge.name });

  const rows =
    listing.status === 'error' ? (
      <GroupRow>
        <Text testID={`open-sessions.error.${bridge.id}`} style={{ color: colors.textSecondary, fontSize: type.xs }}>
          {t('agents.sessions.loadFailed', { reason: bridgeErrorMessage(t, listing.error) })}
        </Text>
      </GroupRow>
    ) : (
      listing.sessions.map((session) => {
        const hasThread = listing.threadIds.has(session.connectionId);
        const folder = folderName(session.cwd ?? '');
        const subtitle = [embedded ? bridge.name : null, folder, ageLabel(t, session.startedAt)].filter(Boolean).join(' · ');
        return (
          <GroupRow
            key={session.connectionId}
            testID={`open-sessions.row.${session.connectionId}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: busyId !== null }}
            onPress={() => void handleOpen(session)}
            leading={<Ionicons name="terminal-outline" size={20} color={colors.primary} />}
            trailing={
              busyId === session.connectionId ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : hasThread ? (
                <Text testID={`open-sessions.thread.${session.connectionId}`} style={{ color: colors.accent, fontSize: type.xs, fontWeight: '600' }}>
                  {t('agents.sessions.continue')}
                </Text>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
              )
            }
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <Text style={{ color: colors.text, fontSize: type.md, fontWeight: '500', flexShrink: 1 }} numberOfLines={1}>
                {session.agentName}
              </Text>
              {session.attached ? (
                <View
                  testID={`open-sessions.in-use.${session.connectionId}`}
                  style={{ backgroundColor: `${colors.warning}22`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}
                >
                  <Text style={{ color: colors.warning, fontSize: type.xs, fontWeight: '600' }}>{t('agents.sessions.inUse')}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </Text>
          </GroupRow>
        );
      })
    );

  const openErrorRow = openError ? (
    <GroupRow>
      <Text testID={`open-sessions.open-error.${bridge.id}`} style={{ color: colors.error, fontSize: type.xs }}>{openError}</Text>
    </GroupRow>
  ) : null;

  return (
    <Group testID={`open-sessions.${bridge.id}`} title={title}>
      {rows}
      {openErrorRow}
    </Group>
  );
}

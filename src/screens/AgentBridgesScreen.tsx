import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';

import { AddBridgeModal } from '../components/agent/AddBridgeModal';
import { bridgeErrorMessage } from '../components/agent/bridgeErrors';
import { bridgeHost } from '../components/agent/format';
import { OpenSessionsList } from '../components/agent/OpenSessionsList';
import { BRIDGE_INSTALL_COMMAND, BRIDGE_README_URL, BridgeSetupGuide } from '../components/chat/setup/BridgeSetupGuide';
import { TextPromptModal } from '../components/chat/TextPromptModal';
import ContextMenu from '../components/ContextMenu';
import { Button, EmptyState, Group, GroupRow, IconButton, ScreenHeader, useScreenHeaderHeight } from '../components/ui';
import { SafeAreaView } from '../components/ui/SafeAreaView';
import { useTokens } from '../contexts/ThemeContext';
import { useProScreenGuard } from '../hooks/useProScreenGuard';
import { useSafeBack } from '../hooks/useSafeBack';
import type { RootStackParamList } from '../navigation/types';
import { probeBridge } from '../services/agent/bridgeApi';
import { getBridgeToken } from '../services/agent/bridgeSecrets';
import { normalizeBridgeUrl } from '../services/agent/pairing';
import { BridgeError, type AgentBridge, type BridgeProbeResult, type PairingLink } from '../services/agent/types';
import { useAgentBridgeStore } from '../stores/agentBridgeStore';
import { HapticService } from '../utils/haptics';


type RouteProps = RouteProp<RootStackParamList, 'AgentBridges'>;
type BridgeStatus = { state: 'checking' } | { state: 'online'; probe: BridgeProbeResult } | { state: 'offline'; error: unknown };

const COPIED_RESET_MS = 2000;

export default function AgentBridgesScreen() {
  const { t } = useTranslation();
  const safeBack = useSafeBack();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProps>();
  const { colors, spacing, type } = useTokens();
  const headerHeight = useScreenHeaderHeight();
  const bridges = useAgentBridgeStore((state) => state.bridges);
  const updateBridge = useAgentBridgeStore((state) => state.updateBridge);
  const removeBridge = useAgentBridgeStore((state) => state.removeBridge);

  const [statuses, setStatuses] = useState<Record<string, BridgeStatus>>({});
  const [addVisible, setAddVisible] = useState(false);
  const [initialLink, setInitialLink] = useState<PairingLink | null>(null);
  const [menuBridge, setMenuBridge] = useState<AgentBridge | null>(null);
  const [renaming, setRenaming] = useState<AgentBridge | null>(null);
  const [copied, setCopied] = useState(false);
  const [checkToken, setCheckToken] = useState(0);
  const [focusToken, setFocusToken] = useState(0);
  const [guideVisible, setGuideVisible] = useState(false);

  const params = route.params;
  const pairUrl = params?.url;
  const pairToken = params?.token;
  const pairName = params?.name;

  // A pairing deep link only opens the confirm step; saving always needs an explicit tap.
  useEffect(() => {
    if (!pairUrl || !pairToken) return;
    try {
      setInitialLink({ url: normalizeBridgeUrl(pairUrl), token: pairToken, ...(pairName ? { name: pairName } : {}) });
    } catch {
      setInitialLink(null);
    }
    setAddVisible(true);
    navigation.setParams({ pair: undefined, url: undefined, token: undefined, name: undefined });
  }, [pairUrl, pairToken, pairName, navigation]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      setFocusToken((token) => token + 1);
      setStatuses(Object.fromEntries(bridges.map((bridge) => [bridge.id, { state: 'checking' } as const])));
      for (const bridge of bridges) {
        void (async () => {
          try {
            const token = await getBridgeToken(bridge.id);
            if (!token) throw new BridgeError('unauthorized', 'No token stored for this bridge');
            const probe = await probeBridge(bridge.url, token, controller.signal);
            if (!controller.signal.aborted) {
              setStatuses((previous) => ({ ...previous, [bridge.id]: { state: 'online', probe } }));
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              setStatuses((previous) => ({ ...previous, [bridge.id]: { state: 'offline', error } }));
            }
          }
        })();
      }
      return () => controller.abort();
    // `checkToken` is a refresh trigger (retry button / bridge saved), not a value the probe reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bridges, checkToken]),
  );

  const handleOpenThread = useCallback(
    (threadId: string) => navigation.navigate('ChatScreen', { threadId }),
    [navigation],
  );

  const handleCopyCommand = useCallback(async () => {
    await Clipboard.setStringAsync(BRIDGE_INSTALL_COMMAND);
    HapticService.success();
    setCopied(true);
  }, []);

  const handleRemove = useCallback(
    (bridge: AgentBridge) => {
      Alert.alert(t('agents.remove.title', { name: bridge.name }), t('agents.remove.body'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => {
            void removeBridge(bridge.id).then(() => HapticService.success());
          },
        },
      ]);
    },
    [removeBridge, t],
  );

  const handleRename = useCallback(
    (name: string) => {
      const target = renaming;
      setRenaming(null);
      if (target) void updateBridge(target.id, { name });
    },
    [renaming, updateBridge],
  );

  const menuItems = useMemo(
    () =>
      menuBridge
        ? [
            {
              icon: 'refresh-outline' as const,
              label: t('agents.menu.recheck'),
              testID: 'agent-bridges.menu.recheck',
              onPress: () => setCheckToken((token) => token + 1),
            },
            {
              icon: 'pencil-outline' as const,
              label: t('agents.menu.rename'),
              testID: 'agent-bridges.menu.rename',
              onPress: () => setRenaming(menuBridge),
            },
            {
              icon: 'trash-outline' as const,
              label: t('common.remove'),
              destructive: true,
              testID: 'agent-bridges.menu.remove',
              onPress: () => handleRemove(menuBridge),
            },
          ]
        : [],
    [menuBridge, handleRemove, t],
  );

  const blocked = useProScreenGuard();
  if (blocked) return null;

  const renderStatus = (bridge: AgentBridge) => {
    const status = statuses[bridge.id] ?? { state: 'checking' as const };
    const dot =
      status.state === 'online' ? colors.success : status.state === 'offline' ? colors.error : colors.textSecondary;
    const detail =
      status.state === 'online'
        ? status.probe.agents.filter((agent) => agent.available).map((agent) => agent.name).join(', ') ||
          t('agents.noAgentsAvailable')
        : status.state === 'offline'
          ? bridgeErrorMessage(t, status.error)
          : t('agents.status.checking');
    return { dot, detail, state: status.state };
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={bridges.some((bridge) => statuses[bridge.id]?.state === 'checking')}
            onRefresh={() => setCheckToken((token) => token + 1)}
            tintColor={colors.textSecondary}
          />
        }
        contentContainerStyle={{ paddingTop: headerHeight + spacing[3], paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[4] }}
      >
        {bridges.length === 0 ? (
          <EmptyState
            testID="agent-bridges.empty"
            icon="desktop-outline"
            title={t('agents.empty.title')}
            subtitle={t('agents.empty.body')}
            actionLabel={t('agents.add.title')}
            onAction={() => {
              setInitialLink(null);
              setAddVisible(true);
            }}
            actionTestID="agent-bridges.empty.add"
          />
        ) : (
          <Group title={t('agents.bridgesTitle')}>
            {bridges.map((bridge) => {
              const { dot, detail, state } = renderStatus(bridge);
              return (
                <GroupRow
                  key={bridge.id}
                  testID={`agent-bridges.row.${bridge.id}`}
                  onPress={() => setMenuBridge(bridge)}
                  accessibilityRole="button"
                  leading={
                    <View
                      testID={`agent-bridges.status.${bridge.id}.${state}`}
                      accessibilityLabel={t(`agents.status.${state}`)}
                      style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }}
                    />
                  }
                  trailing={<Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />}
                >
                  <Text style={{ color: colors.text, fontSize: type.md, fontWeight: '500' }} numberOfLines={1}>
                    {bridge.name}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }} numberOfLines={1}>
                    {bridgeHost(bridge.url)}
                  </Text>
                  <Text
                    testID={`agent-bridges.detail.${bridge.id}`}
                    style={{ color: colors.textSecondary, fontSize: type.xs, marginTop: 2 }}
                    numberOfLines={2}
                  >
                    {detail}
                  </Text>
                </GroupRow>
              );
            })}
          </Group>
        )}

        {bridges.map((bridge) => (
          <OpenSessionsList
            key={bridge.id}
            bridge={bridge}
            refreshToken={focusToken + checkToken}
            onOpenThread={handleOpenThread}
          />
        ))}

        <Group title={t('agents.help.title')} footer={t('agents.help.footer')}>
          <GroupRow>
            <Text style={{ color: colors.textSecondary, fontSize: type.sm }}>{t('agents.help.body')}</Text>
          </GroupRow>
          <GroupRow
            trailing={
              <Button
                testID="agent-bridges.help.copy"
                size="xs"
                variant="secondary"
                label={copied ? t('agents.help.copied') : t('common.copy')}
                onPress={() => void handleCopyCommand()}
              />
            }
          >
            <Text
              testID="agent-bridges.help.command"
              selectable
              style={{ color: colors.text, fontSize: type.sm, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}
            >
              {BRIDGE_INSTALL_COMMAND}
            </Text>
          </GroupRow>
          <GroupRow
            testID="agent-bridges.help.readme"
            accessibilityRole="link"
            onPress={() => void Linking.openURL(BRIDGE_README_URL)}
            trailing={<Ionicons name="open-outline" size={16} color={colors.textSecondary} />}
          >
            <Text style={{ color: colors.primary, fontSize: type.sm, fontWeight: '500' }}>{t('agents.help.readme')}</Text>
          </GroupRow>
        </Group>
      </ScrollView>

      <AddBridgeModal
        visible={addVisible}
        initialLink={initialLink}
        onClose={() => {
          setAddVisible(false);
          setInitialLink(null);
        }}
        onSaved={() => setCheckToken((token) => token + 1)}
      />

      <ContextMenu
        visible={menuBridge !== null}
        onClose={() => setMenuBridge(null)}
        title={menuBridge?.name}
        subtitle={menuBridge ? bridgeHost(menuBridge.url) : undefined}
        headerIcon="desktop-outline"
        items={menuItems}
        bottomSheet
      />

      <TextPromptModal
        visible={renaming !== null}
        title={t('agents.rename.title')}
        initialValue={renaming?.name ?? ''}
        confirmLabel={t('common.save')}
        testIDPrefix="agent-bridges.rename"
        onConfirm={handleRename}
        onCancel={() => setRenaming(null)}
      />

      <BridgeSetupGuide visible={guideVisible} onClose={() => setGuideVisible(false)} />

      <ScreenHeader
        title={t('agents.title')}
        onBack={safeBack}
        actions={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
            <IconButton
              testID="agent-bridges.button.guide"
              size="sm"
              accessibilityLabel={t('agents.guide.title')}
              onPress={() => setGuideVisible(true)}
            >
              <Ionicons name="help-circle-outline" size={20} color={colors.accent} />
            </IconButton>
          <IconButton
            testID="agent-bridges.button.add"
            size="sm"
            accessibilityLabel={t('agents.add.title')}
            onPress={() => {
              setInitialLink(null);
              setAddVisible(true);
            }}
          >
            <Ionicons name="add" size={20} color={colors.accent} />
          </IconButton>
          </View>
        }
      />
    </SafeAreaView>
  );
}

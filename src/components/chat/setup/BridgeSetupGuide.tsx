import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { BRIDGE_PROTOCOL_VERSION, type BridgeFeature } from '../../../../bridge/src/protocol';
import { useTokens } from '../../../contexts/ThemeContext';
import { probeBridge } from '../../../services/agent/bridgeApi';
import { getBridgeToken } from '../../../services/agent/bridgeSecrets';
import { BridgeError, type AgentBridge, type BridgeProbeResult } from '../../../services/agent/types';
import { useAgentBridgeStore } from '../../../stores/agentBridgeStore';
import { HapticService } from '../../../utils/haptics';
import { bridgeErrorMessage } from '../../agent/bridgeErrors';
import { bridgeHost } from '../../agent/format';
import { Button, Modal } from '../../ui';
import { CARD_RADIUS, CHAT_TYPE, CONTINUOUS_CORNERS, HAIRLINE, MONO_FONT } from '../chatStyle';

export const BRIDGE_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/skepjandi/gitnotes/main/bridge/install.sh | sh';
export const BRIDGE_START_COMMAND = 'gitnotes-bridge';
export const BRIDGE_README_URL = 'https://github.com/skepjandi/gitnotes/tree/main/bridge#readme';

const COPIED_RESET_MS = 2000;
const ALL_FEATURES: BridgeFeature[] = ['fs-search', 'git', 'ports'];
const ROUTES = [
  { id: 'tailscale', icon: 'shield-checkmark-outline', example: 'wss://<machine>.<tailnet>.ts.net' },
  { id: 'lan', icon: 'wifi-outline', example: 'ws://192.168.x.y:7878' },
  { id: 'tunnel', icon: 'cloud-outline', example: 'wss://<your-tunnel-host>' },
] as const;

type CheckState =
  | { phase: 'checking' }
  | { phase: 'done'; probe: BridgeProbeResult }
  | { phase: 'failed'; error: unknown };

export interface BridgeSetupGuideProps {
  visible: boolean;
  onClose: () => void;
  /** Shows the "Try the demo agent" button; the caller owns thread creation and navigation. */
  onTryDemo?: () => void;
  demoBusy?: boolean;
}

function CommandRow({ testID, command }: { testID: string; command: string }) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    await Clipboard.setStringAsync(command);
    void HapticService.success();
    setCopied(true);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing[2],
        padding: spacing[2],
        borderRadius: CARD_RADIUS,
        backgroundColor: colors.surface,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        ...CONTINUOUS_CORNERS,
      }}
    >
      <Text
        testID={`${testID}.command`}
        selectable
        style={{ flex: 1, ...CHAT_TYPE.caption, color: colors.text, fontFamily: MONO_FONT }}
      >
        {command}
      </Text>
      <Button
        testID={`${testID}.copy`}
        size="xs"
        variant="secondary"
        label={copied ? t('agents.help.copied') : t('common.copy')}
        onPress={() => void copy()}
      />
    </View>
  );
}

function Step({ index, title, children }: { index: number; title: string; children?: ReactNode }) {
  const { colors, spacing } = useTokens();
  return (
    <View style={{ flexDirection: 'row', gap: spacing[3] }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${colors.primary}1F`,
        }}
      >
        <Text style={{ ...CHAT_TYPE.caption, color: colors.primary, fontWeight: '700' }}>{index}</Text>
      </View>
      <View style={{ flex: 1, gap: spacing[2] }}>
        <Text style={{ ...CHAT_TYPE.body, color: colors.text, fontWeight: '600' }}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const { colors, spacing } = useTokens();
  return (
    <Text
      style={{
        ...CHAT_TYPE.caption,
        color: colors.textSecondary,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginTop: spacing[5],
        marginBottom: spacing[2],
      }}
    >
      {children}
    </Text>
  );
}

function CheckLine({ testID, ok, label, detail }: { testID: string; ok: boolean; label: string; detail?: string }) {
  const { colors, spacing } = useTokens();
  const tint = ok ? colors.success : colors.error;
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] }}>
      <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={16} color={tint} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...CHAT_TYPE.status, color: colors.text }}>{label}</Text>
        {detail ? <Text style={{ ...CHAT_TYPE.caption, color: colors.textSecondary }}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function BridgeDiagnostics({ bridge }: { bridge: AgentBridge }) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  const [state, setState] = useState<CheckState | null>(null);

  const check = useCallback(async () => {
    setState({ phase: 'checking' });
    try {
      const token = await getBridgeToken(bridge.id);
      if (!token) throw new BridgeError('unauthorized', 'No token stored for this bridge');
      setState({ phase: 'done', probe: await probeBridge(bridge.url, token) });
    } catch (error) {
      setState({ phase: 'failed', error });
    }
  }, [bridge.id, bridge.url]);

  const id = bridge.id;
  const failedMismatch = state?.phase === 'failed' && state.error instanceof BridgeError && state.error.kind === 'protocol-mismatch';

  return (
    <View
      testID={`bridge-guide.bridge.${id}`}
      style={{
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: CARD_RADIUS,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        ...CONTINUOUS_CORNERS,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...CHAT_TYPE.body, color: colors.text, fontWeight: '600' }} numberOfLines={1}>
            {bridge.name}
          </Text>
          <Text style={{ ...CHAT_TYPE.caption, color: colors.textSecondary }} numberOfLines={1}>
            {bridgeHost(bridge.url)}
          </Text>
        </View>
        <Button
          testID={`bridge-guide.check.${id}`}
          size="sm"
          variant="secondary"
          label={t('agents.guide.check')}
          disabled={state?.phase === 'checking'}
          onPress={() => void check()}
        />
      </View>

      {state?.phase === 'checking' ? (
        <ActivityIndicator testID={`bridge-guide.checking.${id}`} size="small" color={colors.textSecondary} style={{ alignSelf: 'flex-start' }} />
      ) : null}

      {state?.phase === 'failed' ? (
        <>
          <CheckLine
            testID={`bridge-guide.reachable.${id}`}
            ok={failedMismatch}
            label={failedMismatch ? t('agents.guide.reachable') : t('agents.guide.unreachable')}
            detail={failedMismatch ? undefined : bridgeErrorMessage(t, state.error)}
          />
          {failedMismatch ? (
            <CheckLine
              testID={`bridge-guide.protocol.${id}`}
              ok={false}
              label={t('agents.guide.protocolMismatch', { expected: BRIDGE_PROTOCOL_VERSION })}
              detail={bridgeErrorMessage(t, state.error)}
            />
          ) : null}
        </>
      ) : null}

      {state?.phase === 'done' ? (
        <>
          <CheckLine testID={`bridge-guide.reachable.${id}`} ok label={t('agents.guide.reachable')} />
          <CheckLine
            testID={`bridge-guide.protocol.${id}`}
            ok
            label={t('agents.guide.protocolOk', { version: BRIDGE_PROTOCOL_VERSION })}
            detail={t('agents.guide.bridgeVersion', { version: state.probe.bridgeVersion })}
          />
          {state.probe.agents.length === 0 ? (
            <CheckLine testID={`bridge-guide.agents.${id}`} ok={false} label={t('agents.noAgentsReported')} />
          ) : (
            state.probe.agents.map((agent) => (
              <CheckLine
                key={agent.id}
                testID={`bridge-guide.agent.${id}.${agent.id}`}
                ok={agent.available}
                label={agent.name}
                detail={agent.available ? undefined : t('agents.agentNotInstalled', { command: agent.command })}
              />
            ))
          )}
          {ALL_FEATURES.map((feature) => (
            <CheckLine
              key={feature}
              testID={`bridge-guide.feature.${id}.${feature}`}
              ok={(state.probe.features ?? []).includes(feature)}
              label={t(`agents.guide.features.${feature}`)}
            />
          ))}
          {ALL_FEATURES.some((feature) => !(state.probe.features ?? []).includes(feature)) ? (
            <Text testID={`bridge-guide.update-hint.${id}`} style={{ ...CHAT_TYPE.caption, color: colors.warning }}>
              {t('agents.guide.updateHint')}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** Bottom sheet that explains how the bridge fits together and checks each paired bridge. */
export function BridgeSetupGuide({ visible, onClose, onTryDemo, demoBusy }: BridgeSetupGuideProps) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  const bridges = useAgentBridgeStore((state) => state.bridges);

  return (
    <Modal visible={visible} onRequestClose={onClose} bottomSheet contentStyle={{ padding: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
          borderBottomWidth: HAIRLINE,
          borderBottomColor: colors.border,
        }}
      >
        <Text style={{ flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' }}>{t('agents.guide.title')}</Text>
        <Pressable
          testID="bridge-guide.close"
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          hitSlop={8}
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 560 }}
        contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[6] }}
      >
        <Text style={{ ...CHAT_TYPE.status, color: colors.textSecondary, marginBottom: spacing[4] }}>
          {t('agents.guide.intro')}
        </Text>
        <View style={{ gap: spacing[4] }}>
          <Step index={1} title={t('agents.guide.step1')}>
            <CommandRow testID="bridge-guide.install" command={BRIDGE_INSTALL_COMMAND} />
          </Step>
          <Step index={2} title={t('agents.guide.step2')}>
            <CommandRow testID="bridge-guide.start" command={BRIDGE_START_COMMAND} />
          </Step>
          <Step index={3} title={t('agents.guide.step3')}>
            <Text style={{ ...CHAT_TYPE.status, color: colors.textSecondary }}>{t('agents.guide.step3Body')}</Text>
          </Step>
        </View>

        <SectionTitle>{t('agents.guide.reachTitle')}</SectionTitle>
        <View style={{ gap: spacing[3] }}>
          {ROUTES.map((route) => (
            <View key={route.id} testID={`bridge-guide.route.${route.id}`} style={{ flexDirection: 'row', gap: spacing[3] }}>
              <Ionicons name={route.icon} size={18} color={colors.textSecondary} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...CHAT_TYPE.status, color: colors.text, fontWeight: '600' }}>
                  {t(`agents.guide.routes.${route.id}.name`)}
                </Text>
                <Text style={{ ...CHAT_TYPE.caption, color: colors.textSecondary, fontFamily: MONO_FONT }}>{route.example}</Text>
                <Text style={{ ...CHAT_TYPE.caption, color: colors.textSecondary }}>
                  {t(`agents.guide.routes.${route.id}.note`)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {bridges.length > 0 ? (
          <>
            <SectionTitle>{t('agents.guide.diagnosticsTitle')}</SectionTitle>
            <View style={{ gap: spacing[3] }}>
              {bridges.map((bridge) => (
                <BridgeDiagnostics key={bridge.id} bridge={bridge} />
              ))}
            </View>
          </>
        ) : null}

        <View style={{ gap: spacing[2], marginTop: spacing[5] }}>
          {onTryDemo ? (
            <Button
              testID="bridge-guide.demo"
              variant="primary"
              label={t('agents.guide.tryDemo')}
              disabled={demoBusy}
              onPress={onTryDemo}
              leadingIcon={<Ionicons name="rocket-outline" size={18} color={colors.accent} />}
              fullWidth
            />
          ) : null}
          <Button
            testID="bridge-guide.readme"
            variant="secondary"
            label={t('agents.help.readme')}
            onPress={() => void Linking.openURL(BRIDGE_README_URL)}
            fullWidth
          />
        </View>
      </ScrollView>
    </Modal>
  );
}

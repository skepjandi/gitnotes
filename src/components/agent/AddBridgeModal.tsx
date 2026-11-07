import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { probeBridge } from '../../services/agent/bridgeApi';
import { normalizeBridgeUrl, parsePairingLink } from '../../services/agent/pairing';
import type { AgentBridge, PairingLink } from '../../services/agent/types';
import { useAgentBridgeStore } from '../../stores/agentBridgeStore';
import { HapticService } from '../../utils/haptics';
import { Button, Input, Modal } from '../ui';
import { bridgeErrorMessage } from './bridgeErrors';
import { bridgeHost } from './format';

type Phase = 'input' | 'confirm';
type InputMode = 'link' | 'manual';

export interface AddBridgeModalProps {
  visible: boolean;
  /** Pairing details that arrived from a deep link; opens straight on the confirm step, never saves on its own. */
  initialLink?: PairingLink | null;
  onClose: () => void;
  onSaved?: (bridge: AgentBridge) => void;
}

export function AddBridgeModal({ visible, initialLink, onClose, onSaved }: AddBridgeModalProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const bridges = useAgentBridgeStore((state) => state.bridges);
  const addBridge = useAgentBridgeStore((state) => state.addBridge);

  const [phase, setPhase] = useState<Phase>('input');
  const [mode, setMode] = useState<InputMode>('link');
  const [linkText, setLinkText] = useState('');
  const [urlText, setUrlText] = useState('');
  const [tokenText, setTokenText] = useState('');
  const [draft, setDraft] = useState<PairingLink | null>(null);
  const [nameText, setNameText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBusy(false);
    setLinkText('');
    setUrlText('');
    setTokenText('');
    setMode('link');
    if (initialLink) {
      setDraft(initialLink);
      setNameText(initialLink.name ?? '');
      setPhase('confirm');
    } else {
      setDraft(null);
      setNameText('');
      setPhase('input');
    }
  }, [visible, initialLink]);

  const handleContinue = () => {
    let next: PairingLink;
    if (mode === 'link') {
      const parsed = parsePairingLink(linkText);
      if (!parsed) {
        setError(t('agents.errors.invalidLink'));
        return;
      }
      next = parsed;
    } else {
      let url: string;
      try {
        url = normalizeBridgeUrl(urlText);
      } catch {
        setError(t('agents.errors.invalidUrl'));
        return;
      }
      const token = tokenText.trim();
      if (!token) {
        setError(t('agents.errors.missingToken'));
        return;
      }
      next = { url, token };
    }
    setError(null);
    setDraft(next);
    setNameText(next.name ?? '');
    setPhase('confirm');
  };

  const handleConnect = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const probe = await probeBridge(draft.url, draft.token);
      try {
        const bridge = await addBridge({ name: nameText.trim() || probe.hostname, url: draft.url, token: draft.token });
        HapticService.success();
        onSaved?.(bridge);
        onClose();
      } catch {
        setError(t('agents.errors.saveFailed'));
        HapticService.error();
      }
    } catch (probeError) {
      setError(bridgeErrorMessage(t, probeError));
      HapticService.error();
    } finally {
      setBusy(false);
    }
  };

  const alreadyPaired = draft ? bridges.some((bridge) => bridge.url === draft.url) : false;
  const cleartext = draft ? draft.url.startsWith('ws://') : false;

  const renderInput = () => (
    <>
      <Text style={{ color: colors.textSecondary, fontSize: type.sm, marginBottom: spacing[3] }}>
        {mode === 'link' ? t('agents.add.linkHint') : t('agents.add.manualHint')}
      </Text>
      {mode === 'link' ? (
        <Input
          testID="add-bridge.input.link"
          value={linkText}
          onChangeText={setLinkText}
          placeholder={t('agents.add.linkPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          multilineMinHeight={72}
        />
      ) : (
        <View style={{ gap: spacing[2] }}>
          <Input
            testID="add-bridge.input.url"
            value={urlText}
            onChangeText={setUrlText}
            placeholder={t('agents.add.urlPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Input
            testID="add-bridge.input.token"
            value={tokenText}
            onChangeText={setTokenText}
            placeholder={t('agents.add.tokenPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>
      )}
      <Pressable
        testID="add-bridge.button.switch-mode"
        accessibilityRole="button"
        onPress={() => {
          setError(null);
          setMode(mode === 'link' ? 'manual' : 'link');
        }}
        style={{ paddingVertical: spacing[2] }}
      >
        <Text style={{ color: colors.accent, fontSize: type.sm, fontWeight: '600' }}>
          {mode === 'link' ? t('agents.add.useManual') : t('agents.add.useLink')}
        </Text>
      </Pressable>
    </>
  );

  const renderConfirm = (link: PairingLink) => (
    <>
      <View
        testID="add-bridge.confirm"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[3],
          padding: spacing[3],
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Ionicons name="desktop-outline" size={24} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.textSecondary, fontSize: type.xs }}>{t('agents.confirm.host')}</Text>
          <Text testID="add-bridge.confirm.host" selectable style={{ color: colors.text, fontSize: type.md, fontWeight: '600' }}>
            {bridgeHost(link.url)}
          </Text>
        </View>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: type.sm, marginTop: spacing[3] }}>
        {t('agents.confirm.body')}
      </Text>
      {cleartext ? (
        <Text testID="add-bridge.confirm.cleartext" style={{ color: colors.warning, fontSize: type.sm, marginTop: spacing[2] }}>
          {t('agents.confirm.cleartext')}
        </Text>
      ) : null}
      {alreadyPaired ? (
        <Text testID="add-bridge.confirm.already-paired" style={{ color: colors.textSecondary, fontSize: type.sm, marginTop: spacing[2] }}>
          {t('agents.confirm.alreadyPaired')}
        </Text>
      ) : null}
      <View style={{ marginTop: spacing[3] }}>
        <Input
          testID="add-bridge.input.name"
          value={nameText}
          onChangeText={setNameText}
          placeholder={t('agents.add.namePlaceholder')}
          autoCapitalize="words"
        />
      </View>
    </>
  );

  return (
    <Modal visible={visible} onRequestClose={onClose} bottomSheet contentStyle={{ padding: spacing[5] }}>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
        <Text style={{ color: colors.text, fontSize: type.lg, fontWeight: '700', marginBottom: spacing[2] }}>
          {phase === 'input' ? t('agents.add.title') : t('agents.confirm.title')}
        </Text>
        {phase === 'confirm' && draft ? renderConfirm(draft) : renderInput()}
        {error ? (
          <Text testID="add-bridge.error" accessibilityRole="alert" style={{ color: colors.error, fontSize: type.sm, marginTop: spacing[2] }}>
            {error}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[4] }}>
          <View style={{ flex: 1 }}>
            <Button
              testID="add-bridge.button.cancel"
              variant="secondary"
              label={phase === 'confirm' && !initialLink ? t('common.back') : t('common.cancel')}
              onPress={phase === 'confirm' && !initialLink ? () => { setError(null); setPhase('input'); } : onClose}
              fullWidth
            />
          </View>
          <View style={{ flex: 1 }}>
            {phase === 'input' ? (
              <Button testID="add-bridge.button.continue" variant="primary" label={t('common.continue')} onPress={handleContinue} fullWidth />
            ) : (
              <Button
                testID="add-bridge.button.connect"
                variant="primary"
                label={busy ? t('common.connecting') : t('agents.confirm.connect')}
                disabled={busy}
                leadingIcon={busy ? <ActivityIndicator size="small" color="#ffffff" /> : undefined}
                onPress={() => void handleConnect()}
                fullWidth
              />
            )}
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}

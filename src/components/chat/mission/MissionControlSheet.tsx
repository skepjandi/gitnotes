import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../../contexts/ThemeContext';
import type { PermissionDecision, PermissionOptionKind } from '../../../services/chat/types';
import { Button, Modal, type ButtonVariant } from '../../ui';
import { ToolDiffView } from '../ToolDiffView';
import { PLAN_STATUS_ICONS, PLAN_STATUS_LABEL_KEYS } from '../toolPresentation';
import type { Mission, MissionChange, MissionSection } from './selectMission';

const VARIANT_BY_KIND: Record<PermissionOptionKind, ButtonVariant> = {
  allow_once: 'primary',
  allow_always: 'secondary',
  reject_once: 'danger',
  reject_always: 'outline',
};

export interface MissionControlSheetProps {
  visible: boolean;
  onClose: () => void;
  mission: Mission;
  onResolvePermission: (requestId: string, decision: PermissionDecision) => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function SectionHeader({ id, label }: { id: string; label: string }) {
  const { colors, spacing, type } = useTokens();
  return (
    <Text
      testID={`chat-mission.header.${id}`}
      accessibilityRole="header"
      style={{
        color: colors.textSecondary,
        fontSize: type.xs,
        fontWeight: '600',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: spacing[2],
      }}
    >
      {label}
    </Text>
  );
}

function Separator() {
  const { colors } = useTokens();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

function ChangeRow({ change }: { change: MissionChange }) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <View testID={`chat-mission.change.${change.path}`}>
      <Pressable
        testID={`chat-mission.change-toggle.${change.path}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((prev) => !prev)}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2] }}
      >
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color={colors.textSecondary}
          style={{ marginRight: spacing[2] }}
        />
        <Text
          numberOfLines={1}
          ellipsizeMode="head"
          style={{ flex: 1, color: colors.text, fontSize: type.sm }}
        >
          {change.path}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: type.xs, marginLeft: spacing[2] }}>
          {t(change.status === 'new' ? 'chat.mission.changeNew' : 'chat.mission.changeEdited')}
        </Text>
        <Text style={{ color: colors.success, fontSize: type.xs, marginLeft: spacing[2] }}>+{change.added}</Text>
        <Text style={{ color: colors.error, fontSize: type.xs, marginLeft: spacing[1] }}>-{change.removed}</Text>
      </Pressable>
      {open ? (
        <View testID={`chat-mission.change-diff.${change.path}`} style={{ paddingBottom: spacing[2] }}>
          <ToolDiffView diffs={[change.diff]} />
        </View>
      ) : null}
    </View>
  );
}

function SectionBody({
  section,
  onResolvePermission,
}: {
  section: MissionSection;
  onResolvePermission: MissionControlSheetProps['onResolvePermission'];
}) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();

  switch (section.type) {
    case 'needsYou':
      return (
        <View>
          <SectionHeader id="needsYou" label={t('chat.mission.needsYou')} />
          {section.requests.map((request) => (
            <View
              key={request.id}
              testID={`chat-mission.request.${request.id}`}
              style={{ paddingVertical: spacing[2] }}
            >
              <Text style={{ color: colors.text, fontSize: type.md, fontWeight: '600' }}>{request.title}</Text>
              {request.description ? (
                <Text style={{ color: colors.textSecondary, fontSize: type.sm, marginTop: spacing[1] }}>
                  {request.description}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] }}>
                {request.options.map((option) => {
                  const allow = option.kind.startsWith('allow');
                  const tint = option.kind === 'allow_once' || option.kind === 'reject_once' ? '#ffffff' : colors.text;
                  return (
                    <Button
                      key={option.id}
                      testID={`chat-mission.button.${request.id}.${option.id}`}
                      variant={VARIANT_BY_KIND[option.kind]}
                      size="sm"
                      label={option.label}
                      onPress={() => onResolvePermission(request.id, { optionId: option.id })}
                      leadingIcon={<Ionicons name={allow ? 'checkmark' : 'close'} size={16} color={tint} />}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      );
    case 'plan':
      return (
        <View>
          <SectionHeader id="plan" label={`${t('chat.mission.plan')} ${section.completed}/${section.total}`} />
          {section.entries.map((entry, index) => {
            const done = entry.status === 'completed';
            const active = entry.status === 'in_progress';
            return (
              <View
                key={`${index}-${entry.content}`}
                testID={`chat-mission.plan-entry.${entry.status}`}
                accessible
                accessibilityLabel={`${t(PLAN_STATUS_LABEL_KEYS[entry.status])}: ${entry.content}`}
                style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 3 }}
              >
                <Ionicons
                  name={PLAN_STATUS_ICONS[entry.status]}
                  size={18}
                  color={done ? colors.success : active ? colors.primary : colors.textSecondary}
                  style={{ marginRight: spacing[2], marginTop: 1 }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontSize: type.sm,
                    lineHeight: 20,
                    fontWeight: active ? '600' : '400',
                    color: done ? colors.textSecondary : colors.text,
                    textDecorationLine: done ? 'line-through' : 'none',
                  }}
                >
                  {entry.content}
                </Text>
              </View>
            );
          })}
        </View>
      );
    case 'changes':
      return (
        <View>
          <SectionHeader id="changes" label={`${t('chat.mission.changes')} ${section.changes.length}`} />
          {section.changes.map((change, index) => (
            <View key={change.path}>
              {index > 0 ? <Separator /> : null}
              <ChangeRow change={change} />
            </View>
          ))}
        </View>
      );
    case 'activity': {
      const { commands, filesRead, filesEdited, searches, failed } = section.activity;
      const rows: { id: string; label: string; count: number }[] = [
        { id: 'commands', label: t('chat.mission.commands'), count: commands },
        { id: 'filesRead', label: t('chat.mission.filesRead'), count: filesRead },
        { id: 'filesEdited', label: t('chat.mission.filesEdited'), count: filesEdited },
        { id: 'searches', label: t('chat.mission.searches'), count: searches },
        { id: 'failed', label: t('chat.mission.failed'), count: failed },
      ].filter((row) => row.count > 0);
      return (
        <View>
          <SectionHeader id="activity" label={t('chat.mission.activity')} />
          {rows.map((row, index) => (
            <View key={row.id}>
              {index > 0 ? <Separator /> : null}
              <View
                testID={`chat-mission.activity.${row.id}`}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[2] }}
              >
                <Text style={{ color: colors.text, fontSize: type.sm }}>{row.label}</Text>
                <Text style={{ color: row.id === 'failed' ? colors.error : colors.textSecondary, fontSize: type.sm }}>
                  {row.count}
                </Text>
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'status': {
      const rows: { id: string; label: string; value: string }[] = [];
      if (section.agentName) rows.push({ id: 'agent', label: t('chat.mission.agent'), value: section.agentName });
      if (section.workspace) rows.push({ id: 'workspace', label: t('chat.mission.workspace'), value: section.workspace });
      if (section.modeName) rows.push({ id: 'mode', label: t('chat.mission.mode'), value: section.modeName });
      rows.push({ id: 'state', label: t('chat.mission.state'), value: t(`chat.mission.state_${section.state}`) });
      if (section.elapsedMs !== null) {
        rows.push({ id: 'elapsed', label: t('chat.mission.elapsed'), value: formatElapsed(section.elapsedMs) });
      }
      rows.push({ id: 'messages', label: t('chat.mission.messages'), value: String(section.messageCount) });
      return (
        <View>
          <SectionHeader id="status" label={t('chat.mission.status')} />
          {rows.map((row, index) => (
            <View key={row.id}>
              {index > 0 ? <Separator /> : null}
              <View
                testID={`chat-mission.status.${row.id}`}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[2] }}
              >
                <Text style={{ color: colors.text, fontSize: type.sm }}>{row.label}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: type.sm, marginLeft: spacing[3], flexShrink: 1 }}>
                  {row.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      );
    }
  }
}

export interface MissionControlContentProps {
  mission: Mission;
  onResolvePermission: MissionControlSheetProps['onResolvePermission'];
}

export function MissionControlContent({ mission, onResolvePermission }: MissionControlContentProps) {
  const { colors, type } = useTokens();
  const { t } = useTranslation();

  return (
    <ScrollView testID="chat-mission.content" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {mission.sections.length === 0 ? (
        <Text testID="chat-mission.empty" style={{ color: colors.textSecondary, fontSize: type.sm }}>
          {t('chat.mission.empty')}
        </Text>
      ) : (
        mission.sections.map((section, index) => (
          <View key={section.type} style={{ marginTop: index === 0 ? 0 : 26 }}>
            <SectionBody section={section} onResolvePermission={onResolvePermission} />
          </View>
        ))
      )}
    </ScrollView>
  );
}

export function MissionControlSheet({ visible, onClose, mission, onResolvePermission }: MissionControlSheetProps) {
  const { colors, type } = useTokens();
  const { t } = useTranslation();

  return (
    <Modal visible={visible} onRequestClose={onClose} bottomSheet accessibilityLabel={t('chat.mission.title')}>
      <View testID="chat-mission.sheet" style={{ maxHeight: '100%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16 }}>
          <Text style={{ flex: 1, color: colors.text, fontSize: type.lg, fontWeight: '700' }}>
            {t('chat.mission.title')}
          </Text>
          <Pressable
            testID="chat-mission.close"
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            hitSlop={8}
            onPress={onClose}
          >
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <MissionControlContent mission={mission} onResolvePermission={onResolvePermission} />
      </View>
    </Modal>
  );
}

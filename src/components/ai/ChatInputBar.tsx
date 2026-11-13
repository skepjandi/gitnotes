import React, { useMemo, useState, type ReactNode } from 'react';
import { View, TextInput, ScrollView, TouchableOpacity, Text, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { AIContextItem } from '../../models/AIProvider';
import type { AgentCommand } from '../../models/Chat';
import { matchSlashCommands } from '../chat/slashCommands';
import { IconButton } from '../ui/IconButton';

export interface ChatInputBarProps {
  onSend: (text: string) => void;
  onAttach: () => void;
  onVoicePress?: () => void;
  attachedContexts: AIContextItem[];
  onRemoveContext: (index: number) => void;
  /** A turn is running: sending queues the prompt instead of starting it. */
  isStreaming: boolean;
  onStop?: () => void;
  disabled?: boolean;
  contextWarning?: { level: 'caution' | 'over' | 'none'; message: string } | null;
  value?: string;
  onChangeText?: (text: string) => void;
  /** Slash commands the connected agent advertises. */
  commands?: AgentCommand[];
  /** Controls shown beside the send button (mode picker). */
  accessory?: ReactNode;
}

export function ChatInputBar({
  onSend,
  onAttach,
  onVoicePress,
  attachedContexts,
  onRemoveContext,
  isStreaming,
  onStop,
  disabled,
  contextWarning,
  value,
  onChangeText,
  commands,
  accessory,
}: ChatInputBarProps) {
  const [internalText, setInternalText] = useState('');
  const isControlled = value !== undefined && !!onChangeText;
  const text = isControlled ? value : internalText;
  const handleTextChange = isControlled ? onChangeText : setInternalText;
  const { colors, spacing, type } = useTokens();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const hasText = text.trim().length > 0;
  const showStop = isStreaming && !hasText && Boolean(onStop);
  const suggestions = useMemo(() => matchSlashCommands(text, commands), [text, commands]);

  const handleSend = () => {
    if (!hasText || disabled) return;
    onSend(text);
    handleTextChange('');
  };

  const sendDisabled = !hasText || disabled;
  const warningTint = contextWarning?.level === 'over' ? colors.error : colors.warning;

  return (
    <View
      style={{
        paddingHorizontal: spacing[3],
        paddingTop: spacing[1],
        paddingBottom: Math.max(insets.bottom, spacing[2]),
      }}
    >
      {suggestions.length > 0 ? (
        <View
          testID="chat-input.slash-palette"
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.elevated,
            marginBottom: spacing[2],
            overflow: 'hidden',
          }}
        >
          {suggestions.map((command) => (
            <Pressable
              key={command.name}
              testID={`chat-input.slash.${command.name}`}
              accessibilityRole="button"
              onPress={() => handleTextChange(`/${command.name} `)}
              style={{ paddingHorizontal: spacing[3], paddingVertical: spacing[2] }}
            >
              <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600' }}>
                {`/${command.name}`}
                {command.hint ? <Text style={{ color: colors.textSecondary, fontWeight: '400' }}>{` ${command.hint}`}</Text> : null}
              </Text>
              {command.description ? (
                <Text style={{ color: colors.textSecondary, fontSize: type.xs }} numberOfLines={1}>
                  {command.description}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {contextWarning && contextWarning.message ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], marginBottom: spacing[2] }}>
          <Ionicons name={contextWarning.level === 'over' ? 'alert-circle' : 'warning-outline'} size={14} color={warningTint} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: type.xs, color: warningTint }}>{contextWarning.message}</Text>
        </View>
      ) : null}

      <View
        style={{
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.elevated,
          paddingHorizontal: spacing[3],
          paddingTop: spacing[2],
          paddingBottom: spacing[2],
        }}
      >
        {attachedContexts.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing[2] }}>
            {attachedContexts.map((ctx, index) => (
              <View
                key={`${ctx.type}-${ctx.owner}-${ctx.repo}-${ctx.path}-${index}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 999,
                  paddingHorizontal: spacing[2],
                  paddingVertical: 3,
                  marginRight: spacing[2],
                }}
              >
                <Ionicons
                  name={ctx.type === 'file' || ctx.type === 'local-notes' ? 'document-text-outline' : 'folder-outline'}
                  size={13}
                  color={colors.accent}
                  style={{ marginRight: spacing[1] }}
                />
                <Text style={{ fontSize: type.xs, color: colors.text, marginRight: spacing[1] }}>{ctx.name}</Text>
                <TouchableOpacity onPress={() => onRemoveContext(index)} hitSlop={8}>
                  <Ionicons name="close-circle" size={15} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <TextInput
          testID="chat-input.input.message"
          style={{
            minHeight: 36,
            maxHeight: 140,
            color: colors.text,
            fontSize: 16,
            paddingTop: Platform.OS === 'ios' ? 6 : 4,
            paddingBottom: 6,
            paddingHorizontal: 0,
          }}
          placeholder={isStreaming ? t('chat.queueMessage') : t('chat.typeMessage')}
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="sentences"
          multiline
          value={text}
          onChangeText={handleTextChange}
          editable={!disabled}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
          <IconButton
            variant="ghost"
            size="sm"
            onPress={onAttach}
            disabled={disabled}
            accessibilityLabel={t('chat.attachContext')}
          >
            <Ionicons name="add" size={22} color={colors.textSecondary} />
          </IconButton>
          {onVoicePress ? (
            <IconButton
              variant="ghost"
              size="sm"
              onPress={onVoicePress}
              disabled={disabled}
              accessibilityLabel={t('editor.voiceInput')}
            >
              <Ionicons name="mic-outline" size={20} color={colors.textSecondary} />
            </IconButton>
          ) : null}
          {accessory}
          <View style={{ flex: 1 }} />
          {showStop ? (
            <TouchableOpacity
              testID="chat-input.button.stop"
              accessibilityRole="button"
              accessibilityLabel={t('chat.stopGeneration')}
              onPress={onStop}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.text,
              }}
            >
              <Ionicons name="stop" size={14} color={colors.background} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              testID="chat-input.button.send"
              accessibilityRole="button"
              accessibilityLabel={isStreaming ? t('chat.queueSend') : t('chat.send')}
              onPress={handleSend}
              disabled={sendDisabled}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: sendDisabled ? colors.border : colors.primary,
              }}
            >
              <Ionicons name={isStreaming ? 'time-outline' : 'arrow-up'} size={18} color={sendDisabled ? colors.textSecondary : '#ffffff'} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

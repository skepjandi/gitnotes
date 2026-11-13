import React, { useMemo, useState, type ReactNode } from 'react';
import { View, TextInput, ScrollView, TouchableOpacity, Text, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import { AIContextItem } from '../../models/AIProvider';
import type { AgentCommand, ImageAttachment } from '../../models/Chat';
import type { FileMatch } from '../../services/agent/bridgeTools';
import ContextMenu, { type ContextMenuItem } from '../ContextMenu';
import { ImageThumbnails } from '../chat/composer/ImageThumbnails';
import { MentionPalette } from '../chat/composer/MentionPalette';
import { applyMention } from '../chat/composer/mentions';
import { useFileMentions, type FileSearch } from '../chat/composer/useFileMentions';
import type { ImageSource } from '../chat/composer/useImageAttachments';
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
  /** Controls shown beside the send button (model / effort / mode chips). */
  accessory?: ReactNode;
  /** Images staged for the next prompt. */
  attachedImages?: ImageAttachment[];
  onRemoveImage?: (imageId: string) => void;
  onImagePress?: (image: ImageAttachment) => void;
  /** Present only when the agent accepts images; turns the '+' button into a Notes / Photos / Camera menu. */
  onPickImage?: (source: ImageSource) => void;
  /** Present only when the bridge can search files; enables `@` mentions. */
  fileSearch?: FileSearch;
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
  attachedImages = [],
  onRemoveImage,
  onImagePress,
  onPickImage,
  fileSearch,
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
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const { mention, results: mentionResults } = useFileMentions(
    text,
    selection ? selection.end : text.length,
    fileSearch,
    suggestions.length === 0,
  );

  const changeText = (next: string) => {
    setSelection(null);
    setForcedSelection(undefined);
    handleTextChange(next);
  };

  const pickMention = (match: FileMatch) => {
    if (!mention) return;
    const applied = applyMention(text, mention, match.path, match.isDir);
    handleTextChange(applied.text);
    setSelection({ start: applied.caret, end: applied.caret });
    setForcedSelection({ start: applied.caret, end: applied.caret });
  };

  const attachItems = useMemo<ContextMenuItem[]>(
    () =>
      onPickImage
        ? [
            { icon: 'document-text-outline', label: t('chat.attachNotes'), testID: 'chat-input.attach.notes', onPress: onAttach },
            { icon: 'images-outline', label: t('chat.images.library'), testID: 'chat-input.attach.library', onPress: () => onPickImage('library') },
            { icon: 'camera-outline', label: t('chat.images.camera'), testID: 'chat-input.attach.camera', onPress: () => onPickImage('camera') },
          ]
        : [],
    [onPickImage, onAttach, t],
  );

  const handleSend = () => {
    if (!hasText || disabled) return;
    onSend(text);
    changeText('');
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
              onPress={() => changeText(`/${command.name} `)}
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

      {mention ? <MentionPalette results={mentionResults} onSelect={pickMention} /> : null}

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

        {attachedImages.length > 0 && onRemoveImage ? (
          <ImageThumbnails images={attachedImages} onRemove={onRemoveImage} onPress={onImagePress} />
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
          onChangeText={changeText}
          onSelectionChange={(event) => {
            setSelection(event.nativeEvent.selection);
            setForcedSelection(undefined);
          }}
          selection={forcedSelection}
          editable={!disabled}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
          <IconButton
            variant="ghost"
            size="sm"
            testID="chat-input.button.attach"
            onPress={onPickImage ? () => setAttachMenuOpen(true) : onAttach}
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

      {onPickImage ? (
        <ContextMenu
          visible={attachMenuOpen}
          onClose={() => setAttachMenuOpen(false)}
          title={t('chat.attachContext')}
          headerIcon="attach-outline"
          items={attachItems}
          bottomSheet
        />
      ) : null}
    </View>
  );
}

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../models/Chat';
import ContextMenu, { type ContextMenuItem } from '../ContextMenu';

export interface MessageActionSheetProps {
  message: ChatMessage | null;
  onClose: () => void;
  onEdit: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  onCopy: (message: ChatMessage) => void;
}

export function MessageActionSheet({ message, onClose, onEdit, onRegenerate, onCopy }: MessageActionSheetProps) {
  const { t } = useTranslation();

  const items = useMemo<ContextMenuItem[]>(() => {
    if (!message) return [];
    const copy: ContextMenuItem = {
      icon: 'copy-outline',
      label: t('common.copy'),
      testID: 'chat-message-action.copy',
      onPress: () => onCopy(message),
    };
    if (message.role === 'user') {
      return [
        {
          icon: 'pencil-outline',
          label: t('chat.actions.editResend'),
          testID: 'chat-message-action.edit',
          onPress: () => onEdit(message),
        },
        copy,
      ];
    }
    return [
      {
        icon: 'refresh-outline',
        label: t('chat.regenerate'),
        testID: 'chat-message-action.regenerate',
        onPress: () => onRegenerate(message),
      },
      copy,
    ];
  }, [message, onCopy, onEdit, onRegenerate, t]);

  return <ContextMenu visible={message !== null} onClose={onClose} items={items} bottomSheet />;
}

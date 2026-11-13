import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import ContextMenu from '../ContextMenu';
import { ChatThreadSummary } from '../../models/Chat';

interface ChatThreadContextMenuProps {
  thread: ChatThreadSummary | null;
  visible: boolean;
  onClose: () => void;
  onOpen: (thread: ChatThreadSummary) => void;
  onRename: (thread: ChatThreadSummary) => void;
  onDelete: (thread: ChatThreadSummary) => Promise<void>;
  bottomSheet?: boolean;
}

export function ChatThreadContextMenu({
  thread,
  visible,
  onClose,
  onOpen,
  onRename,
  onDelete,
  bottomSheet,
}: ChatThreadContextMenuProps) {
  const { t } = useTranslation();

  return (
    <View testID="chat-thread-context-menu.item.close">
      <ContextMenu
        visible={visible}
        onClose={onClose}
        title={thread?.title || t('common.untitled')}
        headerIcon={thread?.backend === 'agent' ? 'terminal' : thread?.backend === 'demo' ? 'sparkles' : 'chatbubble'}
        bottomSheet={bottomSheet}
        sections={
          thread
            ? [
                {
                  items: [
                    {
                      icon: 'eye-outline',
                      label: t('chat.menu.open'),
                      testID: 'chat-thread-context-menu.item.open',
                      onPress: () => onOpen(thread),
                    },
                    {
                      icon: 'pencil-outline',
                      label: t('chat.menu.rename'),
                      testID: 'chat-thread-context-menu.item.rename',
                      onPress: () => onRename(thread),
                    },
                    {
                      icon: 'trash-outline',
                      label: t('common.delete'),
                      destructive: true,
                      testID: 'chat-thread-context-menu.item.delete',
                      onPress: async () => {
                        await onDelete(thread);
                      },
                    },
                  ],
                },
              ]
            : []
        }
      />
    </View>
  );
}

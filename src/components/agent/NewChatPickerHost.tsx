import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import { useAIHubStore } from '../../stores/aiHubStore';
import { NewChatPicker } from './NewChatPicker';

/** iOS refuses to present a modal while the previous one is still dismissing (same delay as ContextMenu). */
const IOS_MODAL_HANDOFF_MS = 350;

/** Mounted once inside the NavigationContainer; shows the model/agent picker that `goNewChat` requests. */
export function NewChatPickerHost() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const visible = useAIHubStore((state) => state.newChatPickerVisible);
  const closeNewChatPicker = useAIHubStore((state) => state.closeNewChatPicker);

  const handleSelectModel = useCallback(() => {
    closeNewChatPicker();
    const start = () => void useAIHubStore.getState().startModelChat(navigation);
    if (Platform.OS === 'ios') setTimeout(start, IOS_MODAL_HANDOFF_MS);
    else start();
  }, [closeNewChatPicker, navigation]);

  const handleAgentThreadCreated = useCallback(
    (threadId: string) => {
      closeNewChatPicker();
      navigation.navigate('ChatScreen', { threadId });
    },
    [closeNewChatPicker, navigation],
  );

  return (
    <NewChatPicker
      visible={visible}
      onClose={closeNewChatPicker}
      onSelectModel={handleSelectModel}
      onAgentThreadCreated={handleAgentThreadCreated}
    />
  );
}

import { Alert } from 'react-native';
import { create } from 'zustand';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import i18n from 'i18next';
import { RootStackParamList } from '../navigation/types';
import { createModelThread } from '../services/chat';
import { useAgentBridgeStore } from './agentBridgeStore';
import { useAIStore } from './aiStore';
import { selectIsPro, useProStore } from './proStore';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface AIHubState {
  pickerVisible: boolean;
  newChatPickerVisible: boolean;
}

interface AIHubActions {
  openChatRepoPicker: () => void;
  closeChatRepoPicker: () => void;
  closeNewChatPicker: () => void;
  /** Opens the model/agent picker when a bridge is paired, otherwise starts a model chat directly. */
  goNewChat: (navigation: NavigationProp) => void;
  /** Model-backed chat in the configured chat repo; sends the user to configure it first when missing. */
  startModelChat: (navigation: NavigationProp) => Promise<void>;
  goChatHistory: (navigation: NavigationProp) => void;
  goAISettings: (navigation: NavigationProp) => void;
  goThoughtDump: (navigation: NavigationProp) => void;
  goVoiceDump: (navigation: NavigationProp) => void;
}

export const useAIHubStore = create<AIHubState & AIHubActions>()((set, get) => ({
  pickerVisible: false,
  newChatPickerVisible: false,

  openChatRepoPicker: () => set({ pickerVisible: true }),

  closeChatRepoPicker: () => set({ pickerVisible: false }),

  closeNewChatPicker: () => set({ newChatPickerVisible: false }),

  goNewChat: (navigation) => {
    if (!selectIsPro(useProStore.getState())) {
      navigation.navigate('Paywall');
      return;
    }

    if (useAgentBridgeStore.getState().bridges.length > 0) {
      set({ newChatPickerVisible: true });
      return;
    }

    void get().startModelChat(navigation);
  },

  startModelChat: async (navigation) => {
    const { chatRepoOwner, chatRepoName, chatRepoBranch, selectedModelId, getAvailableModels } =
      useAIStore.getState();

    if (!chatRepoOwner || !chatRepoName || !chatRepoBranch) {
      get().openChatRepoPicker();
      return;
    }

    const availableModels = getAvailableModels();
    if (!selectedModelId || availableModels.length === 0) {
      Alert.alert(
        i18n.t('chat.aiNotConfiguredTitle'),
        i18n.t('chat.aiNotConfiguredBody'),
      );
      return;
    }

    try {
      const thread = await createModelThread();
      navigation.navigate('ChatScreen', { threadId: thread.id });
    } catch (error) {
      Alert.alert(
        i18n.t('chat.configRequiredTitle'),
        error instanceof Error ? error.message : i18n.t('chat.createFailed'),
      );
    }
  },

  goChatHistory: (navigation) => {
    if (!selectIsPro(useProStore.getState())) {
      navigation.navigate('Paywall');
      return;
    }
    navigation.navigate('ChatThreadList');
  },

  goAISettings: (navigation) => {
    if (!selectIsPro(useProStore.getState())) {
      navigation.navigate('Paywall');
      return;
    }
    navigation.navigate('MainTabs', { screen: 'SettingsTab' });
  },

  goThoughtDump: (navigation) => {
    if (!selectIsPro(useProStore.getState())) {
      navigation.navigate('Paywall');
      return;
    }
    navigation.navigate('ThoughtDump');
  },

  goVoiceDump: (navigation) => {
    if (!selectIsPro(useProStore.getState())) {
      navigation.navigate('Paywall');
      return;
    }
    navigation.navigate('ThoughtDump', { openVoiceOnMount: true });
  },
}));

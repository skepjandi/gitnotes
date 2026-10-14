import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { AIActionMode, AIModelConfig, AIProviderConfig, AISettings } from '../models/AIProvider';
import { setChatRepoAccount } from '../services/ChatStorageService';
import { resolveProviderAvailability } from '../services/ai/providerAvailability';
import { discoverModelsIfNeeded } from '../services/ai/modelDiscoveryService';

const AI_SETTINGS_STORAGE_KEY = 'ai-settings';
const AI_PROVIDER_KEY_PREFIX = 'ai-provider-key-';

interface AIState {
  isEnabled: boolean;
  selectedModelId: string | null;
  actionMode: AIActionMode;
  chatRepoOwner: string | null;
  chatRepoName: string | null;
  chatRepoBranch: string;
  chatRepoAccountId: string | null;
  providers: AIProviderConfig[];
  isLoading: boolean;
  error: string | null;
  dailyQuoteEnabled: boolean;
  aiPersonalizationEnabled: boolean;
  githubToolsEnabled: boolean;
  dailyQuotePersonalizationEnabled: boolean;
  dailyQuoteSourceVisible: boolean;
}

interface AIActions {
  toggleAI: () => Promise<void>;
  setEnabled: (value: boolean) => Promise<void>;
  setActionMode: (mode: AIActionMode) => Promise<void>;
  selectModel: (modelId: string | null) => Promise<void>;
  addProvider: (provider: AIProviderConfig) => Promise<void>;
  updateProvider: (providerId: string, updates: Partial<AIProviderConfig>) => Promise<void>;
  refreshProviderModels: (providerId: string) => Promise<void>;
  removeProvider: (providerId: string) => Promise<void>;
  setChatRepo: (owner: string | null, name: string | null, branch?: string, accountId?: string | null) => Promise<void>;
  getAvailableModels: () => AIModelConfig[];
  getSelectedModel: () => AIModelConfig | undefined;
  persistSettings: () => Promise<void>;
  loadSettings: () => Promise<void>;
  toggleDailyQuote: () => Promise<void>;
  toggleAiPersonalization: () => Promise<void>;
  toggleGithubTools: () => Promise<void>;
  toggleDailyQuotePersonalization: () => Promise<void>;
}

const createDefaultProviders = (): AIProviderConfig[] => [
  {
    id: 'apple-default',
    type: 'apple',
    name: 'Apple Intelligence',
    isEnabled: true,
    addedAt: 0,
    supportedPlatforms: ['ios'],
    models: [
      {
        id: 'apple-foundation',
        name: 'Foundation Model',
        providerId: 'apple-default',
        providerType: 'apple',
        requiresDownload: false,
      },
    ],
  },
  {
    id: 'llama-default',
    type: 'llama',
    name: 'Llama (On-Device)',
    isEnabled: true,
    addedAt: 0,
    // Native llama runtime ships only on Android right now; the iOS package is
    // not bundled, so the provider would crash on instantiation. Hide it from
    // iOS builds entirely until the iOS native module ships.
    supportedPlatforms: ['android'],
    models: [
      {
        id: 'llama-smol',
        name: 'SmolLM3 3B',
        providerId: 'llama-default',
        providerType: 'llama',
        requiresDownload: true,
        downloadSize: '~2GB',
        isDownloaded: false,
      },
    ],
  },
];

const createDefaultSettings = (): AISettings => ({
  isEnabled: false,
  selectedModelId: null,
  actionMode: 'auto',
  chatRepoOwner: null,
  chatRepoName: null,
  chatRepoBranch: 'main',
  chatRepoAccountId: null,
  providers: createDefaultProviders(),
  dailyQuoteEnabled: false,
  aiPersonalizationEnabled: false,
  githubToolsEnabled: false,
  dailyQuotePersonalizationEnabled: false,
  dailyQuoteSourceVisible: true,
});

const getProviderApiKeyStorageKey = (providerId: string) => `${AI_PROVIDER_KEY_PREFIX}${providerId}`;

const stripProviderApiKey = ({ apiKey: _apiKey, ...provider }: AIProviderConfig): AIProviderConfig => provider;

const mergeProviders = (storedProviders?: AIProviderConfig[]): AIProviderConfig[] => {
  const defaultProviders = createDefaultProviders();

  if (!storedProviders?.length) {
    return defaultProviders;
  }

  const mergedDefaults = defaultProviders.map((defaultProvider) => {
    const storedProvider = storedProviders.find((provider) => provider.id === defaultProvider.id);

    if (!storedProvider) {
      return defaultProvider;
    }

    return {
      ...defaultProvider,
      ...storedProvider,
      models: storedProvider.models?.length ? storedProvider.models : defaultProvider.models,
      // Always re-derive platform support from the default config so old persisted
      // entries inherit new gating rules (the Apple provider is iOS-only).
      supportedPlatforms: defaultProvider.supportedPlatforms,
    };
  });

  const customProviders = storedProviders.filter(
    (provider) => !defaultProviders.some((defaultProvider) => defaultProvider.id === provider.id)
  );

  return [...mergedDefaults, ...customProviders];
};

const hydrateProviderApiKeys = async (providers: AIProviderConfig[]): Promise<AIProviderConfig[]> =>
  Promise.all(
    providers.map(async (provider) => {
      const apiKey = await SecureStore.getItemAsync(getProviderApiKeyStorageKey(provider.id));
      return apiKey ? { ...provider, apiKey } : provider;
    })
  );

/**
 * If the persisted selection points at a provider that is no longer available
 * on this device (e.g. user moved from an iPhone 15 Pro to a 14 Pro), pick the
 * first model from a still-available enabled provider instead. Only runs at
 * cold start so we don't yank the model out from under an active session.
 */
const resolveSelectedModelOnStartup = async (
  selectedModelId: string | null,
  providers: AIProviderConfig[]
): Promise<string | null> => {
  if (!selectedModelId) return null;

  const owningProvider = providers.find(
    (p) => p.isEnabled && p.models.some((m) => m.id === selectedModelId)
  );

  if (owningProvider) {
    try {
      const availability = await resolveProviderAvailability(owningProvider);
      if (availability.kind === 'available') {
        return selectedModelId;
      }
    } catch {
      // fall through to fallback
    }
  }

  for (const provider of providers) {
    if (!provider.isEnabled || provider.models.length === 0) continue;
    try {
      const availability = await resolveProviderAvailability(provider);
      if (availability.kind === 'available') {
        return provider.models[0].id;
      }
    } catch {
      // try next
    }
  }

  return null;
};

/**
 * Disables any provider that is unavailable on this device/platform.
 * Runs at cold start so unavailable providers don't appear enabled.
 */
const autoDisableUnavailableProviders = async (
  providers: AIProviderConfig[]
): Promise<AIProviderConfig[]> => {
  return Promise.all(
    providers.map(async (provider) => {
      if (!provider.isEnabled) return provider;
      try {
        const availability = await resolveProviderAvailability(provider);
        if (availability.kind === 'unavailable') {
          return { ...provider, isEnabled: false };
        }
      } catch {
        // keep as-is on error
      }
      return provider;
    })
  );
};

export const useAIStore = create<AIState & AIActions>()((set, get) => ({
  ...createDefaultSettings(),
  isLoading: true,
  error: null,

  toggleAI: async () => {
    set((state) => ({ isEnabled: !state.isEnabled, error: null }));
    await get().persistSettings();
  },

  setEnabled: async (value) => {
    set({ isEnabled: value, error: null });
    await get().persistSettings();
  },

  setActionMode: async (mode) => {
    set({ actionMode: mode, error: null });
    await get().persistSettings();
  },

  selectModel: async (modelId) => {
    set({ selectedModelId: modelId, error: null });
    await get().persistSettings();
  },

  addProvider: async (provider) => {
    set((state) => ({
      providers: [...state.providers.filter((existingProvider) => existingProvider.id !== provider.id), provider],
      error: null,
    }));
    await get().persistSettings();
  },

  updateProvider: async (providerId, updates) => {
    const previousProvider = get().providers.find(p => p.id === providerId);
    
    set((state) => ({
      providers: state.providers.map((provider) =>
        provider.id === providerId
          ? {
              ...provider,
              ...updates,
              models: updates.models ?? provider.models,
            }
          : provider
      ),
      error: null,
    }));
    await get().persistSettings();

    const updatedProvider = get().providers.find(p => p.id === providerId);
    const apiKeyWasAddedOrChanged = previousProvider && updates.apiKey && updates.apiKey !== previousProvider.apiKey;
    
    if (updatedProvider?.type === 'anthropic' && apiKeyWasAddedOrChanged) {
      discoverModelsIfNeeded(updatedProvider).then(discoveredModels => {
        if (discoveredModels.length > 0) {
          set((currentState) => ({
            providers: currentState.providers.map(p =>
              p.id === providerId ? { ...p, models: discoveredModels } : p
            ),
          }));
          get().persistSettings();
        }
      }).catch(err => {
        console.warn('[AI Store] Model discovery failed:', err);
      });
    }
  },

  refreshProviderModels: async (providerId) => {
    const provider = get().providers.find(p => p.id === providerId);
    if (!provider || provider.type !== 'anthropic') {
      return;
    }

    try {
      const discoveredModels = await discoverModelsIfNeeded(provider);
      
      if (discoveredModels.length > 0) {
        set((state) => ({
          providers: state.providers.map(p =>
            p.id === providerId ? { ...p, models: discoveredModels } : p
          ),
        }));
        await get().persistSettings();
      }
    } catch (err) {
      console.warn('[AI Store] Manual model refresh failed:', err);
      set({ error: 'Failed to refresh models' });
    }
  },

  removeProvider: async (providerId) => {
    const selectedModel = get().getSelectedModel();

    set((state) => ({
      providers: state.providers.filter((provider) => provider.id !== providerId),
      selectedModelId: selectedModel?.providerId === providerId ? null : state.selectedModelId,
      error: null,
    }));

    try {
      await SecureStore.deleteItemAsync(getProviderApiKeyStorageKey(providerId));
    } catch (err) {
      set({ error: 'Failed to remove AI provider key' });
      console.error('Error removing AI provider key:', err);
    }

    await get().persistSettings();
  },

  setChatRepo: async (owner, name, branch = 'main', accountId = null) => {
    set({
      chatRepoOwner: owner,
      chatRepoName: name,
      chatRepoBranch: branch,
      chatRepoAccountId: accountId,
      error: null,
    });
    setChatRepoAccount(accountId);
    await get().persistSettings();
  },

  toggleDailyQuote: async () => {
    set((state) => ({ dailyQuoteEnabled: !state.dailyQuoteEnabled, error: null }));
    await get().persistSettings();
  },

  toggleAiPersonalization: async () => {
    set((state) => ({ aiPersonalizationEnabled: !state.aiPersonalizationEnabled, error: null }));
    await get().persistSettings();
  },

  toggleGithubTools: async () => {
    set((state) => ({ githubToolsEnabled: !state.githubToolsEnabled, error: null }));
    await get().persistSettings();
  },

  toggleDailyQuotePersonalization: async () => {
    set((state) => ({ dailyQuotePersonalizationEnabled: !state.dailyQuotePersonalizationEnabled, error: null }));
    await get().persistSettings();
  },

  getAvailableModels: () =>
    get()
      .providers.filter((provider) => provider.isEnabled)
      .flatMap((provider) => provider.models),

  getSelectedModel: () => {
    const { selectedModelId, providers } = get();

    if (!selectedModelId) {
      return undefined;
    }

    for (const provider of providers) {
      if (!provider.isEnabled) continue;
      const model = provider.models.find((m) => m.id === selectedModelId);
      if (model) {
        return { ...model, providerId: provider.id };
      }
    }

    return undefined;
  },

  persistSettings: async () => {
    try {
      const {
        isEnabled,
        selectedModelId,
        actionMode,
        chatRepoOwner,
        chatRepoName,
        chatRepoBranch,
        chatRepoAccountId,
        providers,
        dailyQuoteEnabled,
        aiPersonalizationEnabled,
        githubToolsEnabled,
        dailyQuotePersonalizationEnabled,
        dailyQuoteSourceVisible,
      } = get();

      await Promise.all(
        providers.map(async (provider) => {
          const storageKey = getProviderApiKeyStorageKey(provider.id);

          if (provider.apiKey) {
            await SecureStore.setItemAsync(storageKey, provider.apiKey);
            return;
          }

          await SecureStore.deleteItemAsync(storageKey);
        })
      );

      const settingsToPersist: AISettings = {
        isEnabled,
        selectedModelId,
        actionMode,
        chatRepoOwner,
        chatRepoName,
        chatRepoBranch,
        chatRepoAccountId,
        providers: providers.map(stripProviderApiKey),
        dailyQuoteEnabled,
        aiPersonalizationEnabled,
        githubToolsEnabled,
        dailyQuotePersonalizationEnabled,
        dailyQuoteSourceVisible,
      };

      await AsyncStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settingsToPersist));
      set({ error: null });
    } catch (err) {
      set({ error: 'Failed to persist AI settings' });
      console.error('Error persisting AI settings:', err);
    }
  },

  loadSettings: async () => {
    try {
      set({ isLoading: true, error: null });

      const savedSettingsRaw = await AsyncStorage.getItem(AI_SETTINGS_STORAGE_KEY);

      if (!savedSettingsRaw) {
        const defaultSettings = createDefaultSettings();
        const providers = await hydrateProviderApiKeys(defaultSettings.providers);
        const resolvedProviders = await autoDisableUnavailableProviders(providers);
        const selectedModelId = await resolveSelectedModelOnStartup(
          defaultSettings.selectedModelId,
          resolvedProviders
        );
        set({ ...defaultSettings, providers: resolvedProviders, selectedModelId, isLoading: false, error: null });
        return;
      }

      const savedSettings = JSON.parse(savedSettingsRaw) as Partial<AISettings>;
      const defaultSettings = createDefaultSettings();

      const mergedSettings: AISettings = {
        ...defaultSettings,
        ...savedSettings,
        chatRepoBranch: savedSettings.chatRepoBranch ?? defaultSettings.chatRepoBranch,
        chatRepoAccountId: savedSettings.chatRepoAccountId ?? defaultSettings.chatRepoAccountId,
        providers: mergeProviders(savedSettings.providers),
      };

      const providers = await hydrateProviderApiKeys(mergedSettings.providers);
      const resolvedProviders = await autoDisableUnavailableProviders(providers);
      const selectedModelId = await resolveSelectedModelOnStartup(
        mergedSettings.selectedModelId,
        resolvedProviders
      );

      set({
        ...mergedSettings,
        providers: resolvedProviders,
        selectedModelId,
        isLoading: false,
        error: null,
      });
      setChatRepoAccount(mergedSettings.chatRepoAccountId);
    } catch (err) {
      const defaultSettings = createDefaultSettings();
      set({
        ...defaultSettings,
        isLoading: false,
        error: 'Failed to load AI settings',
      });
      console.error('Error loading AI settings:', err);
    }
  },
}));

void useAIStore.getState().loadSettings();

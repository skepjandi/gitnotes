export type AIProviderType = 'apple' | 'llama' | 'openai-compatible' | 'anthropic';

export type ProviderPlatform = 'ios' | 'android';

export interface AIModelConfig {
  id: string;
  name: string;
  providerId: string;
  providerType: AIProviderType;
  requiresDownload: boolean;
  downloadSize?: string;
  isDownloaded?: boolean;
  supportsVision?: boolean;
}

export interface AIProviderConfig {
  id: string;
  type: AIProviderType;
  name: string;
  baseURL?: string;
  apiKey?: string;
  isEnabled: boolean;
  models: AIModelConfig[];
  addedAt: number;
  /**
   * Platforms this provider is compatible with. `undefined` means cross-platform.
   * Apple Intelligence is iOS-only; future Android-only providers may set `['android']`.
   */
  supportedPlatforms?: ProviderPlatform[];
}

export type AIActionMode = 'auto' | 'confirm';

/** Hosts whose contents API chat storage can read and write. */
export type ChatRepoProvider = 'github' | 'gitea' | 'forgejo';

export interface AISettings {
  isEnabled: boolean;
  selectedModelId: string | null;
  actionMode: AIActionMode;
  chatRepoOwner: string | null;
  chatRepoName: string | null;
  chatRepoBranch: string;
  chatRepoAccountId: string | null;
  /** Git host that holds the chat repo; absent/`github` for repos created before multi-host support. */
  chatRepoProvider: ChatRepoProvider;
  /** Connected host (self-hosted Gitea/Forgejo) the chat repo lives on. */
  chatRepoHostId: string | null;
  providers: AIProviderConfig[];
  dailyQuoteEnabled: boolean;
  aiPersonalizationEnabled: boolean;
  /** Expose seven GitHub tools to the AI agent. Defaults to false (opt-in). */
  githubToolsEnabled: boolean;
  /** When true, use AI personalization for daily quotes. Defaults to true. */
  dailyQuotePersonalizationEnabled: boolean;
  /** When true, show the source work in the quote card. Defaults to true. */
  dailyQuoteSourceVisible: boolean;
}

export interface AIContextItem {
  type: 'file' | 'folder' | 'repo' | 'local-notes' | 'local-todos';
  owner: string;
  repo: string;
  path: string;
  name: string;
  branch?: string;
  /** Approximate byte size used for context-budget warnings. */
  approxBytes?: number;
}

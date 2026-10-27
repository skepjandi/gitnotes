import type { ObserveConfig } from 'expo-observe';
import { telemetryPreferenceService, type TelemetryPreferenceService } from './TelemetryPreferenceService';
import { workerApi } from './workerApi';
import type { UsageEventRequest, UsageHost } from '../types/worker';

export type TelemetryRuntime = {
  readonly ObserveRoot: typeof import('expo-observe').ObserveRoot;
  readonly ObserveInteractiveMarker: typeof import('expo-observe').ObserveInteractiveMarker;
  readonly ObserveNavigationContainer: typeof import('expo-observe/integrations/react-navigation').ObserveNavigationContainer;
};

type ObserveModule = typeof import('expo-observe');

const SENSITIVE_ROUTE_PARAMS = [
  'accessToken',
  'accountId',
  'branch',
  'canvasId',
  'canvasTitle',
  'code',
  'commit',
  'commitId',
  'content',
  'error',
  'error_description',
  'filePath',
  'folderPath',
  'hostId',
  'id',
  'initialContent',
  'initialTags',
  'initialTitle',
  'installation_id',
  'installationId',
  'noteId',
  'oauthState',
  'owner',
  'path',
  'query',
  'repo',
  'repoId',
  'repoName',
  'searchQuery',
  'state',
  'threadId',
  'title',
  'token',
  'userId',
] as const;

export class TelemetryService {
  private initialization: Promise<TelemetryRuntime | null> | null = null;
  private observe: ObserveModule | null = null;
  private runtime: TelemetryRuntime | null = null;
  private initialized = false;
  private configured = false;
  private navigationIntegrationEnabled = false;
  private navigationReady = false;
  private appOpenRecorded = false;
  private preferenceGeneration = 0;

  constructor(
    private readonly preferences: TelemetryPreferenceService = telemetryPreferenceService
  ) {}

  initialize(): Promise<TelemetryRuntime | null> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  markNavigationReady(): void {
    if (this.navigationReady) return;
    this.navigationReady = true;
    if (this.appOpenRecorded) return;
    this.appOpenRecorded = true;
    void this.sendUsageEvent({ event: 'app_open' });
  }

  trackGitHostAction(host: UsageHost): void {
    void this.sendUsageEvent({ event: 'git_host_action', host });
  }

  private async initializeOnce(): Promise<TelemetryRuntime | null> {
    const preference = await this.preferences.load();
    this.initialized = true;
    this.preferences.subscribe((next) => this.onPreferenceChanged(next));
    if (preference !== 'enabled') return null;

    const generation = ++this.preferenceGeneration;
    try {
      const runtime = await this.loadRuntime();
      if (
        generation !== this.preferenceGeneration ||
        this.preferences.current !== 'enabled'
      ) {
        return null;
      }
      this.navigationIntegrationEnabled = !this.navigationReady;
      if (!this.configureObserve(true)) return null;
      this.runtime = runtime;
      return runtime;
    } catch {
      return null;
    }
  }

  private onPreferenceChanged(preference: "enabled" | "disabled"): void {
    if (!this.initialized) return;
    const generation = ++this.preferenceGeneration;

    if (preference === 'disabled') {
      this.configureObserve(false);
      return;
    }

    void this.enableAfterPreferenceChange(generation);
  }

  private async enableAfterPreferenceChange(generation: number): Promise<void> {
    try {
      await this.loadRuntime();
      if (
        generation !== this.preferenceGeneration ||
        this.preferences.current !== 'enabled'
      ) {
        return;
      }
      if (!this.configured) {
        this.navigationIntegrationEnabled = !this.navigationReady;
      }
      this.configureObserve(true);
    } catch {
      // Optional diagnostics must never block app startup or user actions.
    }
  }

  private async loadRuntime(): Promise<TelemetryRuntime> {
    if (this.observe && this.runtime) return this.runtime;

    // expo-app-metrics installs a global JS error handler when imported.
    const observe: ObserveModule = require('expo-observe');
    this.observe = observe;
    const navigation: typeof import('expo-observe/integrations/react-navigation') = require(
      'expo-observe/integrations/react-navigation'
    );
    this.runtime = {
      ObserveRoot: observe.ObserveRoot,
      ObserveInteractiveMarker: observe.ObserveInteractiveMarker,
      ObserveNavigationContainer: navigation.ObserveNavigationContainer,
    };
    return this.runtime;
  }

  private configureObserve(dispatchingEnabled: boolean): boolean {
    if (!this.observe) return false;

    const config = {
      environment: process.env.NODE_ENV ?? 'production',
      dispatchInDebug: false,
      dispatchingEnabled,
      integrations: {
        'react-navigation': this.navigationIntegrationEnabled
          ? { filteredParams: [...SENSITIVE_ROUTE_PARAMS] }
          : false,
      },
    } satisfies ObserveConfig;

    try {
      this.observe.Observe.configure(config);
      this.configured = true;
      return true;
    } catch {
      // Observe is optional; a configuration failure must not break the app.
      return false;
    }
  }

  private async sendUsageEvent(event: UsageEventRequest): Promise<void> {
    if (this.preferences.current !== 'enabled') return;
    try {
      await workerApi.usage.recordEvent(event);
    } catch {
      // Usage counts are best-effort and must not break app or Git operations.
    }
  }
}

export const telemetryService = new TelemetryService();

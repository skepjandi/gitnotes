import React, { useEffect, useState, type ComponentType } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AppLoadingView } from './ui/AppLoadingView';
import { telemetryService, type TelemetryRuntime } from '../services/TelemetryService';
import type { AppRootProps } from '../../App';

type Props = {
  readonly AppRoot: ComponentType<AppRootProps>;
};

function createEntryRoot(
  AppRoot: ComponentType<AppRootProps>,
  runtime: TelemetryRuntime | null
): ComponentType {
  const EntryRoot = () => (
    <AppRoot
      observeNavigationContainer={runtime?.ObserveNavigationContainer}
      observeInteractiveMarker={runtime?.ObserveInteractiveMarker}
      onNavigationReady={telemetryService.markNavigationReady.bind(telemetryService)}
    />
  );
  return runtime ? runtime.ObserveRoot.wrap(EntryRoot) : EntryRoot;
}

export function TelemetryBootstrap({ AppRoot }: Props) {
  const colorScheme = useColorScheme();
  const [Root, setRoot] = useState<ComponentType | null>(null);

  useEffect(() => {
    let mounted = true;
    void telemetryService.initialize().then((runtime) => {
      if (mounted) setRoot(() => createEntryRoot(AppRoot, runtime));
    }).catch(() => {
      // Optional telemetry must never block app startup.
      if (mounted) setRoot(() => createEntryRoot(AppRoot, null));
    });
    return () => {
      mounted = false;
    };
  }, [AppRoot]);

  if (!Root) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <AppLoadingView colorScheme={colorScheme ?? 'light'} />
      </SafeAreaProvider>
    );
  }
  return <Root />;
}

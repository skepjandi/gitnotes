import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';

import { renderPreviewPage, resolveSitePath } from '../../services/site/siteBuilder';
import { SiteArtifact } from '../../services/site/siteTypes';

/** Synthetic origin that relative links resolve against; never reachable, so nothing can load from it. */
export const PREVIEW_ORIGIN = 'https://site-preview.invalid/';

interface Props {
  artifact: SiteArtifact;
  initialPath?: string;
  style?: StyleProp<ViewStyle>;
  onPathChange?: (path: string) => void;
  testID?: string;
}

export default function SitePreviewFrame({ artifact, initialPath = 'index.html', style, onPathChange, testID }: Props) {
  const [path, setPath] = useState(initialPath);

  const html = useMemo(
    () => renderPreviewPage(artifact, path) ?? renderPreviewPage(artifact, 'index.html') ?? '',
    [artifact, path],
  );

  useEffect(() => onPathChange?.(path), [path, onPathChange]);

  const handleRequest = useCallback(
    (request: WebViewNavigation): boolean => {
      if (!request.url.startsWith(PREVIEW_ORIGIN)) return false;
      const target = resolveSitePath(path, request.url.slice(PREVIEW_ORIGIN.length - 1));
      if (target && target !== path) setPath(target);
      return target === path;
    },
    [path],
  );

  return (
    <WebView
      key={path}
      testID={testID}
      style={style}
      source={{ html, baseUrl: `${PREVIEW_ORIGIN}${path}` }}
      originWhitelist={['https://*', 'about:*']}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      allowFileAccess={false}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={handleRequest}
    />
  );
}

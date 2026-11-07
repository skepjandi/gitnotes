import React from 'react';
import { act, render } from '@testing-library/react-native';

import SitePreviewFrame, { PREVIEW_ORIGIN } from '../../../src/components/site/SitePreviewFrame';
import type { SiteArtifact } from '../../../src/services/site/siteTypes';

type WebViewProps = {
  source: { html: string; baseUrl: string };
  javaScriptEnabled: boolean;
  onShouldStartLoadWithRequest: (req: { url: string }) => boolean;
};

let latest: WebViewProps;

jest.mock('react-native-webview', () => ({
  WebView: (props: WebViewProps) => {
    latest = props;
    return null;
  },
}));

const text = (path: string, body: string) => ({ path, content: { kind: 'text' as const, text: body } });
const artifact: SiteArtifact = {
  pages: [],
  warnings: [],
  files: [
    text('index.html', '<link rel="stylesheet" href="assets/style.css"><h1>Home</h1>'),
    text('notes/a.html', '<link rel="stylesheet" href="../assets/style.css"><h1>A</h1>'),
    text('assets/style.css', 'h1{color:red}'),
  ],
};

describe('SitePreviewFrame', () => {
  it('renders the current page with inlined CSS and scripting disabled', () => {
    render(<SitePreviewFrame artifact={artifact} />);
    expect(latest.javaScriptEnabled).toBe(false);
    expect(latest.source.html).toContain('<style>h1{color:red}</style>');
    expect(latest.source.html).not.toContain('assets/style.css');
    expect(latest.source.baseUrl).toBe(`${PREVIEW_ORIGIN}index.html`);
  });

  it('follows in-site links by swapping the page and blocks the webview navigation itself', () => {
    render(<SitePreviewFrame artifact={artifact} />);
    let allowed = true;
    act(() => {
      allowed = latest.onShouldStartLoadWithRequest({ url: `${PREVIEW_ORIGIN}notes/a.html` });
    });
    expect(allowed).toBe(false);
    expect(latest.source.html).toContain('<h1>A</h1>');
    expect(latest.source.baseUrl).toBe(`${PREVIEW_ORIGIN}notes/a.html`);
  });

  it('allows the initial load and same-page anchors', () => {
    render(<SitePreviewFrame artifact={artifact} />);
    expect(latest.onShouldStartLoadWithRequest({ url: `${PREVIEW_ORIGIN}index.html` })).toBe(true);
    expect(latest.onShouldStartLoadWithRequest({ url: `${PREVIEW_ORIGIN}index.html#section` })).toBe(true);
  });

  it('blocks every external destination and leaves the page unchanged', () => {
    render(<SitePreviewFrame artifact={artifact} />);
    for (const url of ['https://example.com/', 'http://evil.test/x', 'mailto:a@b.c', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(latest.onShouldStartLoadWithRequest({ url })).toBe(false);
    }
    expect(latest.source.baseUrl).toBe(`${PREVIEW_ORIGIN}index.html`);
  });
});

import JSZip from 'jszip';

import {
  SiteProRequiredError,
  SiteShareUnavailableError,
  createSiteZip,
  shareSiteZip,
} from '../../../src/services/site/siteExport';
import type { SiteArtifact } from '../../../src/services/site/siteTypes';
import { useProStore } from '../../../src/stores/proStore';

const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockCreateFile = jest.fn((_name: string, _mime: string) => ({ uri: 'file:///cache/site.zip', write: mockWrite, delete: mockDelete }));
const mockIsAvailable = jest.fn(async () => true);
const mockShare = jest.fn(async (..._args: unknown[]) => undefined);

jest.mock('expo-file-system', () => ({
  Paths: { cache: { createFile: (name: string, mime: string) => mockCreateFile(name, mime) } },
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailable(),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const artifact: SiteArtifact = {
  pages: [],
  warnings: [],
  files: [
    { path: 'index.html', content: { kind: 'text', text: '<h1>Hi</h1>' } },
    { path: 'notes/a.html', content: { kind: 'text', text: '<p>a</p>' } },
    { path: 'assets/img-1.png', content: { kind: 'base64', base64: PNG } },
    { path: '.nojekyll', content: { kind: 'text', text: '' } },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAvailable.mockResolvedValue(true);
  useProStore.setState({ entitlementActive: true, status: 'pro' });
});

describe('createSiteZip', () => {
  it('keeps index.html at the archive root and stores binary assets as bytes', async () => {
    const zip = await JSZip.loadAsync(await createSiteZip(artifact));
    expect(Object.keys(zip.files).sort()).toEqual(['.nojekyll', 'assets/img-1.png', 'index.html', 'notes/a.html']);
    expect(await zip.file('index.html')!.async('string')).toBe('<h1>Hi</h1>');
    expect(await zip.file('assets/img-1.png')!.async('base64')).toBe(PNG);
  });
});

describe('shareSiteZip', () => {
  it('refuses to build or share for non-Pro users', async () => {
    useProStore.setState({ entitlementActive: false, status: 'free' });
    await expect(shareSiteZip(artifact, 'My Notes')).rejects.toBeInstanceOf(SiteProRequiredError);
    expect(mockCreateFile).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('writes a zip named after the site, shares it, then removes the temp file', async () => {
    await shareSiteZip(artifact, 'My Notes');
    expect(mockCreateFile.mock.calls[0][0]).toMatch(/^my-notes-site-\d+\.zip$/);
    expect(mockWrite).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(mockShare).toHaveBeenCalledWith('file:///cache/site.zip', expect.objectContaining({ mimeType: 'application/zip' }));
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('removes the temp file even when the share sheet fails', async () => {
    mockShare.mockRejectedValueOnce(new Error('share failed'));
    await expect(shareSiteZip(artifact, 'Site')).rejects.toThrow('share failed');
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable sharing without writing anything', async () => {
    mockIsAvailable.mockResolvedValueOnce(false);
    await expect(shareSiteZip(artifact, 'Site')).rejects.toBeInstanceOf(SiteShareUnavailableError);
    expect(mockCreateFile).not.toHaveBeenCalled();
  });
});

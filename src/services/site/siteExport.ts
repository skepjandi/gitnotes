import JSZip from 'jszip';
import * as Sharing from 'expo-sharing';
import { Paths } from 'expo-file-system';

import { selectIsPro, useProStore } from '../../stores/proStore';
import { SiteArtifact } from './siteTypes';
import { slugify } from './siteHtml';

export class SiteProRequiredError extends Error {
  constructor() {
    super('Publishing a site requires GitNotēs Pro');
    this.name = 'SiteProRequiredError';
  }
}

export class SiteShareUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device');
    this.name = 'SiteShareUnavailableError';
  }
}

/** Packs the artifact with `index.html` at the archive root so any static host or drag-and-drop uploader accepts it. */
export async function createSiteZip(artifact: SiteArtifact): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const file of artifact.files) {
    if (file.content.kind === 'text') zip.file(file.path, file.content.text, { createFolders: false });
    else zip.file(file.path, file.content.base64, { base64: true, createFolders: false });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function shareSiteZip(artifact: SiteArtifact, siteTitle: string): Promise<void> {
  if (!selectIsPro(useProStore.getState())) throw new SiteProRequiredError();
  if (!(await Sharing.isAvailableAsync())) throw new SiteShareUnavailableError();

  const bytes = await createSiteZip(artifact);
  const filename = `${slugify(siteTitle, 'site')}-site-${Date.now()}.zip`;
  const file = Paths.cache.createFile(filename, 'application/zip');
  try {
    file.write(bytes);
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/zip',
      dialogTitle: `Share ${siteTitle}`,
      UTI: 'public.zip-archive',
    });
  } finally {
    file.delete();
  }
}

import {
  DEV_BUNDLE_LOAD_RETRY_MESSAGE,
  isDevBundleLoadError,
} from '@/services/git/devBundleError';

describe('dev bundle error classification', () => {
  it('recognizes Expo lazy-bundle reload failures', () => {
    expect(isDevBundleLoadError(new TypeError("Cannot read property 'reload' of undefined"))).toBe(true);
  });

  it('recognizes the underlying lazy-bundle request failure', () => {
    expect(isDevBundleLoadError(new Error('Could not load bundle'))).toBe(true);
  });

  it('does not classify ordinary Git failures as dev bundle failures', () => {
    expect(isDevBundleLoadError(new Error('Authentication failed'))).toBe(false);
  });

  it('provides an actionable retry message', () => {
    expect(DEV_BUNDLE_LOAD_RETRY_MESSAGE).toBe('The app is still loading. Please try again.');
  });
});

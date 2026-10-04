export const DEV_BUNDLE_LOAD_RETRY_MESSAGE = 'The app is still loading. Please try again.';

const DEV_BUNDLE_ERROR_MESSAGES = [
  "Cannot read property 'reload' of undefined",
  "Cannot read properties of undefined (reading 'reload')",
  'Could not load bundle',
] as const;

export function isDevBundleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return DEV_BUNDLE_ERROR_MESSAGES.some((candidate) => message.includes(candidate));
}

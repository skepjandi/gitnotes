/**
 * Manual mock for expo-store-review.
 * The actual expo-store-review package may not be installed in node_modules
 * in all build environments. This mock provides the minimum API surface needed
 * by ReviewPromptService and its tests.
 */

const mockIsAvailableAsync = jest.fn(() => Promise.resolve(true));
const mockHasAction = jest.fn(() => Promise.resolve(true));
const mockRequestReview = jest.fn(() => Promise.resolve(undefined));

module.exports = {
  isAvailableAsync: mockIsAvailableAsync,
  hasAction: mockHasAction,
  requestReview: mockRequestReview,
};

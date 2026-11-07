module.exports = {
  preset: '@react-native/jest-preset',
  transform: {
    '^.+\\.js$': 'babel-jest',
    '^.+\\.ts$': 'babel-jest',
    '^.+\\.tsx$': 'babel-jest',
  },
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: [
    '**/__tests__/**/*.test.{ts,tsx}',
    '**/?(*.)+(spec|test).{ts,tsx}',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/__mocks__/styleMock.js',
    '^expo-blur$': '<rootDir>/__mocks__/expo-blur.ts',
    '^expo-file-system/legacy$': '<rootDir>/__mocks__/expo-file-system-legacy.ts',
    '^expo-image$': '<rootDir>/__mocks__/expo-image.ts',
    '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.ts',
    '^@shopify/react-native-skia$': '<rootDir>/__mocks__/react-native-skia.ts',
    '^@shopify/flash-list$': '<rootDir>/__mocks__/flash-list.tsx',
    '^@ai-sdk/anthropic$': '<rootDir>/__mocks__/ai-sdk-anthropic.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/bridge/',
    // Ignore the shared .worktrees/ directory at the repo root (not this worktree's tests)
    '<rootDir>/../.worktrees/',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|expo|expo-[^/]+|@expo|react-native-reanimated|@shopify|nativewind|react-native-css|@rn-primitives|class-variance-authority|tailwind-merge|tailwindcss-animate|marked)/)',
  ],
  collectCoverage: true,
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/',
    '/.worktrees/',
  ],
};

const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

config.resolver.blockList = [
  // No worktree blocking — worktrees serve themselves
  /.*\/dogfood-output\/.*/,
];
config.resolver.unstable_conditionNames = ['require', 'default'];
config.watchFolders = [__dirname];

const webcryptoShim = path.join(__dirname, 'src/services/crdt/webcryptoShim.js');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'lib0/webcrypto') {
    return { type: 'sourceFile', filePath: webcryptoShim };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativewind(config);

// lib0 (a yjs dependency) resolves `lib0/webcrypto` to a React Native build that
// requires `isomorphic-webcrypto`, which is not installed. Hermes has no global
// `crypto`, so metro.config.js points `lib0/webcrypto` here instead.
// lib0 only needs getRandomValues (client ids); `subtle` is unused.
const { getRandomValues } = require('expo-crypto');

module.exports = { getRandomValues, subtle: undefined };

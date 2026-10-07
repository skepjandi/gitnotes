describe('DEV_FORCE_PRO simulator override', () => {
  const originalOverride = process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR;

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR;
    } else {
      process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR = originalOverride;
    }
    jest.resetModules();
    jest.unmock('expo-device');
  });

  it('disables the simulator Pro override when the public env var is false', () => {
    process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR = 'false';
    jest.doMock('expo-device', () => ({ isDevice: false }));

    let devForcePro: boolean | undefined;
    let devForceFree: boolean | undefined;
    let selectIsPro: ((state: { entitlementActive: boolean }) => boolean) | undefined;
    let statusForEntitlement: ((entitlementActive: boolean) => 'loading' | 'pro' | 'free') | undefined;
    jest.isolateModules(() => {
      const store = jest.requireActual('@/stores/proStore');
      devForcePro = store.DEV_FORCE_PRO;
      devForceFree = store.DEV_FORCE_FREE;
      selectIsPro = store.selectIsPro;
      statusForEntitlement = store.statusForEntitlement;
    });

    expect(devForcePro).toBe(false);
    expect(devForceFree).toBe(true);
    expect(selectIsPro?.({ entitlementActive: true })).toBe(false);
    expect(statusForEntitlement?.(true)).toBe('free');
  });

  it('keeps the simulator Pro override enabled by default', () => {
    delete process.env.EXPO_PUBLIC_FORCE_ENABLE_PRO_ON_SIMULATOR;
    jest.doMock('expo-device', () => ({ isDevice: false }));

    let devForcePro: boolean | undefined;
    let devForceFree: boolean | undefined;
    let statusForEntitlement: ((entitlementActive: boolean) => 'loading' | 'pro' | 'free') | undefined;
    jest.isolateModules(() => {
      const store = jest.requireActual('@/stores/proStore');
      devForcePro = store.DEV_FORCE_PRO;
      devForceFree = store.DEV_FORCE_FREE;
      statusForEntitlement = store.statusForEntitlement;
    });

    expect(devForcePro).toBe(true);
    expect(devForceFree).toBe(false);
    expect(statusForEntitlement?.(false)).toBe('pro');
  });
});

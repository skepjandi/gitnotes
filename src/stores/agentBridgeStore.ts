import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { deleteBridgeToken, setBridgeToken } from '../services/agent/bridgeSecrets';
import { normalizeBridgeUrl } from '../services/agent/pairing';
import type { AgentBridge } from '../services/agent/types';

export const AGENT_BRIDGE_STORAGE_KEY = 'agent-bridges';

interface AgentBridgeState {
  bridges: AgentBridge[];
  hydrated: boolean;
}

interface AgentBridgeActions {
  /** Re-pairing a bridge that is already known (same URL) refreshes its token and name instead of duplicating it. */
  addBridge: (input: { name: string; url: string; token: string }) => Promise<AgentBridge>;
  updateBridge: (
    id: string,
    patch: Partial<Pick<AgentBridge, 'name' | 'url'>> & { token?: string },
  ) => Promise<void>;
  removeBridge: (id: string) => Promise<void>;
  setLastWorkspace: (id: string, path: string) => void;
}

function newBridgeId(): string {
  return `bridge_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const useAgentBridgeStore = create<AgentBridgeState & AgentBridgeActions>()(
  persist(
    (set, get) => ({
      bridges: [],
      hydrated: false,

      addBridge: async ({ name, url, token }) => {
        const normalizedUrl = normalizeBridgeUrl(url);
        const label = name.trim() || normalizedUrl;
        const existing = get().bridges.find((bridge) => bridge.url === normalizedUrl);
        if (existing) {
          await setBridgeToken(existing.id, token);
          const updated = { ...existing, name: label };
          set((state) => ({ bridges: state.bridges.map((bridge) => (bridge.id === existing.id ? updated : bridge)) }));
          return updated;
        }
        const bridge: AgentBridge = { id: newBridgeId(), name: label, url: normalizedUrl, addedAt: Date.now() };
        await setBridgeToken(bridge.id, token);
        set((state) => ({ bridges: [...state.bridges, bridge] }));
        return bridge;
      },

      updateBridge: async (id, patch) => {
        const current = get().bridges.find((bridge) => bridge.id === id);
        if (!current) return;
        const next: AgentBridge = {
          ...current,
          ...(patch.name !== undefined ? { name: patch.name.trim() || current.name } : {}),
          ...(patch.url !== undefined ? { url: normalizeBridgeUrl(patch.url) } : {}),
        };
        if (patch.token !== undefined) await setBridgeToken(id, patch.token);
        set((state) => ({ bridges: state.bridges.map((bridge) => (bridge.id === id ? next : bridge)) }));
      },

      removeBridge: async (id) => {
        await deleteBridgeToken(id);
        set((state) => ({ bridges: state.bridges.filter((bridge) => bridge.id !== id) }));
      },

      setLastWorkspace: (id, path) => {
        set((state) => ({
          bridges: state.bridges.map((bridge) => (bridge.id === id ? { ...bridge, lastWorkspace: path } : bridge)),
        }));
      },
    }),
    {
      name: AGENT_BRIDGE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ bridges: state.bridges }),
      onRehydrateStorage: () => () => {
        useAgentBridgeStore.setState({ hydrated: true });
      },
    },
  ),
);

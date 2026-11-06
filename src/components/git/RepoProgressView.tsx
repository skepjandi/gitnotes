import { FlatList, Text, View } from 'react-native';

import type { ProgressLine } from '@/services/repos/cloneProgress';

function timeLabel(time: number): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const TONE_COLOR: Record<ProgressLine['tone'], string> = {
  info: 'text-primary',
  success: 'text-success',
  error: 'text-error',
};

interface RepoProgressViewProps {
  lines: ProgressLine[];
  running?: boolean;
}

/**
 * CLI-style git progress stream: monospace lines with timestamps, color-coded
 * by tone. Uses a FlatList as the scroll container so the newest line is
 * always visible (RN 0.85 renders FlatList content correctly on iOS).
 */
export default function RepoProgressView({ lines, running }: RepoProgressViewProps) {
  return (
    <View className="flex-1">
      <FlatList
        className="rounded-lg bg-slate-900 px-3 py-2"
        data={lines}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View className="flex-row items-baseline">
            <Text className="font-mono text-[11px] text-slate-500">
              {timeLabel(item.time)}{' '}
            </Text>
            <Text className={`font-mono text-[11px] flex-shrink ${TONE_COLOR[item.tone]}`}>
              {item.text}
            </Text>
          </View>
        )}
        ListFooterComponent={
          running ? (
            <View className="flex-row items-baseline">
              <Text className="font-mono text-[11px] text-slate-400">…</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

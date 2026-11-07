import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../contexts/ThemeContext';
import { Chip, Toggle } from '../ui';

const ROW_CLASS = 'px-4 py-3';

export function ControlLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text className="text-[13px] font-semibold mb-2" style={{ color: colors.textSecondary }}>
      {children}
    </Text>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

export function ChoiceRow<T extends string>(props: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  testID?: string;
}) {
  return (
    <View className={ROW_CLASS} testID={props.testID}>
      <ControlLabel>{props.label}</ControlLabel>
      <View className="flex-row flex-wrap gap-2">
        {props.options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={option.value === props.value}
            onPress={() => props.onChange(option.value)}
            testID={props.testID ? `${props.testID}.${option.value}` : undefined}
          />
        ))}
      </View>
    </View>
  );
}

export function StepperRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { value, min, max, step, onChange } = props;
  const change = (delta: number) => onChange(Math.round((Math.min(max, Math.max(min, value + delta))) * 100) / 100);

  return (
    <View className={`${ROW_CLASS} flex-row items-center justify-between`} testID={props.testID}>
      <Text className="text-[15px]" style={{ color: colors.text }}>
        {props.label}
      </Text>
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label} −`}
          disabled={value <= min}
          onPress={() => change(-step)}
          hitSlop={8}
          testID={props.testID ? `${props.testID}.decrease` : undefined}
        >
          <Ionicons name="remove-circle-outline" size={26} color={value <= min ? colors.border : colors.primary} />
        </Pressable>
        <Text className="text-[15px] font-semibold min-w-[56px] text-center" style={{ color: colors.text }}>
          {props.format ? props.format(value) : String(value)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label} +`}
          disabled={value >= max}
          onPress={() => change(step)}
          hitSlop={8}
          testID={props.testID ? `${props.testID}.increase` : undefined}
        >
          <Ionicons name="add-circle-outline" size={26} color={value >= max ? colors.border : colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

export function ColorRow(props: { label: string; color: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} ${props.color}`}
      onPress={props.onPress}
      className={`${ROW_CLASS} flex-row items-center justify-between`}
      testID={props.testID}
    >
      <Text className="text-[15px]" style={{ color: colors.text }}>
        {props.label}
      </Text>
      <View className="flex-row items-center gap-2">
        <Text className="text-[13px]" style={{ color: colors.textSecondary }}>
          {props.color.toUpperCase()}
        </Text>
        <View
          style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: props.color, borderWidth: 1, borderColor: colors.border }}
        />
      </View>
    </Pressable>
  );
}

export function ToggleRow(props: { label: string; value: boolean; onChange: (value: boolean) => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View className={`${ROW_CLASS} flex-row items-center justify-between`}>
      <Text className="text-[15px] flex-1 pr-3" style={{ color: colors.text }}>
        {props.label}
      </Text>
      <Toggle
        value={props.value}
        onValueChange={props.onChange}
        testID={props.testID}
        accessibilityRole="switch"
        accessibilityLabel={props.label}
      />
    </View>
  );
}

/**
 * Text field that edits a local draft and commits on blur. Invalid drafts are
 * not committed and show `validate`'s message, so half-typed values (a URL
 * without its scheme yet) are never normalized away under the user's cursor.
 */
export function TextFieldRow(props: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  validate?: (draft: string) => string | null;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences';
  hint?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const error = props.validate && draft ? props.validate(draft) : null;

  return (
    <View className={ROW_CLASS}>
      <ControlLabel>{props.label}</ControlLabel>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onEndEditing={() => {
          if (!error && draft !== props.value) props.onCommit(draft);
        }}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textSecondary}
        multiline={props.multiline}
        maxLength={props.maxLength}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        accessibilityLabel={props.label}
        testID={props.testID}
        className="rounded-sm px-3 py-2 text-[15px]"
        style={{
          color: colors.text,
          backgroundColor: colors.surfaceSecondary,
          minHeight: props.multiline ? 140 : undefined,
          textAlignVertical: props.multiline ? 'top' : 'center',
          fontFamily: props.multiline ? 'Courier' : undefined,
        }}
      />
      {error ? (
        <Text className="text-xs mt-1" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : props.hint ? (
        <Text className="text-xs mt-1" style={{ color: colors.textSecondary }}>
          {props.hint}
        </Text>
      ) : null}
    </View>
  );
}

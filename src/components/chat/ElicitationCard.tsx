import React, { useState } from 'react';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../contexts/ThemeContext';
import type {
  ElicitationField,
  ElicitationRequest,
  ElicitationResult,
  ElicitationValue,
} from '../../services/chat/types';
import { HapticService } from '../../utils/haptics';
import { Button, Toggle } from '../ui';

type DraftValue = string | boolean | string[];
type FieldError = 'required' | 'number' | 'integer' | 'min' | 'max';

const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i;

/** Scheme and host of an http(s) URL with any `user@` prefix stripped; `null` for anything else. */
export function parseUrlTarget(url: string): { scheme: string; host: string } | null {
  const match = URL_PARTS.exec(url.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return null;
  const host = match[2].slice(match[2].lastIndexOf('@') + 1);
  return host ? { scheme, host } : null;
}

function initialDraft(field: ElicitationField): DraftValue {
  const fallback = field.default;
  switch (field.kind) {
    case 'boolean':
      return typeof fallback === 'boolean' ? fallback : false;
    case 'multi-enum':
      return Array.isArray(fallback) ? fallback : [];
    case 'enum':
    case 'string':
      return typeof fallback === 'string' ? fallback : '';
    case 'number':
    case 'integer':
      return typeof fallback === 'number' || typeof fallback === 'string' ? String(fallback) : '';
  }
}

function isBlank(field: ElicitationField, draft: DraftValue): boolean {
  if (field.kind === 'boolean') return false;
  if (Array.isArray(draft)) return draft.length === 0;
  return typeof draft === 'string' && draft.trim() === '';
}

/** `null` when the draft is acceptable (an empty optional field is). */
export function validateField(field: ElicitationField, draft: DraftValue): FieldError | null {
  if (isBlank(field, draft)) return field.required ? 'required' : null;
  if (field.kind !== 'number' && field.kind !== 'integer') return null;
  const value = Number(draft);
  if (!Number.isFinite(value)) return 'number';
  if (field.kind === 'integer' && !Number.isInteger(value)) return 'integer';
  if (field.minimum !== undefined && value < field.minimum) return 'min';
  if (field.maximum !== undefined && value > field.maximum) return 'max';
  return null;
}

function toValue(field: ElicitationField, draft: DraftValue): ElicitationValue | undefined {
  if (isBlank(field, draft)) return undefined;
  if (field.kind === 'number' || field.kind === 'integer') return Number(draft);
  return draft;
}

export interface ElicitationCardProps {
  request: ElicitationRequest;
  agentName?: string;
  onResolve: (requestId: string, result: ElicitationResult) => void;
}

/** An open agent question, rendered inline in the transcript where the agent asked. */
export function ElicitationCard({ request, agentName, onResolve }: ElicitationCardProps) {
  const { colors, spacing, type } = useTokens();
  const { t } = useTranslation();
  const fields = request.mode === 'form' ? request.fields : [];
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, initialDraft(field)])),
  );
  const [attempted, setAttempted] = useState(false);

  const setDraft = (key: string, value: DraftValue) => setDrafts((current) => ({ ...current, [key]: value }));
  const errors = new Map<string, FieldError>();
  for (const field of fields) {
    const error = validateField(field, drafts[field.key]);
    if (error) errors.set(field.key, error);
  }

  const submit = () => {
    if (errors.size > 0) {
      setAttempted(true);
      void HapticService.warning();
      return;
    }
    const content: Record<string, ElicitationValue> = {};
    for (const field of fields) {
      const value = toValue(field, drafts[field.key]);
      if (value !== undefined) content[field.key] = value;
    }
    void HapticService.success();
    onResolve(request.id, { action: 'accept', content });
  };

  const openUrl = () => {
    if (request.mode !== 'url') return;
    const target = parseUrlTarget(request.url);
    if (!target) return;
    Alert.alert(t('chat.elicitation.openConfirmTitle', { host: target.host }), request.url, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.elicitation.open'),
        onPress: () => {
          void Linking?.openURL?.(request.url);
          onResolve(request.id, { action: 'accept', content: {} });
        },
      },
    ]);
  };

  const errorLabel = (field: ElicitationField, error: FieldError) =>
    t(`chat.elicitation.error.${error}`, { min: field.minimum, max: field.maximum });

  const pill = (selected: boolean) => ({
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: selected ? colors.primary : colors.border,
    backgroundColor: selected ? colors.primary : 'transparent',
  });

  const renderControl = (field: ElicitationField) => {
    const draft = drafts[field.key];
    switch (field.kind) {
      case 'boolean':
        return (
          <Toggle
            testID={`chat-elicitation.switch.${field.key}`}
            accessibilityRole="switch"
            accessibilityLabel={field.label}
            value={draft === true}
            onValueChange={(next) => setDraft(field.key, next)}
          />
        );
      case 'enum':
      case 'multi-enum': {
        const multi = field.kind === 'multi-enum';
        const picked = Array.isArray(draft) ? draft : [];
        return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
            {(field.options ?? []).map((option) => {
              const selected = multi ? picked.includes(option.value) : draft === option.value;
              return (
                <Pressable
                  key={option.value}
                  testID={`chat-elicitation.option.${field.key}.${option.value}`}
                  accessibilityRole={multi ? 'checkbox' : 'radio'}
                  accessibilityState={{ selected }}
                  onPress={() => {
                    if (!multi) setDraft(field.key, selected && !field.required ? '' : option.value);
                    else setDraft(field.key, selected ? picked.filter((v) => v !== option.value) : [...picked, option.value]);
                  }}
                  style={pill(selected)}
                >
                  <Text style={{ color: selected ? '#ffffff' : colors.text, fontSize: type.sm, fontWeight: '500' }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      }
      case 'string':
      case 'number':
      case 'integer': {
        const numeric = field.kind !== 'string';
        return (
          <TextInput
            testID={`chat-elicitation.input.${field.key}`}
            value={typeof draft === 'string' ? draft : ''}
            onChangeText={(text) => setDraft(field.key, text)}
            multiline={field.multiline === true}
            keyboardType={numeric ? (field.kind === 'integer' ? 'number-pad' : 'decimal-pad') : 'default'}
            placeholder={numeric && field.minimum !== undefined && field.maximum !== undefined ? `${field.minimum}–${field.maximum}` : undefined}
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={field.label}
            style={{
              color: colors.text,
              fontSize: type.md,
              minHeight: field.multiline ? 84 : 40,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingHorizontal: spacing[3],
              paddingVertical: spacing[2],
              textAlignVertical: field.multiline ? 'top' : 'center',
            }}
          />
        );
      }
    }
  };

  const target = request.mode === 'url' ? parseUrlTarget(request.url) : null;

  return (
    <View
      testID="chat-elicitation.card"
      accessibilityRole="alert"
      style={{
        alignSelf: 'stretch',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.warning,
        backgroundColor: colors.elevated,
        padding: spacing[3],
        gap: spacing[2],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
        <Ionicons name="help-circle-outline" size={15} color={colors.warning} />
        <Text
          testID="chat-elicitation.header"
          style={{ color: colors.warning, fontSize: type.xs, fontWeight: '700', letterSpacing: 0.4 }}
        >
          {t('chat.elicitation.needsYou').toUpperCase()}
        </Text>
        {agentName ? (
          <Text testID="chat-elicitation.agent" style={{ color: colors.textSecondary, fontSize: type.xs }}>
            {agentName}
          </Text>
        ) : null}
      </View>
      <Text testID="chat-elicitation.message" selectable style={{ color: colors.text, fontSize: type.md, fontWeight: '600' }}>
        {request.message}
      </Text>

      {request.mode === 'form'
        ? request.fields.map((field) => {
            const error = attempted ? errors.get(field.key) : undefined;
            const inline = field.kind === 'boolean';
            return (
              <View key={field.key} testID={`chat-elicitation.field.${field.key}`} style={{ gap: spacing[1] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontSize: type.sm, fontWeight: '600', flex: 1 }}>
                    {field.label}
                    {field.required ? <Text style={{ color: colors.error }}> *</Text> : null}
                  </Text>
                  {inline ? renderControl(field) : null}
                </View>
                {field.description ? (
                  <Text style={{ color: colors.textSecondary, fontSize: type.xs }}>{field.description}</Text>
                ) : null}
                {inline ? null : renderControl(field)}
                {error ? (
                  <Text testID={`chat-elicitation.error.${field.key}`} style={{ color: colors.error, fontSize: type.xs }}>
                    {errorLabel(field, error)}
                  </Text>
                ) : null}
              </View>
            );
          })
        : (
          <View style={{ gap: spacing[1] }}>
            <Text testID="chat-elicitation.host" style={{ color: colors.text, fontSize: type.lg, fontWeight: '700' }}>
              {target?.host ?? t('chat.elicitation.unsafeUrl')}
            </Text>
            <Text testID="chat-elicitation.url" selectable style={{ color: colors.textSecondary, fontSize: type.xs }}>
              {request.url}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: type.xs }}>{t('chat.elicitation.urlWarning')}</Text>
          </View>
        )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[1] }}>
        {request.mode === 'form' ? (
          <Button
            testID="chat-elicitation.button.submit"
            variant="primary"
            size="sm"
            label={t('chat.elicitation.submit')}
            onPress={submit}
          />
        ) : (
          <Button
            testID="chat-elicitation.button.open"
            variant="primary"
            size="sm"
            label={t('chat.elicitation.open')}
            disabled={!target}
            onPress={openUrl}
          />
        )}
        <Button
          testID="chat-elicitation.button.decline"
          variant="danger"
          size="sm"
          label={t('chat.elicitation.decline')}
          onPress={() => onResolve(request.id, { action: 'decline' })}
        />
        <Button
          testID="chat-elicitation.button.cancel"
          variant="outline"
          size="sm"
          label={t('common.cancel')}
          onPress={() => onResolve(request.id, { action: 'cancel' })}
        />
      </View>
    </View>
  );
}

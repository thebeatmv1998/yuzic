import React from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  Lock,
  Plus,
  TriangleAlert,
  X,
} from 'lucide-react-native';

import { Text } from '@/components/Text';
import Touchable from '@/components/Touchable';
import { hitSlopFor, iconSize, onDark, statusColor } from '@/constants/design';
import { useIconSize } from '@/features/theme/useIconSize';
import { useRadius } from '@/features/theme/useRadius';
import { MAX_CUSTOM_HEADERS } from '@/providers/http/customHeader';
import { styles } from './styles';

type CustomHeaderRow = { name: string; value: string };

type Props = {
  expanded: boolean;
  onToggle: () => void;
  rows: readonly CustomHeaderRow[];
  onChange: (index: number, patch: Partial<CustomHeaderRow>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSubmit: () => void;
  insecure: boolean;
};

/**
 * The optional custom request headers.
 *
 * Presentational on purpose: the screen owns the rows because it also has to
 * hand the validated list to `connect`, `ping` and the code-auth hook, and a
 * section holding its own copy would be a second place for the values to live.
 * This is only what it looks like.
 */
export default function CustomHeaderSection({
  expanded,
  onToggle,
  rows,
  onChange,
  onAdd,
  onRemove,
  onSubmit,
  insecure,
}: Props) {
  const { t } = useTranslation();
  const icons = useIconSize();
  const rad = useRadius();
  const canAdd = rows.length < MAX_CUSTOM_HEADERS;

  return (
    <>
      <Touchable style={styles.proxyToggle} onPress={onToggle}>
        <KeyRound size={icons.inline} color={onDark.mutedText} style={styles.proxyToggleIcon} />
        <Text style={styles.proxyToggleText}>{t('onboarding.credentials.customHeader.toggle')}</Text>
        {expanded
          ? <ChevronUp size={icons.inline} color={onDark.mutedText} />
          : <ChevronDown size={icons.inline} color={onDark.mutedText} />}
      </Touchable>

      {expanded && (
        <View style={styles.proxySection}>
          {insecure && (
            <View style={[styles.warningRow, { borderRadius: rad.md }]}>
              <TriangleAlert size={icons.inline} color={statusColor.warningText} />
              <Text style={styles.warningText}>
                {t('onboarding.credentials.customHeader.insecureWarning')}
              </Text>
            </View>
          )}
          <Text style={styles.customHeaderHint}>
            {t('onboarding.credentials.customHeader.helper')}
          </Text>

          {rows.map((row, index) => (
            <View key={index} style={styles.customHeaderRow}>
              <View style={styles.customHeaderRowHeader}>
                <Text style={styles.customHeaderRowLabel}>
                  {t('onboarding.credentials.customHeader.headerLabel', { index: index + 1 })}
                </Text>
                {rows.length > 1 && (
                  <Touchable
                    accessibilityRole="button"
                    accessibilityLabel={t('onboarding.credentials.customHeader.removeHeader', { index: index + 1 })}
                    onPress={() => onRemove(index)}
                    hitSlop={hitSlopFor(icons.inline)}
                  >
                    <X size={icons.inline} color={onDark.mutedText} />
                  </Touchable>
                )}
              </View>

              <View style={[styles.inputWrapper, { borderRadius: rad.md }]}>
                <KeyRound size={iconSize.control} color={onDark.mutedText} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder={t('onboarding.credentials.customHeader.namePlaceholder')}
                  placeholderTextColor={onDark.mutedText}
                  value={row.name}
                  onChangeText={name => onChange(index, { name })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
              <View style={[styles.inputWrapper, { borderRadius: rad.md }]}>
                <Lock size={iconSize.control} color={onDark.mutedText} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder={t('onboarding.credentials.customHeader.valuePlaceholder')}
                  placeholderTextColor={onDark.mutedText}
                  secureTextEntry
                  value={row.value}
                  onChangeText={value => onChange(index, { value })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={onSubmit}
                />
              </View>
            </View>
          ))}

          <Touchable
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.credentials.customHeader.addHeader')}
            onPress={onAdd}
            disabled={!canAdd}
            style={styles.addHeaderButton}
          >
            <Plus size={icons.inline} color={canAdd ? onDark.text : onDark.mutedText} />
            <Text style={[styles.addHeaderLabel, !canAdd && styles.addHeaderLabelDisabled]}>
              {t('onboarding.credentials.customHeader.addHeader')}
            </Text>
          </Touchable>
        </View>
      )}
    </>
  );
}

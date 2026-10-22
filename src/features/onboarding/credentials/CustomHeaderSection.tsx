import React from 'react';
import { TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  Lock,
  TriangleAlert,
} from 'lucide-react-native';

import { Text } from '@/components/Text';
import Touchable from '@/components/Touchable';
import { iconSize, onDark, statusColor } from '@/constants/design';
import { useIconSize } from '@/features/theme/useIconSize';
import { useRadius } from '@/features/theme/useRadius';
import { styles } from './styles';

type Props = {
  expanded: boolean;
  onToggle: () => void;
  name: string;
  onNameChange: (value: string) => void;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  insecure: boolean;
};

/**
 * The optional one custom request header.
 *
 * Presentational on purpose: the screen owns the two fields because it also
 * has to hand the validated pair to `connect`, `ping` and the code-auth hook,
 * and a section holding its own copy would be a second place for the value to
 * live. This is only what it looks like.
 */
export default function CustomHeaderSection({
  expanded,
  onToggle,
  name,
  onNameChange,
  value,
  onValueChange,
  onSubmit,
  insecure,
}: Props) {
  const { t } = useTranslation();
  const icons = useIconSize();
  const rad = useRadius();

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
          <View style={[styles.inputWrapper, { borderRadius: rad.md }]}>
            <KeyRound size={iconSize.control} color={onDark.mutedText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('onboarding.credentials.customHeader.namePlaceholder')}
              placeholderTextColor={onDark.mutedText}
              value={name}
              onChangeText={onNameChange}
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
              value={value}
              onChangeText={onValueChange}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={onSubmit}
            />
          </View>
        </View>
      )}
    </>
  );
}

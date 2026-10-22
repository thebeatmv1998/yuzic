import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { KeyRound, X } from 'lucide-react-native';

import { Text } from '@/components/Text';
import Touchable from '@/components/Touchable';
import { hitSlopFor, spacing, statusColor, typography } from '@/constants/design';
import { useTheme } from '@/features/theme/useTheme';
import { useIconSize } from '@/features/theme/useIconSize';
import { useRadius } from '@/features/theme/useRadius';
import { updateServer } from '@/state/redux/slices/serversSlice';
import { getCredentials } from '@/state/credentialCache';
import { saveServerCustomHeader } from '@/providers/registry/serverCredentials';
import { hasCustomHeader, validateCustomHeader } from '@/providers/http/customHeader';
import type { Server } from '@/providers/contracts/Server';
import SettingsCard from '../../components/SettingsCard';
import SettingsCardHeader from '../../components/SettingsCardHeader';
import SettingsDivider from '../../components/SettingsDivider';

type Props = {
  server: Server;
};

/**
 * The one custom request header a server may carry.
 *
 * The value is never rendered back. It lives in the keystore, so the card asks
 * for a new one rather than displaying the old one; leaving the field empty
 * while saving keeps the stored value, which is what makes renaming a header
 * possible without reading its secret out. Removing the header deletes the
 * keystore entry through `saveServerCustomHeader`.
 */
const CustomHeaderCard: React.FC<Props> = ({ server }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const icons = useIconSize();
  const rad = useRadius();
  const dispatch = useDispatch();

  const storedValue = getCredentials({ kind: 'server', serverId: server.id }).customHeaderValue;
  const [name, setName] = useState(server.customHeader?.name ?? '');
  const [value, setValue] = useState('');
  const [hasStoredValue, setHasStoredValue] = useState(() =>
    hasCustomHeader({ name: server.customHeader?.name ?? '', value: storedValue })
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = useCallback(async () => {
    setError(null);
    const current = getCredentials({ kind: 'server', serverId: server.id }).customHeaderValue ?? '';
    // An empty field means "keep what is stored" when there is something to
    // keep; otherwise it is an empty pair and the header is removed.
    const effectiveValue = value.trim() || current;
    const result = validateCustomHeader(name, effectiveValue);
    if (!result.ok) {
      setError(t(`settings.server.customHeader.${result.error}`));
      return;
    }

    setBusy(true);
    try {
      const sanitized = await saveServerCustomHeader(server.id, result.header);
      dispatch(updateServer({ id: server.id, patch: { customHeader: sanitized } }));
      setHasStoredValue(Boolean(sanitized));
      setValue('');
      setName(sanitized?.name ?? '');
    } catch {
      setError(t('settings.server.customHeader.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [dispatch, name, server.id, t, value]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await saveServerCustomHeader(server.id, null);
      dispatch(updateServer({ id: server.id, patch: { customHeader: undefined } }));
      setHasStoredValue(false);
      setName('');
      setValue('');
    } catch {
      setError(t('settings.server.customHeader.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [dispatch, server.id, t]);

  const insecure =
    typeof server.serverUrl === 'string' &&
    server.serverUrl.startsWith('http://') &&
    (value.trim().length > 0 || hasStoredValue);

  return (
    <>
      <SettingsCardHeader subtle title={t('settings.server.customHeader.title')} />
      <SettingsCard>
        <Text style={[styles.description, { color: colors.subtext }]}>
          {t('settings.server.customHeader.description')}
        </Text>
        <SettingsDivider />

        {insecure && (
          <Text style={[styles.warning, { color: statusColor.warningText }]}>
            {t('settings.server.customHeader.insecureWarning')}
          </Text>
        )}

        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={(next) => { setName(next); if (error) setError(null); }}
            placeholder={t('settings.server.customHeader.namePlaceholder')}
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.muted, borderRadius: rad.md },
            ]}
            testID="custom-header-name"
          />
          <View style={styles.valueRow}>
            <TextInput
              value={value}
              onChangeText={(next) => { setValue(next); if (error) setError(null); }}
              placeholder={
                hasStoredValue
                  ? t('settings.server.customHeader.valueStoredPlaceholder')
                  : t('settings.server.customHeader.valuePlaceholder')
              }
              placeholderTextColor={colors.placeholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                styles.valueInput,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.muted, borderRadius: rad.md },
              ]}
              testID="custom-header-value"
            />
            {hasStoredValue && (
              <Touchable
                accessibilityRole="button"
                accessibilityLabel={t('settings.server.customHeader.remove')}
                onPress={remove}
                disabled={busy}
                hitSlop={hitSlopFor(icons.row)}
                style={[styles.removeButton, { backgroundColor: colors.muted, borderRadius: rad.md }]}
              >
                <X size={icons.row} color={colors.subtext} />
              </Touchable>
            )}
          </View>

          <Touchable
            accessibilityRole="button"
            accessibilityLabel={t('settings.server.customHeader.save')}
            onPress={save}
            disabled={busy}
            style={[styles.saveButton, { backgroundColor: colors.muted, borderRadius: rad.md }]}
          >
            <KeyRound size={icons.inline} color={colors.text} />
            <Text style={[styles.saveLabel, { color: colors.text }]}>
              {t('settings.server.customHeader.save')}
            </Text>
          </Touchable>
        </View>

        {error ? <Text style={[styles.error, { color: statusColor.errorText }]}>{error}</Text> : null}
      </SettingsCard>
    </>
  );
};

export default CustomHeaderCard;

const styles = StyleSheet.create({
  description: {
    ...typography.caption,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.tight,
  },
  warning: {
    ...typography.caption,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  form: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    paddingVertical: spacing.controlGap,
    paddingHorizontal: spacing.md,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  valueInput: {
    flex: 1,
  },
  removeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.tight,
    paddingVertical: spacing.md,
  },
  saveLabel: {
    ...typography.button,
  },
  error: {
    ...typography.caption,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
});

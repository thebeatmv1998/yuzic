import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { KeyRound, Plus, X } from 'lucide-react-native';

import { Text } from '@/components/Text';
import Touchable from '@/components/Touchable';
import { hitSlopFor, spacing, statusColor, typography } from '@/constants/design';
import { useTheme } from '@/features/theme/useTheme';
import { useIconSize } from '@/features/theme/useIconSize';
import { useRadius } from '@/features/theme/useRadius';
import { updateServer } from '@/state/redux/slices/serversSlice';
import { getCredentials } from '@/state/credentialCache';
import { saveServerCustomHeaders } from '@/providers/registry/serverCredentials';
import {
  MAX_CUSTOM_HEADERS,
  parseStoredCustomHeaders,
  validateCustomHeaders,
} from '@/providers/http/customHeader';
import type { Server } from '@/providers/contracts/Server';
import SettingsCard from '../../components/SettingsCard';
import SettingsCardHeader from '../../components/SettingsCardHeader';
import SettingsDivider from '../../components/SettingsDivider';

type Props = {
  server: Server;
};

type Row = { name: string; value: string };

const emptyRow = (): Row => ({ name: '', value: '' });

/**
 * The custom request headers a server may carry.
 *
 * Values are never rendered back. They live in the keystore, so the card asks
 * for a new one rather than displaying the old one; leaving a row's value
 * empty keeps the value stored under that name, which is what makes renaming
 * or adding a second header possible without reading either secret out.
 */
const CustomHeaderCard: React.FC<Props> = ({ server }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const icons = useIconSize();
  const rad = useRadius();
  const dispatch = useDispatch();

  const storedHeaders = parseStoredCustomHeaders(
    getCredentials({ kind: 'server', serverId: server.id }).customHeaders
  );
  const legacyValue = getCredentials({ kind: 'server', serverId: server.id }).customHeaderValue;

  const initialRows = (): Row[] => {
    const declared = server.customHeaders ?? (server.customHeader ? [server.customHeader] : []);
    return declared.length > 0
      ? declared.map(header => ({ name: header.name, value: '' }))
      : [emptyRow()];
  };

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storedValueFor = useCallback((name: string): string | undefined => {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    const match = storedHeaders.find(
      header => header.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (match) return match.value;
    // The first fork release kept one header under its own keystore key.
    if (!server.customHeaders && server.customHeader &&
        server.customHeader.name.toLowerCase() === trimmed.toLowerCase()) {
      return legacyValue;
    }
    return undefined;
  }, [legacyValue, server.customHeader, server.customHeaders, storedHeaders]);

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    if (error) setError(null);
  };

  const addRow = () => {
    setRows(current => current.length >= MAX_CUSTOM_HEADERS ? current : [...current, emptyRow()]);
  };

  const removeRow = (index: number) => {
    setRows(current => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [emptyRow()];
    });
    if (error) setError(null);
  };

  const save = useCallback(async () => {
    setError(null);
    // An empty value keeps what is stored under the same name; a new name
    // needs a new value.
    const effective = rows.map(row => ({
      name: row.name,
      value: row.value.trim() || storedValueFor(row.name) || '',
    }));
    const result = validateCustomHeaders(effective);
    if (!result.ok) {
      setError(t(`settings.server.customHeader.${result.error}`));
      return;
    }

    setBusy(true);
    try {
      const sanitized = await saveServerCustomHeaders(server.id, result.headers);
      dispatch(updateServer({
        id: server.id,
        patch: { customHeaders: sanitized, customHeader: undefined },
      }));
      setRows(sanitized && sanitized.length > 0
        ? sanitized.map(header => ({ name: header.name, value: '' }))
        : [emptyRow()]);
    } catch {
      setError(t('settings.server.customHeader.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [dispatch, rows, server.id, storedValueFor, t]);

  const removeAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await saveServerCustomHeaders(server.id, null);
      dispatch(updateServer({
        id: server.id,
        patch: { customHeaders: undefined, customHeader: undefined },
      }));
      setRows([emptyRow()]);
    } catch {
      setError(t('settings.server.customHeader.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [dispatch, server.id, t]);

  const configured = rows.some(row => row.name.trim()) || storedHeaders.length > 0;
  const insecure =
    typeof server.serverUrl === 'string' &&
    server.serverUrl.startsWith('http://') &&
    (rows.some(row => row.value.trim()) || storedHeaders.length > 0);

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
          {rows.map((row, index) => {
            const storedValue = storedValueFor(row.name);
            return (
              <View key={index} style={styles.rowBlock}>
                <View style={styles.rowHeader}>
                  <Text style={[styles.rowLabel, { color: colors.subtext }]}>
                    {t('settings.server.customHeader.headerLabel', { index: index + 1 })}
                  </Text>
                  {rows.length > 1 && (
                    <Touchable
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.server.customHeader.removeHeader', { index: index + 1 })}
                      onPress={() => removeRow(index)}
                      hitSlop={hitSlopFor(icons.inline)}
                    >
                      <X size={icons.inline} color={colors.subtext} />
                    </Touchable>
                  )}
                </View>
                <TextInput
                  value={row.name}
                  onChangeText={name => updateRow(index, { name })}
                  placeholder={t('settings.server.customHeader.namePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.muted, borderRadius: rad.md },
                  ]}
                  testID={`custom-header-name-${index}`}
                />
                <TextInput
                  value={row.value}
                  onChangeText={value => updateRow(index, { value })}
                  placeholder={
                    storedValue
                      ? t('settings.server.customHeader.valueStoredPlaceholder')
                      : t('settings.server.customHeader.valuePlaceholder')
                  }
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.muted, borderRadius: rad.md },
                  ]}
                  testID={`custom-header-value-${index}`}
                />
              </View>
            );
          })}

          <View style={styles.actions}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={t('settings.server.customHeader.addHeader')}
              onPress={addRow}
              disabled={rows.length >= MAX_CUSTOM_HEADERS || busy}
              style={[styles.secondaryButton, { backgroundColor: colors.muted, borderRadius: rad.md }]}
            >
              <Plus size={icons.inline} color={colors.text} />
              <Text style={[styles.secondaryLabel, { color: colors.text }]}>
                {t('settings.server.customHeader.addHeader')}
              </Text>
            </Touchable>
            {configured && (
              <Touchable
                accessibilityRole="button"
                accessibilityLabel={t('settings.server.customHeader.removeAll')}
                onPress={removeAll}
                disabled={busy}
                style={[styles.secondaryButton, { backgroundColor: colors.muted, borderRadius: rad.md }]}
              >
                <X size={icons.inline} color={colors.subtext} />
                <Text style={[styles.secondaryLabel, { color: colors.subtext }]}>
                  {t('settings.server.customHeader.removeAll')}
                </Text>
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
    gap: spacing.md,
  },
  rowBlock: {
    gap: spacing.xs,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    ...typography.caption,
  },
  input: {
    ...typography.body,
    borderWidth: 1,
    paddingVertical: spacing.controlGap,
    paddingHorizontal: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.tight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: {
    ...typography.button,
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

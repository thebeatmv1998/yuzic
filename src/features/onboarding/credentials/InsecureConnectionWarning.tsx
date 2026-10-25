import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react-native';

import { Text } from '@/components/Text';
import { statusColor } from '@/constants/design';
import { useIconSize } from '@/features/theme/useIconSize';
import { useRadius } from '@/features/theme/useRadius';
import { styles } from './styles';

/**
 * The warning shown before the main username/password form when the server is
 * addressed over plain HTTP. It is deliberately separate from the proxy and
 * custom-header warnings: those describe optional credentials, while this one
 * covers the account credentials the form is about to send.
 */
export default function InsecureConnectionWarning() {
  const { t } = useTranslation();
  const icons = useIconSize();
  const rad = useRadius();

  return (
    <View style={[styles.warningRow, { borderRadius: rad.md }]}>
      <TriangleAlert size={icons.inline} color={statusColor.warningText} />
      <Text style={styles.warningText}>
        {t('onboarding.credentials.insecureConnectionWarning')}
      </Text>
    </View>
  );
}

import { Stack } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { contentWidth, onDark } from '@/constants/design';

/**
 * The onboarding flow — welcome, server type, address, credentials, libraries.
 *
 * On the web these screens are drawn in a centred column. They were laid out
 * for a phone: their buttons are `width: '100%'` and their description rows
 * run the length of the container, so on a desktop window they stretch edge to
 * edge and read as a phone app that was not meant for this window. The cap is
 * `contentWidth.readable`, the same one the rest of the app puts on a column
 * of content, so the first screens of a new install match the app behind them.
 *
 * Native is deliberately untouched: below the cap the column is the full
 * window, so a phone is unaffected, and the wrapper is not applied at all off
 * the web platform.
 */
function OnboardingStack() {
    return (
        <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="servers" options={{ headerShown: false }} />
            <Stack.Screen name="connect" options={{ headerShown: false }} />
            <Stack.Screen name="address" options={{ headerShown: false }} />
            <Stack.Screen name="credentials" options={{ headerShown: false }} />
            <Stack.Screen name="libraries" options={{ headerShown: false }} />
            <Stack.Screen name="local" options={{ headerShown: false }} />
            <Stack.Screen name="discovery" options={{ headerShown: false }} />
        </Stack>
    );
}

export default function OnboardingLayout() {
    if (Platform.OS !== 'web') return <OnboardingStack />;

    return (
        <View style={styles.page}>
            <View style={styles.column}>
                <OnboardingStack />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: {
        flex: 1,
        alignItems: 'center',
        backgroundColor: onDark.background,
    },
    column: {
        flex: 1,
        width: '100%',
        maxWidth: contentWidth.readable,
    },
});

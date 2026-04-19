import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

/**
 * Slides in from the top when the device loses connectivity. Mounted once at
 * the root so every screen benefits without individually wiring NetInfo.
 */
export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { isOnline } = useNetworkStatus();
  const translateY = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: isOnline ? -80 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [isOnline, translateY]);

  if (isOnline) {
    // Still render the animated container so the slide-out animation runs,
    // but skip the content to keep layout measurements cheap.
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.banner,
          { paddingTop: insets.top + 8, transform: [{ translateY }] },
        ]}
      />
    );
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.banner,
        { paddingTop: insets.top + 8, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.content}>
        <MaterialIcons name="cloud-off" size={16} color={colors.onError} />
        <Text style={styles.text}>You're offline — showing cached data</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: colors.error,
    paddingBottom: 10,
    paddingHorizontal: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
    }),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onError,
  },
});
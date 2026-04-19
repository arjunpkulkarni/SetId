import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { spacing } from '../theme';

const BRAND = '#105D4B';
const BRAND_DARK = '#0d4a3c';
// Lighter, airier gradient: mint → emerald. Stays on-brand but reads more
// like a "fresh finance" CTA than the previous deep-forest version.
const PRIMARY_GRADIENT = ['#4FD1A7', '#1FA87A'];
// Secondary uses a very subtle white→mint tint so the outlined button still
// reads as secondary (not another filled CTA) while feeling less flat.
const SECONDARY_GRADIENT = ['#FFFFFF', '#F0F9F6'];

function FeatureRow({ text }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.checkBadge}>
        <Text style={styles.checkMark}>✓</Text>
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress }) {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.touchable}
    >
      <Animated.View style={[styles.ctaShadow, { transform: [{ scale }] }]}>
        <LinearGradient
          colors={PRIMARY_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ctaButton}
        >
          <Text style={styles.ctaLabel}>{label}</Text>
        </LinearGradient>
      </Animated.View>
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress }) {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.touchable}
    >
      <Animated.View style={[styles.secondaryShadow, { transform: [{ scale }] }]}>
        <LinearGradient
          colors={SECONDARY_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryLabel}>{label}</Text>
        </LinearGradient>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function LandingScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const navLock = useRef(false);

  // Debounce both nav actions against the same lock so a double-tap can't
  // fire signup + login in sequence.
  const navigateOnce = useCallback((routeName) => {
    if (navLock.current) return;
    navLock.current = true;
    navigation.navigate(routeName);
    setTimeout(() => { navLock.current = false; }, 600);
  }, [navigation]);

  const goToSignup = useCallback(() => navigateOnce('PhoneAuth'), [navigateOnce]);
  const goToLogin = useCallback(() => navigateOnce('Login'), [navigateOnce]);

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <StatusBar style="dark" />

      {/* ── Hero ── */}
      <View style={styles.hero}>
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.wordmark}>Settld.</Text>

        <Text style={styles.headline} numberOfLines={1} adjustsFontSizeToFit>Split bills instantly.</Text>
        <Text style={styles.sub}>
          No awkward math. No chasing payments.
        </Text>

        <View style={styles.features}>
          <FeatureRow text="Scan receipts" />
          <FeatureRow text="Auto-assign items" />
          <FeatureRow text="Settle in seconds" />
        </View>
      </View>

      {/* ── CTA ── */}
      <View style={styles.ctaColumn}>
        <PrimaryButton label="Sign Up" onPress={goToSignup} />
        <View style={styles.buttonSpacer} />
        <SecondaryButton label="Sign In" onPress={goToLogin} />
        <Text style={styles.footer}>No fees. No spam.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'space-between',
  },

  /* Hero */
  hero: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    width: 96,
    height: 96,
    backgroundColor: '#F0F9F6',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 36,
    shadowColor: '#105D4B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  logo: {
    width: 62,
    height: 62,
  },
  wordmark: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 64,
    fontWeight: '800',
    color: BRAND,
    letterSpacing: -2,
    lineHeight: 68,
    alignSelf: 'center',
    marginBottom: 36,
  },
  headline: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 30,
    fontWeight: '800',
    color: '#111827',
    lineHeight: 36,
    letterSpacing: -0.6,
    marginBottom: 14,
  },
  sub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 17,
    color: '#6B7280',
    lineHeight: 26,
    marginBottom: 32,
  },

  /* Feature list */
  features: {
    gap: 12,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E6F4F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    fontSize: 13,
    color: BRAND,
    fontWeight: '700',
  },
  featureText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: '#374151',
  },

  /* CTA */
  ctaColumn: {
    paddingHorizontal: 24,
    // `stretch` lets the buttons take the column's full width. With
    // `center`, the TouchableOpacity collapses to just its label size.
    alignItems: 'stretch',
  },
  touchable: {
    alignSelf: 'stretch',
  },
  // Shadow lives on an outer View because LinearGradient can render its
  // own background layer that clips box shadows on Android.
  ctaShadow: {
    borderRadius: 16,
    shadowColor: '#1FA87A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  ctaButton: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ctaLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  buttonSpacer: {
    height: 12,
  },
  secondaryShadow: {
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  secondaryButton: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  secondaryLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: BRAND,
    letterSpacing: 0.2,
  },
  footer: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 14,
    textAlign: 'center',
  },
});

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { colors, radii, shadows, spacing } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../services/api';

const HERO_GRADIENT = ['#F6FCFA', '#EFF8F5', '#FDFEFE'];
const PHONE_GRADIENT = ['#55D2AA', '#20AE7B'];
const APPLE_BG = '#121B2C';

function MoneyCard() {
  return (
    <View style={[styles.floatingCard, styles.moneyCard]}>
      <View style={styles.moneyBadge}>
        <Text style={styles.moneyBadgeText}>$</Text>
      </View>
    </View>
  );
}

function ReceiptCard() {
  return (
    <View style={[styles.floatingCard, styles.receiptCard]}>
      <View style={[styles.receiptLine, styles.receiptLineWide]} />
      <View style={styles.receiptLine} />
      <View style={styles.receiptAccent} />
    </View>
  );
}

function CompassCard() {
  return (
    <View style={styles.compassShell}>
      <Image
        source={require('../../assets/logo.png')}
        style={styles.compassLogo}
        resizeMode="contain"
      />
    </View>
  );
}

export default function AuthChoiceScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = height < 820;
  const { completeAppleAuth, setPendingOnboardingName } = useAuth();

  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS !== 'ios') return;
      try {
        const available = await AppleAuthentication.isAvailableAsync();
        if (!cancelled) setAppleAvailable(available);
      } catch {
        if (!cancelled) setAppleAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Landing');
  };

  const handleApplePress = useCallback(async () => {
    if (appleLoading) return;
    setAppleLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential?.identityToken) {
        throw new Error('Apple did not return an identity token.');
      }

      const userInfo = credential.fullName
        ? {
            name: {
              firstName: credential.fullName.givenName ?? '',
              lastName: credential.fullName.familyName ?? '',
            },
            email: credential.email ?? null,
          }
        : null;

      const prefill =
        credential.fullName?.givenName ||
        (credential.email ? credential.email.split('@')[0] : '');
      if (prefill) setPendingOnboardingName(prefill);

      await completeAppleAuth({
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode ?? null,
        userInfo,
      });
    } catch (err) {
      if (err?.code === 'ERR_REQUEST_CANCELED' || err?.code === 'ERR_CANCELED') {
        return;
      }
      console.log('[AppleAuth] sign in failed', {
        code: err?.code,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        raw: err,
      });
      const baseMessage =
        err instanceof ApiError
          ? err.message
          : err?.message || 'Could not sign in with Apple. Please try again.';
      const codeLabel = err?.code ? ` [${err.code}]` : '';
      Alert.alert('Sign in failed', `${baseMessage}${codeLabel}`);
    } finally {
      setAppleLoading(false);
    }
  }, [appleLoading, completeAppleAuth, setPendingOnboardingName]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <LinearGradient
        colors={HERO_GRADIENT}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.backgroundLayer} pointerEvents="none">
          <View style={[styles.bgOrb, styles.bgOrbPrimary]} />
          <View style={[styles.bgOrb, styles.bgOrbSecondary]} />
          <View style={[styles.bgOrb, styles.bgOrbTertiary]} />
          <View style={[styles.bgOrb, styles.bgOrbQuaternary]} />
          <View style={styles.backgroundFade} />
        </View>
      </LinearGradient>

      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + (compact ? 6 : 10),
            paddingBottom: insets.bottom + (compact ? 34 : 42),
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          activeOpacity={0.86}
          accessibilityLabel="Go back"
          style={[styles.backButton, compact && styles.backButtonCompact]}
        >
          <Ionicons name="chevron-back" size={30} color={colors.brandLanding} />
        </TouchableOpacity>

        <View style={styles.topSection}>
          <View style={[styles.heroArea, compact && styles.heroAreaCompact]}>
            <View style={[styles.heroCluster, compact && styles.heroClusterCompact]}>
              <MoneyCard />
              <CompassCard />
              <ReceiptCard />
            </View>
          </View>

          <Text style={[styles.wordmark, compact && styles.wordmarkCompact]}>Settld.</Text>
          <Text style={[styles.title, compact && styles.titleCompact]}>Ready to split?</Text>
          <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
            Create an account in seconds. No fees, no spam.
          </Text>
        </View>

        <View style={[styles.bottomSection, compact && styles.bottomSectionCompact]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('PhoneAuth')}
            style={styles.buttonTouchable}
          >
            <LinearGradient
              colors={PHONE_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[
                styles.primaryButton,
                compact && styles.buttonCompact,
                shadows.sendButton,
              ]}
            >
              <MaterialIcons name="phone-iphone" size={24} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Continue with phone</Text>
            </LinearGradient>
          </TouchableOpacity>

          {appleAvailable ? (
            <>
              <View style={[styles.dividerRow, compact && styles.dividerRowCompact]}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={handleApplePress}
                disabled={appleLoading}
                style={styles.buttonTouchable}
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
              >
                <View
                  style={[
                    styles.secondaryButton,
                    compact && styles.buttonCompact,
                    appleLoading && styles.secondaryButtonDisabled,
                    shadows.card,
                  ]}
                >
                  {appleLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="logo-apple" size={25} color="#FFFFFF" />
                      <Text style={styles.secondaryButtonText}>Continue with Apple</Text>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            </>
          ) : null}

          <View style={[styles.footer, compact && styles.footerCompact]}>
            <Text style={[styles.accountCopy, compact && styles.accountCopyCompact]}>
              Already have an account?{' '}
              <Text
                style={styles.accountLink}
                onPress={() => navigation.navigate('Login')}
              >
                Log in
              </Text>
            </Text>

            <Text style={[styles.legalCopy, compact && styles.legalCopyCompact]}>
              By continuing, you agree to our{' '}
              <Text style={styles.legalLink}>Terms</Text> and{' '}
              <Text style={styles.legalLink}>Privacy Policy</Text>.
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  bgOrb: {
    position: 'absolute',
    borderRadius: 999,
  },
  bgOrbPrimary: {
    width: 420,
    height: 420,
    top: -140,
    left: -150,
    backgroundColor: 'rgba(155, 235, 215, 0.42)',
  },
  bgOrbSecondary: {
    width: 360,
    height: 360,
    top: 32,
    right: -120,
    backgroundColor: 'rgba(213, 228, 228, 0.72)',
  },
  bgOrbTertiary: {
    width: 340,
    height: 340,
    bottom: -170,
    left: -80,
    backgroundColor: 'rgba(236, 247, 243, 0.95)',
  },
  bgOrbQuaternary: {
    width: 300,
    height: 300,
    bottom: -120,
    right: -90,
    backgroundColor: 'rgba(241, 249, 246, 0.92)',
  },
  backgroundFade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
    justifyContent: 'space-between',
  },
  backButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.ambient,
  },
  backButtonCompact: {
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  topSection: {
    alignItems: 'center',
  },
  heroArea: {
    width: '100%',
    height: 218,
    justifyContent: 'flex-start',
    marginTop: 0,
    marginBottom: spacing.sm,
  },
  heroAreaCompact: {
    height: 190,
    marginTop: 0,
    marginBottom: spacing.xs,
  },
  heroCluster: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
  },
  heroClusterCompact: {
    transform: [{ scale: 0.9 }],
  },
  floatingCard: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#105D4B',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 22,
    elevation: 6,
  },
  moneyCard: {
    width: 82,
    height: 82,
    left: 22,
    top: 72,
    transform: [{ rotate: '-13deg' }],
  },
  moneyBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#56D2AA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moneyBadgeText: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 24,
    color: '#FFFFFF',
  },
  compassShell: {
    alignSelf: 'center',
    width: 154,
    height: 154,
    borderRadius: 38,
    backgroundColor: 'rgba(245, 252, 250, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#105D4B',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 8,
  },
  compassLogo: {
    width: 74,
    height: 74,
  },
  receiptCard: {
    width: 78,
    height: 96,
    right: 26,
    top: 44,
    transform: [{ rotate: '12deg' }],
    paddingHorizontal: 16,
    paddingVertical: 18,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  receiptLine: {
    width: '74%',
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D1D8E3',
    marginBottom: 6,
  },
  receiptLineWide: {
    width: '84%',
  },
  receiptAccent: {
    width: '48%',
    height: 5,
    borderRadius: 999,
    backgroundColor: '#2DB584',
    marginTop: 4,
  },
  wordmark: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -2.4,
    textAlign: 'center',
    color: colors.brandLanding,
    marginBottom: 6,
  },
  wordmarkCompact: {
    fontSize: 40,
    lineHeight: 44,
  },
  title: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -1.2,
    textAlign: 'center',
    color: '#162036',
    marginBottom: spacing.sm,
  },
  titleCompact: {
    fontSize: 29,
    lineHeight: 33,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 25,
    textAlign: 'center',
    color: '#748097',
    maxWidth: 320,
    alignSelf: 'center',
  },
  subtitleCompact: {
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 300,
  },
  bottomSection: {
    paddingTop: spacing.lg,
  },
  bottomSectionCompact: {
    paddingTop: spacing.sm,
  },
  buttonTouchable: {
    width: '100%',
  },
  primaryButton: {
    minHeight: 76,
    borderRadius: radii.full,
    paddingHorizontal: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  buttonCompact: {
    minHeight: 68,
  },
  primaryButtonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 19,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  dividerRowCompact: {
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E6E9EE',
  },
  dividerText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: '#8A92A3',
  },
  secondaryButton: {
    minHeight: 76,
    borderRadius: radii.full,
    backgroundColor: APPLE_BG,
    paddingHorizontal: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  secondaryButtonDisabled: {
    opacity: 0.6,
  },
  secondaryButtonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 19,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  footer: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  footerCompact: {
    marginTop: spacing.md,
  },
  accountCopy: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    color: '#6F788A',
    marginBottom: spacing.sm,
  },
  accountCopyCompact: {
    fontSize: 15,
    lineHeight: 22,
  },
  accountLink: {
    fontFamily: 'Inter_700Bold',
    color: colors.brandLanding,
  },
  legalCopy: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    color: '#98A2B3',
    paddingHorizontal: spacing.sm,
  },
  legalCopyCompact: {
    fontSize: 12,
    lineHeight: 18,
  },
  legalLink: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.brandLanding,
  },
});

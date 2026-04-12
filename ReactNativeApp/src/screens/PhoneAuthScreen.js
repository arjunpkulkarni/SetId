import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import parsePhoneNumberFromString from 'libphonenumber-js';
import { colors, radii, shadows, spacing } from '../theme';
import { authApi, unwrap, ApiError } from '../services/api';

function formatUsNational(digits) {
  const d = digits.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function toE164Us10(digits) {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 10) return null;
  const p = parsePhoneNumberFromString(`+1${d}`, 'US');
  return p?.isValid() ? p.format('E.164') : null;
}

function mapErrorMessage(code, fallback) {
  const map = {
    INVALID_PHONE: 'Enter a valid US mobile number.',
    RATE_LIMIT_EXCEEDED: 'Too many attempts. Try again in a little while.',
    PROVIDER_ERROR: 'We could not send a code. Try again later.',
    NETWORK_ERROR: 'Connection problem. Check your network and try again.',
  };
  return map[code] ?? fallback ?? 'Something went wrong.';
}

export default function PhoneAuthScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [national, setNational] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const e164 = useMemo(() => toE164Us10(national), [national]);
  const nameOk = firstName.trim().length > 0;
  const valid = Boolean(e164 && nameOk);

  const onChangeFirstName = (text) => {
    setFirstName(text);
    setError(null);
  };

  const onChangeNational = (text) => {
    setNational(formatUsNational(text));
    setError(null);
  };

  const onNext = async () => {
    if (!e164 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const body = await authApi.sendOtp(e164);
      const data = unwrap(body);
      navigation.navigate('VerifyOTP', {
        phone: e164,
        firstName: firstName.trim(),
        otpDevMode: Boolean(data?.otp_dev_mode),
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERROR';
      const msg = err instanceof ApiError ? err.message : String(err?.message ?? err);
      setError(mapErrorMessage(code, msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          {navigation.canGoBack() ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              hitSlop={12}
              accessibilityLabel="Back"
            >
              <MaterialIcons name="arrow-back" size={24} color={colors.secondary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          <Text style={styles.brandTitle}>WealthSplit</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.headerDivider} />

        <View style={styles.hero}>
          <Text style={styles.heroTitle}>
            Your number,{'\n'}
            <Text style={styles.heroAccent}>your security.</Text>
          </Text>
          <Text style={styles.heroSub}>
            We'll send a code to verify your account and keep your wealth secure.
          </Text>
        </View>

        <Text style={styles.label}>FIRST NAME</Text>
        <View style={styles.textFieldWrap}>
          <TextInput
            style={styles.textFieldInput}
            placeholder="Alex"
            placeholderTextColor={`${colors.outlineVariant}99`}
            value={firstName}
            onChangeText={onChangeFirstName}
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="givenName"
            maxLength={100}
          />
        </View>

        <Text style={[styles.label, styles.labelSpaced]}>PHONE NUMBER</Text>
        <View style={styles.phoneRow}>
          <TouchableOpacity style={styles.countryBox} activeOpacity={0.85}>
            <Text style={styles.flagEmoji}>🇺🇸</Text>
            <Text style={styles.countryCode}>+1</Text>
            <MaterialIcons name="expand-more" size={22} color={colors.outline} />
          </TouchableOpacity>
          <View style={styles.phoneInputWrap}>
            <TextInput
              style={styles.phoneInput}
              placeholder="(555) 000-0000"
              placeholderTextColor={`${colors.outlineVariant}99`}
              keyboardType="phone-pad"
              value={national}
              onChangeText={onChangeNational}
              maxLength={14}
              autoCorrect={false}
            />
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoBlur} />
          <View style={styles.infoRow}>
            <View style={styles.infoIconCircle}>
              <MaterialIcons name="sms" size={22} color={colors.secondary} />
            </View>
            <View style={styles.infoTextCol}>
              <Text style={styles.infoTitle}>Standard Rates Apply</Text>
              <Text style={styles.infoBody}>
                WealthSplit will send a one-time SMS code to verify your identity. Carrier
                fees for text messaging may apply.
              </Text>
            </View>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          activeOpacity={0.92}
          disabled={!valid || loading}
          onPress={onNext}
          style={[styles.ctaTouchable, (!valid || loading) && styles.ctaDisabled]}
        >
          <LinearGradient
            colors={[colors.secondary, colors.secondaryDim]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.ctaGradient, shadows.sendButton]}
          >
            {loading ? (
              <ActivityIndicator color={colors.onSecondary} />
            ) : (
              <>
                <Text style={styles.ctaText}>Next</Text>
                <MaterialIcons name="arrow-forward" size={22} color={colors.onSecondary} />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing['2xl'],
    flexGrow: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerSpacer: {
    width: 40,
  },
  backBtn: {
    width: 40,
  },
  brandTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
    letterSpacing: -0.3,
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainerHighest,
    opacity: 0.6,
    marginBottom: spacing['3xl'],
  },
  hero: {
    marginBottom: spacing['3xl'],
  },
  heroTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  heroAccent: {
    color: colors.secondary,
  },
  heroSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  labelSpaced: {
    marginTop: spacing.lg,
  },
  textFieldWrap: {
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: 0,
  },
  textFieldInput: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    color: colors.onSurface,
    padding: 0,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing['2xl'],
  },
  countryBox: {
    height: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flagEmoji: {
    fontSize: 20,
  },
  countryCode: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.onSurface,
  },
  phoneInputWrap: {
    flex: 1,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  phoneInput: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    color: colors.onSurface,
    padding: 0,
  },
  infoCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  infoBlur: {
    position: 'absolute',
    top: -16,
    right: -16,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: `${colors.secondary}14`,
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  infoIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: `${colors.secondary}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTextCol: {
    flex: 1,
  },
  infoTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 4,
  },
  infoBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.onSurfaceVariant,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.error,
    marginBottom: spacing.md,
  },
  ctaTouchable: {
    marginTop: 'auto',
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaGradient: {
    height: 56,
    borderRadius: radii.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    color: colors.onSecondary,
  },
});

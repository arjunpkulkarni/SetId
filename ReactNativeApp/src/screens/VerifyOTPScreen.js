import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { colors, radii, shadows, spacing } from '../theme';
import { authApi, unwrap, ApiError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const COOLDOWN_SEC = 45;

function mapVerifyError(code, fallback) {
  const map = {
    INVALID_OTP: 'That code is incorrect. Try again.',
    OTP_EXPIRED: 'This code expired. Request a new one.',
    INVALID_PHONE: 'Invalid phone number.',
    RATE_LIMIT_EXCEEDED: 'Too many attempts. Wait a moment and try again.',
    PROVIDER_ERROR: 'Verification failed. Try again.',
    NETWORK_ERROR: 'Connection problem. Check your network.',
  };
  return map[code] ?? fallback ?? 'Verification failed.';
}

export default function VerifyOTPScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { completePhoneAuth } = useAuth();
  const phone = route.params?.phone ?? '';
  const firstName = (route.params?.firstName ?? '').trim();
  const [otpDevMode, setOtpDevMode] = useState(Boolean(route.params?.otpDevMode));
  const inputRef = useRef(null);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const onVerify = async () => {
    if (code.length !== 6 || loading || !phone || !firstName) return;
    setLoading(true);
    setError(null);
    try {
      await completePhoneAuth(phone, code, firstName);
    } catch (err) {
      const c = err instanceof ApiError ? err.code : 'ERROR';
      const msg = err instanceof ApiError ? err.message : String(err?.message ?? err);
      setError(mapVerifyError(c, msg));
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || !phone || loading) return;
    setError(null);
    try {
      const body = await authApi.sendOtp(phone);
      const data = unwrap(body);
      setOtpDevMode(Boolean(data?.otp_dev_mode));
      setCooldown(COOLDOWN_SEC);
    } catch (err) {
      const c = err instanceof ApiError ? err.code : 'ERROR';
      const msg = err instanceof ApiError ? err.message : String(err?.message ?? err);
      setError(mapVerifyError(c, msg));
    }
  };

  const onChangeCode = (t) => {
    const digits = t.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError(null);
  };

  const canVerify = code.length === 6 && !loading && Boolean(firstName);

  const masked = useCallback(() => {
    if (!phone || phone.length < 4) return phone;
    const tail = phone.slice(-4);
    return `•••• ${tail}`;
  }, [phone]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityLabel="Go back"
          >
            <MaterialIcons name="arrow-back" size={24} color={colors.secondary} />
          </TouchableOpacity>
          <Text style={styles.brandTitle}>WealthSplit</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.headerDivider} />

        <Text style={styles.title}>Enter verification code</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{' '}
          <Text style={styles.phoneEm}>{masked()}</Text>
        </Text>

        {!firstName ? (
          <Text style={styles.nameMissing}>
            Go back and enter your first name to finish signing up.
          </Text>
        ) : null}

        {otpDevMode ? (
          <View style={styles.devHint}>
            <MaterialIcons name="terminal" size={18} color={colors.onSecondaryContainer} />
            <Text style={styles.devHintText}>
              Dev OTP: no SMS is sent. Use the 6-digit code from the API terminal (log line
              starts with "OTP dev mode").
            </Text>
          </View>
        ) : null}

        <TextInput
          ref={inputRef}
          style={styles.otpInput}
          value={code}
          onChangeText={onChangeCode}
          keyboardType="number-pad"
          maxLength={6}
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          placeholder="000000"
          placeholderTextColor={`${colors.outlineVariant}80`}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          activeOpacity={0.92}
          disabled={!canVerify}
          onPress={onVerify}
          style={[styles.ctaTouchable, !canVerify && styles.ctaDisabled]}
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
                <Text style={styles.ctaText}>Verify</Text>
                <MaterialIcons name="verified" size={22} color={colors.onSecondary} />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.resendRow}
          onPress={onResend}
          disabled={cooldown > 0}
        >
          <Text style={[styles.resendText, cooldown > 0 && styles.resendMuted]}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </Text>
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
  backBtn: {
    width: 40,
  },
  headerSpacer: {
    width: 40,
  },
  brandTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainerHighest,
    opacity: 0.6,
    marginBottom: spacing['3xl'],
  },
  title: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 26,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  devHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.secondaryContainer,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing['2xl'],
  },
  devHintText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: colors.onSecondaryContainer,
  },
  phoneEm: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.onSurface,
  },
  nameMissing: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.error,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  otpInput: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 36,
    letterSpacing: 10,
    color: colors.onSurface,
    paddingVertical: spacing.lg,
    marginBottom: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.error,
    marginBottom: spacing.md,
  },
  ctaTouchable: {
    marginBottom: spacing.lg,
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
  resendRow: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  resendText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.secondary,
  },
  resendMuted: {
    color: colors.onSurfaceVariant,
  },
});

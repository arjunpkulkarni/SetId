import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
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
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import parsePhoneNumberFromString from 'libphonenumber-js';
import { colors, radii, shadows, spacing } from '../theme';
import { authApi, unwrap, ApiError, BASE_URL } from '../services/api';

const US_FLAG_URI =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDwasLfGs2yAHoAksnkA7j0KCwqkaYnz2rcbytxxarH87dCl7NlQKt-m0DiG5ggq5RGq1q-0XIPauZFtG0rEjVNJrmqP9PphqLZUEt7YAXjTFVdSDbGXSyxkKe2vSY_-yP_AjeQ_PmWesCfbDNNQJPio1u8iMYRBDbTBxJF6SeGM2JtJy51lPoIZs3fS38oIiuFJrlfldUeokU7zFE2H2gCaGOy7wwfP4hW92NjrJXZFQi-t7quMrGXW26AgQkK4PfsyHqLcGSz';

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
  return p?.isPossible() ? p.format('E.164') : null;
}

function maskPhoneTail(e164) {
  if (!e164 || e164.length < 4) return '****';
  return e164.slice(-4);
}

function mapSendOtpError(code, fallback) {
  const map = {
    INVALID_PHONE: 'Enter a valid US mobile number.',
    RATE_LIMIT_EXCEEDED: 'Too many attempts. Try again in a little while.',
    PROVIDER_ERROR: 'We could not send a code. Try again later.',
    CONFIG_ERROR: 'SMS verification is not configured on the server.',
    NETWORK_ERROR: 'Connection problem. Check your network and try again.',
    PHONE_NOT_REGISTERED:
      'No account for this number. We opened Get Started so you can sign up.',
  };
  return map[code] ?? fallback ?? 'Something went wrong.';
}

export default function PhoneLoginScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [national, setNational] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const submitLock = useRef(false);

  useEffect(() => {
    const pre = route.params?.prefillE164;
    if (!pre || typeof pre !== 'string') return;
    const digits = pre.replace(/^\+1/, '').replace(/\D/g, '').slice(0, 10);
    if (digits.length === 10) setNational(formatUsNational(digits));
  }, [route.params?.prefillE164]);

  const e164 = useMemo(() => toE164Us10(national), [national]);
  const valid = Boolean(e164);

  const onChangeNational = (text) => {
    setNational(formatUsNational(text));
    setError(null);
  };

  const onContinue = useCallback(async () => {
    if (!e164 || loading || submitLock.current) return;
    submitLock.current = true;
    setError(null);
    setLoading(true);
    if (__DEV__) {
      console.log('[SPLTR] phone_login send_otp attempt', {
        phone_tail: maskPhoneTail(e164),
        baseUrl: BASE_URL,
      });
    }
    try {
      const body = await authApi.sendOtp(e164, 'login');
      const data = unwrap(body);
      if (__DEV__) {
        console.log('[SPLTR] phone_login send_otp ok', {
          phone_tail: maskPhoneTail(e164),
          otp_dev_mode: data?.otp_dev_mode,
        });
      }
      navigation.navigate('VerifyOTP', {
        phone: e164,
        firstName: '',
        mode: 'login',
        otpDevMode: Boolean(data?.otp_dev_mode),
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'ERROR';
      const msg = err instanceof ApiError ? err.message : String(err?.message ?? err);
      if (__DEV__) {
        console.warn('[SPLTR] phone_login send_otp failed', {
          code,
          message: msg,
          phone_tail: maskPhoneTail(e164),
        });
      }
      if (code === 'PHONE_NOT_REGISTERED') {
        navigation.replace('PhoneAuth', { prefillE164: e164 });
        return;
      }
      setError(mapSendOtpError(code, msg));
    } finally {
      setLoading(false);
      setTimeout(() => {
        submitLock.current = false;
      }, 400);
    }
  }, [e164, loading, navigation]);

  const redirectBanner =
    route.params?.redirectReason === 'existing_account'
      ? 'This number is already registered. Sign in with your code below.'
      : null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + spacing['2xl'],
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={styles.topBarRow}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={styles.backBtn}
              accessibilityLabel="Go back"
            >
              <MaterialIcons name="arrow-back" size={24} color={colors.secondary} />
            </TouchableOpacity>
            <Text style={styles.brandTitle}>Settld</Text>
            <View style={styles.topBarSpacer} />
          </View>
          <View style={styles.headerDivider} />
        </View>

        <View style={styles.main}>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>
              Welcome back,{'\n'}
              <Text style={styles.heroAccent}>sign in to continue.</Text>
            </Text>
            <Text style={styles.heroSub}>
              Enter your phone number to access your account securely.
            </Text>
          </View>

          {redirectBanner ? (
            <View style={styles.redirectBanner}>
              <MaterialIcons name="info-outline" size={20} color={colors.secondary} />
              <Text style={styles.redirectBannerText}>{redirectBanner}</Text>
            </View>
          ) : null}

          <View style={styles.formBlock}>
            <Text style={styles.fieldLabel}>Phone Number</Text>
            <View style={styles.phoneRow}>
              <View style={styles.countryChip}>
                <Image source={{ uri: US_FLAG_URI }} style={styles.flag} />
                <Text style={styles.dialCode}>+1</Text>
                <MaterialIcons name="expand-more" size={20} color={colors.outline} />
              </View>
              <View style={styles.phoneInputWrap}>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="(555) 000-0000"
                  placeholderTextColor={`${colors.outlineVariant}99`}
                  keyboardType="phone-pad"
                  value={national}
                  onChangeText={onChangeNational}
                  maxLength={14}
                  editable={!loading}
                />
              </View>
            </View>

            <View style={styles.infoRow}>
              <MaterialIcons name="info-outline" size={18} color={colors.outline} style={styles.infoIcon} />
              <Text style={styles.infoText}>
                Settld will send a one-time SMS code to verify your identity. Standard carrier
                fees may apply.
              </Text>
            </View>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.92}
              disabled={!valid || loading}
              onPress={onContinue}
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
                    <Text style={styles.ctaText}>Continue</Text>
                    <MaterialIcons name="arrow-forward" size={22} color={colors.onSecondary} />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
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
    flexGrow: 1,
    paddingHorizontal: spacing['2xl'],
  },
  topBar: {
    marginBottom: spacing['3xl'],
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  backBtn: {
    width: 40,
  },
  topBarSpacer: {
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
    backgroundColor: colors.surfaceContainerLow,
    opacity: 0.35,
  },
  main: {
    flex: 1,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  hero: {
    marginBottom: spacing['3xl'],
  },
  heroTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    lineHeight: 34,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  heroAccent: {
    color: colors.secondary,
  },
  heroSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    color: colors.onSurfaceVariant,
  },
  redirectBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: `${colors.secondary}14`,
    padding: spacing.md,
    borderRadius: radii.lg,
    marginBottom: spacing.lg,
  },
  redirectBannerText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    color: colors.onSurface,
  },
  formBlock: {
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
    marginBottom: spacing.md,
    marginLeft: 4,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'stretch',
  },
  countryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
  },
  flag: {
    width: 24,
    height: 16,
    borderRadius: 2,
  },
  dialCode: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.onSurface,
  },
  phoneInputWrap: {
    flex: 1,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  phoneInput: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    color: colors.onSurface,
    padding: 0,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: 4,
  },
  infoIcon: {
    marginTop: 2,
  },
  infoText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: colors.onSurfaceVariant,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.error,
    marginBottom: spacing.md,
  },
  actions: {
    marginTop: 'auto',
    paddingTop: spacing['2xl'],
  },
  ctaTouchable: {
    width: '100%',
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaGradient: {
    height: 64,
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

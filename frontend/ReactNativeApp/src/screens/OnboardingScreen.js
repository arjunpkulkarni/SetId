import React, { useEffect, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii, shadows, spacing } from '../theme';
import { useAuth } from '../contexts/AuthContext';

const HERO_GRADIENT = ['#F7FBF9', '#EDF8F4', '#E5F4EE'];
const CTA_GRADIENT = ['#35C698', '#14906F'];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { createProfile, pendingOnboardingName } = useAuth();
  const [fullName, setFullName] = useState((pendingOnboardingName || '').trim());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const n = (pendingOnboardingName || '').trim();
    if (n) setFullName(n);
  }, [pendingOnboardingName]);

  const valid = fullName.trim().length > 0;

  const onContinue = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await createProfile(fullName.trim());
    } catch (e) {
      setError(e?.message ?? 'Could not create profile');
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
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={HERO_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroGlowPrimary} />
          <View style={styles.heroGlowSecondary} />

          <View style={styles.logoShell}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <Text style={styles.wordmark}>Settld.</Text>
          <Text style={styles.title}>Finish your profile</Text>
          <Text style={styles.subtitle}>
            Choose the name you want on shared bills and payment requests — especially
            if you signed in with Apple.
          </Text>
        </LinearGradient>

        <View style={styles.formCard}>
          <Text style={styles.sectionEyebrow}>YOUR DETAILS</Text>
          <Text style={styles.formTitle}>What should we call you?</Text>
          <Text style={styles.formSubtitle}>
            Use the name you want to appear in shared bills and payment requests.
          </Text>

          <Text style={styles.label}>FULL NAME</Text>
          <View style={[styles.inputWrap, error && styles.inputWrapError]}>
            <MaterialIcons
              name="person-outline"
              size={20}
              color={error ? colors.error : colors.onSurfaceVariant}
            />
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={(t) => {
                setFullName(t);
                setError(null);
              }}
              placeholder="Alex Johnson"
              placeholderTextColor={`${colors.outlineVariant}CC`}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={255}
              returnKeyType="done"
              onSubmitEditing={onContinue}
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <TouchableOpacity
          activeOpacity={0.92}
          disabled={!valid || loading}
          onPress={onContinue}
          style={[styles.ctaTouchable, (!valid || loading) && styles.ctaDisabled]}
        >
          <LinearGradient
            colors={CTA_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.ctaGradient, shadows.sendButton]}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.ctaText}>Continue</Text>
                <MaterialIcons name="arrow-forward" size={22} color="#FFFFFF" />
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
    backgroundColor: '#F5F7F6',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
  },
  heroCard: {
    overflow: 'hidden',
    borderRadius: 30,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['3xl'],
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: 'rgba(16, 93, 75, 0.08)',
    ...shadows.ambient,
  },
  heroGlowPrimary: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(107, 230, 194, 0.24)',
    top: -70,
    right: -90,
  },
  heroGlowSecondary: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: 'rgba(16, 93, 75, 0.08)',
    bottom: -60,
    left: -70,
  },
  logoShell: {
    width: 92,
    height: 92,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowColor: '#105D4B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 5,
  },
  logo: {
    width: 56,
    height: 56,
  },
  wordmark: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 32,
    lineHeight: 36,
    color: colors.brandLanding,
    letterSpacing: -1.2,
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1.2,
    color: '#12352C',
    marginBottom: spacing.sm,
    maxWidth: 280,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 23,
    color: '#4E665E',
    maxWidth: 300,
    marginBottom: spacing.xl,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderWidth: 1,
    borderColor: 'rgba(43, 52, 55, 0.06)',
    ...shadows.card,
  },
  sectionEyebrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 1.7,
    color: '#6D857C',
    marginBottom: spacing.sm,
  },
  formTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 24,
    lineHeight: 28,
    color: '#152B24',
    marginBottom: spacing.sm,
  },
  formSubtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 22,
    color: '#667A73',
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.4,
    color: '#6B7E77',
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  inputWrap: {
    minHeight: 60,
    borderRadius: 18,
    backgroundColor: '#F7FAF8',
    borderWidth: 1,
    borderColor: '#DCE7E2',
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inputWrapError: {
    borderColor: '#E2A7A3',
    backgroundColor: '#FFF8F7',
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    color: colors.onSurface,
    paddingVertical: 16,
    paddingHorizontal: 0,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.sm,
  },
  ctaTouchable: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
  ctaDisabled: {
    opacity: 0.45,
  },
  ctaGradient: {
    minHeight: 58,
    borderRadius: radii.full,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    color: '#FFFFFF',
  },
});

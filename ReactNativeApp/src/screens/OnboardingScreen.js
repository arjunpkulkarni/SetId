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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii, shadows, spacing } from '../theme';
import { useAuth } from '../contexts/AuthContext';

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
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Welcome to WealthSplit</Text>
        <Text style={styles.subtitle}>
          Finish onboarding by adding your full name.
        </Text>
        <Text style={styles.label}>FULL NAME</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={(t) => {
              setFullName(t);
              setError(null);
            }}
            placeholder="Alex Johnson"
            placeholderTextColor={`${colors.outlineVariant}99`}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={255}
          />
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

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
  title: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
    marginBottom: spacing['3xl'],
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  inputWrap: {
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  input: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    color: colors.onSurface,
    padding: 0,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.sm,
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

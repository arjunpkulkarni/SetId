import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { bills } from '../services/api';

export default function CreateBillScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Bill title is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await bills.create({
        title: trimmed,
        merchantName: merchantName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      const bill = res.data;
      navigation.replace('BillSplit', { billId: bill.id });
    } catch (err) {
      setError(err?.error?.message ?? 'Failed to create bill');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          style={styles.backBtn}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>New Bill</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.iconHero}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="receipt-long" size={32} color={colors.secondary} />
          </View>
          <Text style={styles.heroTitle}>Create a new bill</Text>
          <Text style={styles.heroSubtitle}>
            Add details now, scan a receipt or add items later.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputWrapper}>
            <Text style={styles.label}>Bill Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Friday Night Dinner"
              placeholderTextColor={colors.outlineVariant}
              value={title}
              onChangeText={setTitle}
              editable={!loading}
              maxLength={255}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.label}>Merchant / Venue</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Taco Bar, Starbucks"
              placeholderTextColor={colors.outlineVariant}
              value={merchantName}
              onChangeText={setMerchantName}
              editable={!loading}
              maxLength={255}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Any additional details..."
              placeholderTextColor={colors.outlineVariant}
              value={notes}
              onChangeText={setNotes}
              editable={!loading}
              multiline
              textAlignVertical="top"
              maxLength={500}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity activeOpacity={0.85} onPress={handleCreate} disabled={loading}>
            <LinearGradient
              colors={[colors.secondary, colors.secondaryDim]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.button, shadows.settleButton]}
            >
              {loading ? (
                <ActivityIndicator color={colors.onSecondary} />
              ) : (
                <View style={styles.buttonInner}>
                  <MaterialIcons name="add" size={20} color={colors.onSecondary} />
                  <Text style={styles.buttonText}>Create Bill</Text>
                </View>
              )}
            </LinearGradient>
          </TouchableOpacity>
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
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: 'rgba(248, 249, 250, 0.92)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
  },
  content: {
    paddingHorizontal: 24,
  },
  iconHero: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.onSurface,
  },
  heroSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  form: {
    gap: 20,
  },
  inputWrapper: {
    gap: 6,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 14,
  },
  error: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
  },
  button: {
    borderRadius: radii.full,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});

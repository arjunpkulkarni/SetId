import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Keyboard,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { bills as billsApi } from '../services/api';

function parsePartySize(raw) {
  const n = parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : NaN;
}

function finishReceiptSetup(navigation, billId) {
  navigation.dispatch(
    CommonActions.reset({
      index: 1,
      routes: [
        { name: 'MainTabs' },
        { name: 'BillSplit', params: { billId, refresh: Date.now() } },
      ],
    }),
  );
}

export default function ReceiptSetupPartyScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const billId = route?.params?.billId;
  const [loading, setLoading] = useState(true);
  const [billTitle, setBillTitle] = useState('');
  const [partyInput, setPartyInput] = useState('2');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!billId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await billsApi.getSummary(billId);
        if (cancelled) return;
        const b = res?.data?.bill;
        setBillTitle(b?.title || b?.merchant_name || 'Bill');
        const existing = b?.expected_party_size;
        if (existing != null && Number(existing) >= 2) {
          setPartyInput(String(Number(existing)));
        }
      } catch (err) {
        if (!cancelled) {
          Alert.alert('Error', err?.message ?? err?.error?.message ?? 'Could not load bill');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [billId]);

  const handleContinue = useCallback(async () => {
    if (!billId) return;
    Keyboard.dismiss();
    const n = parsePartySize(partyInput);
    if (!Number.isFinite(n) || n < 2) {
      Alert.alert('Party size', 'Enter how many people are splitting the bill (at least 2).');
      return;
    }
    if (n > 999) {
      Alert.alert('Party size', 'That number is too large.');
      return;
    }
    setSaving(true);
    try {
      await billsApi.update(billId, { expected_party_size: n });
      finishReceiptSetup(navigation, billId);
    } catch (err) {
      Alert.alert('Could not save', err?.message ?? err?.error?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [billId, navigation, partyInput]);

  const bump = (delta) => {
    const cur = parsePartySize(partyInput);
    const base = Number.isFinite(cur) ? cur : 2;
    setPartyInput(String(Math.min(999, Math.max(2, base + delta))));
  };

  if (!billId) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.errorText}>Missing bill</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
          <Text style={styles.linkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          Party size
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.stepHint}>Step 2 of 2 · {billTitle}</Text>

        <View style={styles.card}>
          <View style={styles.cardIcon}>
            <MaterialIcons name="groups" size={24} color={colors.onSecondaryContainer} />
          </View>
          <Text style={styles.cardTitle}>How many people are splitting?</Text>
          <Text style={styles.cardSubtitle}>
            Tax is divided evenly across this headcount. Item shares still follow who ordered what.
          </Text>

          <View style={styles.stepperRow}>
            <TouchableOpacity style={styles.stepperBtn} onPress={() => bump(-1)} activeOpacity={0.85}>
              <MaterialIcons name="remove" size={24} color={colors.secondary} />
            </TouchableOpacity>
            <TextInput
              value={partyInput}
              onChangeText={(t) => setPartyInput(t.replace(/\D/g, '').slice(0, 3))}
              keyboardType="number-pad"
              style={styles.partyInput}
              textAlign="center"
            />
            <TouchableOpacity style={styles.stepperBtn} onPress={() => bump(1)} activeOpacity={0.85}>
              <MaterialIcons name="add" size={24} color={colors.secondary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleContinue}
            disabled={saving}
            style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.onSecondary} />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.onSurfaceVariant,
  },
  linkText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: colors.secondary,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    padding: 8,
  },
  topTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  stepHint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginBottom: 16,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 28,
    padding: 24,
    ...shadows.card,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 22,
    fontWeight: '800',
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
    marginTop: 6,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 28,
  },
  stepperBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLow,
  },
  partyInput: {
    minWidth: 88,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 16,
    fontFamily: 'Manrope_700Bold',
    fontSize: 28,
    fontWeight: '700',
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 12,
  },
  primaryBtn: {
    minHeight: 54,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});

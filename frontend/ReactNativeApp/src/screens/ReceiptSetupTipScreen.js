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
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  InputAccessoryView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { bills as billsApi } from '../services/api';

const TIP_AMOUNT_INPUT_ACCESSORY_ID = 'settldReceiptSetupTipAccessory';

function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function cleanMoneyText(value) {
  const cleaned = `${value ?? ''}`.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  const decimals = rest.join('').slice(0, 2);
  return rest.length > 0 ? `${whole}.${decimals}` : whole;
}

function normalizeTipMode(value) {
  return value === 'no_tip' ? 'no_tip' : 'proportional';
}

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

export default function ReceiptSetupTipScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const billId = route?.params?.billId;
  const [loading, setLoading] = useState(true);
  const [billTitle, setBillTitle] = useState('');
  const [tipMode, setTipMode] = useState(null);
  const [tipInput, setTipInput] = useState('');
  const [initialTipFromBill, setInitialTipFromBill] = useState(0);
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
        const detectedTip = parsePriceValue(b?.tip);
        setInitialTipFromBill(detectedTip);
        setTipInput(detectedTip > 0 ? detectedTip.toFixed(2) : '');
        setTipMode(detectedTip > 0 ? normalizeTipMode(b?.tip_split_mode) : null);
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

  const tipOptions = initialTipFromBill > 0
    ? [
        { mode: 'proportional', label: 'Split proportionally', helper: 'Guests share tip by item subtotal.' },
        { mode: 'no_tip', label: 'No tip', helper: 'Set tip to $0.00.' },
      ]
    : [
        { mode: 'proportional', label: 'Add tip and split proportionally', helper: 'Guests share tip by item subtotal.' },
        { mode: 'no_tip', label: 'No tip', helper: 'No tip was paid.' },
      ];

  const handleContinue = useCallback(async () => {
    if (!billId) return;
    if (!tipMode) {
      Alert.alert('Choose a tip option', 'Select how the tip should be handled.');
      return;
    }
    const tipAmount = tipMode === 'no_tip' ? 0 : parsePriceValue(tipInput);
    if (tipMode !== 'no_tip' && tipAmount <= 0) {
      Alert.alert('Enter tip amount', 'Add the tip amount the host paid.');
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    try {
      await billsApi.update(billId, {
        tip: tipAmount.toFixed(2),
        tip_split_mode: tipMode,
      });
      navigation.navigate('ReceiptSetupParty', { billId });
    } catch (err) {
      Alert.alert('Could not save tip', err?.message ?? err?.error?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [billId, navigation, tipInput, tipMode]);

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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={TIP_AMOUNT_INPUT_ACCESSORY_ID}>
          <View style={styles.inputAccessory}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.inputAccessoryBtn} hitSlop={12}>
              <Text style={styles.inputAccessoryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          Tip
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.stepHint}>Step 1 of 2 · {billTitle}</Text>

        <View style={styles.card}>
          <View style={styles.cardIcon}>
            <MaterialIcons name="payments" size={24} color={colors.onSecondaryContainer} />
          </View>
          <Text style={styles.cardTitle}>
            {initialTipFromBill > 0 ? `Tip detected: ${formatCurrency(initialTipFromBill)}` : 'Was tip paid?'}
          </Text>
          <Text style={styles.cardSubtitle}>
            Guests will see this with their item shares. You can change it later from the bill screen.
          </Text>

          <View style={styles.options}>
            {tipOptions.map((option) => {
              const selected = tipMode === option.mode;
              return (
                <TouchableOpacity
                  key={option.mode}
                  activeOpacity={0.85}
                  onPress={() => {
                    setTipMode(option.mode);
                    if (option.mode === 'no_tip') setTipInput('0.00');
                  }}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.optionCopy}>
                    <Text style={styles.optionLabel}>{option.label}</Text>
                    <Text style={styles.optionHelper}>{option.helper}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {tipMode && tipMode !== 'no_tip' ? (
            <View style={styles.amountWrap}>
              <Text style={styles.amountLabel}>Tip amount</Text>
              <View style={styles.amountInputOuter}>
                <Text style={styles.amountPrefix}>$</Text>
                <TextInput
                  value={tipInput}
                  onChangeText={(v) => setTipInput(cleanMoneyText(v))}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={Platform.OS === 'ios' ? TIP_AMOUNT_INPUT_ACCESSORY_ID : undefined}
                  placeholder="0.00"
                  placeholderTextColor={colors.outline}
                  style={styles.amountInput}
                />
              </View>
            </View>
          ) : null}

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
    </KeyboardAvoidingView>
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
  options: {
    gap: 10,
    marginTop: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
  },
  optionSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.surfaceContainerLow,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioSelected: {
    borderColor: colors.secondary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.secondary,
  },
  optionCopy: {
    flex: 1,
  },
  optionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  optionHelper: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    lineHeight: 17,
    marginTop: 2,
  },
  amountWrap: {
    marginTop: 18,
  },
  amountLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: 8,
  },
  amountInputOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerLow,
    overflow: 'hidden',
  },
  amountPrefix: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
    paddingLeft: 16,
    paddingRight: 4,
  },
  amountInput: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 12,
    paddingRight: 16,
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
    backgroundColor: 'transparent',
  },
  primaryBtn: {
    minHeight: 54,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
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
  inputAccessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputAccessoryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  inputAccessoryBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.secondary,
  },
});

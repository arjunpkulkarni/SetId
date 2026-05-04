import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  InputAccessoryView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii } from '../../theme';
import { bills as billsApi } from '../../services/api';

const TIP_ACCESSORY_ID = 'settldTipPartyInlineAccessory';

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

function parsePartySize(raw) {
  const n = parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : NaN;
}

function summaryFromBill(bill) {
  if (!bill) return 'Tap to expand';
  const n = bill.expected_party_size;
  const tip = parsePriceValue(bill.tip);
  const mode = bill.tip_split_mode;
  const parts = [];
  if (tip > 0 && mode !== 'no_tip') parts.push(`Tip ${formatCurrency(tip)}`);
  else parts.push('No tip');
  if (n != null && Number(n) >= 2) parts.push(`Party of ${n}`);
  else parts.push('Set party size');
  return parts.join(' · ');
}

export function TipAndPartyInline({ bill, billId, onSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [tipMode, setTipMode] = useState(null);
  const [tipInput, setTipInput] = useState('');
  const [initialTip, setInitialTip] = useState(0);
  const [partyInput, setPartyInput] = useState('2');
  const [saving, setSaving] = useState(false);

  const initFromBill = useCallback(() => {
    if (!bill) return;
    const detected = parsePriceValue(bill.tip);
    setInitialTip(detected);
    setTipInput(detected > 0 ? detected.toFixed(2) : '');
    setTipMode(detected > 0 ? normalizeTipMode(bill.tip_split_mode) : null);
    const existing = bill.expected_party_size;
    if (existing != null && Number(existing) >= 2) {
      setPartyInput(String(Number(existing)));
    } else {
      setPartyInput('2');
    }
  }, [bill]);

  useEffect(() => {
    if (!expanded) {
      initFromBill();
    }
  }, [expanded, initFromBill, bill]);

  const tipOptions =
    initialTip > 0
      ? [
          { mode: 'proportional', label: 'Split proportionally', helper: 'By each person’s items.' },
          { mode: 'no_tip', label: 'No tip', helper: '$0.00 tip on the bill.' },
        ]
      : [
          {
            mode: 'proportional',
            label: 'Add tip (split proportionally)',
            helper: 'Guests share by item subtotal.',
          },
          { mode: 'no_tip', label: 'No tip', helper: 'No tip on this bill.' },
        ];

  const bumpParty = (delta) => {
    const cur = parsePartySize(partyInput);
    const base = Number.isFinite(cur) ? cur : 2;
    setPartyInput(String(Math.min(999, Math.max(2, base + delta))));
  };

  const toggle = () => {
    if (expanded) {
      Keyboard.dismiss();
      setExpanded(false);
      initFromBill();
    } else {
      initFromBill();
      setExpanded(true);
    }
  };

  const handleSave = async () => {
    if (!billId) return;
    if (!tipMode) {
      Alert.alert('Tip', 'Choose how tip is handled.');
      return;
    }
    const tipAmount = tipMode === 'no_tip' ? 0 : parsePriceValue(tipInput);
    if (tipMode !== 'no_tip' && tipAmount <= 0) {
      Alert.alert('Tip', 'Enter the tip amount.');
      return;
    }
    const n = parsePartySize(partyInput);
    if (!Number.isFinite(n) || n < 2) {
      Alert.alert('Party size', 'Enter at least 2 people splitting the bill.');
      return;
    }
    if (n > 999) {
      Alert.alert('Party size', 'That number is too large.');
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    try {
      await billsApi.update(billId, {
        tip: tipAmount.toFixed(2),
        tip_split_mode: tipMode,
        expected_party_size: n,
      });
      setExpanded(false);
      onSaved?.();
    } catch (err) {
      Alert.alert('Could not save', err?.message ?? err?.error?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={TIP_ACCESSORY_ID}>
          <View style={styles.accessory}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.accessoryBtn} hitSlop={12}>
              <Text style={styles.accessoryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={toggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityExpanded={expanded}
        accessibilityLabel="Tip and party size"
      >
        <MaterialIcons name="tune" size={18} color={colors.secondary} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Tip & party size</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {summaryFromBill(bill)}
          </Text>
        </View>
        <MaterialIcons
          name={expanded ? 'expand-less' : 'expand-more'}
          size={26}
          color={colors.onSurfaceVariant}
        />
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.panel}>
          <Text style={styles.sectionLabel}>Tip</Text>
          <Text style={styles.sectionHint}>
            {initialTip > 0 ? `Detected ${formatCurrency(initialTip)} on receipt.` : 'How should tip work?'}
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
                  inputAccessoryViewID={Platform.OS === 'ios' ? TIP_ACCESSORY_ID : undefined}
                  placeholder="0.00"
                  placeholderTextColor={colors.outline}
                  style={styles.amountInput}
                />
              </View>
            </View>
          ) : null}

          <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Party size</Text>
          <Text style={styles.sectionHint}>
            Tax splits evenly by this headcount (when set). Items still follow assignments.
          </Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity style={styles.stepperBtn} onPress={() => bumpParty(-1)} activeOpacity={0.85}>
              <MaterialIcons name="remove" size={22} color={colors.secondary} />
            </TouchableOpacity>
            <TextInput
              value={partyInput}
              onChangeText={(t) => setPartyInput(t.replace(/\D/g, '').slice(0, 3))}
              keyboardType="number-pad"
              style={styles.partyInput}
              textAlign="center"
            />
            <TouchableOpacity style={styles.stepperBtn} onPress={() => bumpParty(1)} activeOpacity={0.85}>
              <MaterialIcons name="add" size={22} color={colors.secondary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleSave}
            disabled={saving}
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.onSecondary} />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 20,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  headerSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  panel: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
  },
  sectionLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSurface,
    letterSpacing: 0.2,
  },
  sectionLabelSpaced: {
    marginTop: 18,
  },
  sectionHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 4,
    lineHeight: 16,
  },
  options: {
    gap: 8,
    marginTop: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLowest,
  },
  optionSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.surfaceContainerLow,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
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
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.secondary,
  },
  optionCopy: {
    flex: 1,
  },
  optionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
  },
  optionHelper: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 15,
  },
  amountWrap: {
    marginTop: 12,
  },
  amountLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: 6,
  },
  amountInputOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLowest,
    overflow: 'hidden',
  },
  amountPrefix: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    paddingLeft: 14,
    paddingRight: 4,
  },
  amountInput: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingRight: 14,
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    backgroundColor: 'transparent',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 12,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLowest,
  },
  partyInput: {
    minWidth: 72,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    fontWeight: '700',
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: 8,
  },
  saveBtn: {
    minHeight: 48,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  accessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  accessoryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  accessoryBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.secondary,
  },
});

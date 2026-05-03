import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import { colors, radii, shadows } from '../theme';
import { stripeConnect, users as usersApi } from '../services/api';
import {
  createBankAccountTokenWithRetry,
  createCardTokenWithRetry,
  getPayoutFundingBlockReason,
  normalizePayoutErr,
  withPayoutSetupRetry,
} from '../utils/payoutErrors';

function digitsOnly(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/**
 * Change the Connect default payout destination (debit card or US bank).
 * Identity stays on file — only the external account is replaced.
 */
export default function UpdatePayoutCardScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { createToken } = useStripe();

  const currentBrand = route?.params?.currentBrand;
  const currentLast4 = route?.params?.currentLast4;
  const currentAccountType = route?.params?.currentAccountType;
  const onUpdated = route?.params?.onUpdated;

  const [payoutChannel, setPayoutChannel] = useState(
    currentAccountType === 'bank' ? 'bank' : 'card',
  );
  const [cardComplete, setCardComplete] = useState(false);
  const [bankRouting, setBankRouting] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await usersApi.getMyProfile();
        const name = String(res?.data?.full_name ?? '').trim();
        if (!cancelled && name) setAccountHolderName(name);
      } catch {
        /* user can still use card flow */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bankReady =
    digitsOnly(bankRouting).length === 9
    && String(bankAccount ?? '').replace(/\s/g, '').length >= 4
    && String(bankAccount ?? '').replace(/\s/g, '').length <= 17
    && accountHolderName.trim().length > 1;

  const canSubmit =
    payoutChannel === 'card' ? cardComplete : bankReady;

  const handleSubmit = async () => {
    if (submitting) return;
    if (payoutChannel === 'card') {
      if (!cardComplete) {
        Alert.alert('Incomplete', 'Please enter complete debit card details.');
        return;
      }
    } else {
      if (!bankReady) {
        if (!accountHolderName.trim()) {
          Alert.alert(
            'Name required',
            'We need your legal name on the account. Pull to refresh your profile or contact support.',
          );
          return;
        }
        Alert.alert(
          'Incomplete',
          'Enter your 9-digit routing number and checking account number.',
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      if (payoutChannel === 'card') {
        const { token, error: tokenError } = await createCardTokenWithRetry(
          createToken,
          { type: 'Card', currency: 'usd' },
        );
        if (tokenError) {
          Alert.alert(
            'Card error',
            tokenError.message ?? 'Could not read that card. Try again.',
          );
          setSubmitting(false);
          return;
        }
        if (!token?.id) {
          Alert.alert('Card error', 'Could not tokenize the card. Try again.');
          setSubmitting(false);
          return;
        }
        const fundingBlock = getPayoutFundingBlockReason(token);
        if (fundingBlock) {
          Alert.alert('Debit card required', fundingBlock);
          setSubmitting(false);
          return;
        }
        await withPayoutSetupRetry(() =>
          stripeConnect.updatePayoutMethod({ card_token: token.id }),
        );
      } else {
        const { token, error: tokenError } = await createBankAccountTokenWithRetry(
          createToken,
          {
            type: 'BankAccount',
            country: 'US',
            currency: 'usd',
            routingNumber: digitsOnly(bankRouting),
            accountNumber: String(bankAccount ?? '').replace(/\s/g, ''),
            accountHolderName: accountHolderName.trim(),
            accountHolderType: 'Individual',
          },
        );
        if (tokenError) {
          Alert.alert(
            'Bank error',
            tokenError.message ?? 'Could not verify that account. Check the numbers and try again.',
          );
          setSubmitting(false);
          return;
        }
        if (!token?.id) {
          Alert.alert('Bank error', 'Could not tokenize the bank account. Try again.');
          setSubmitting(false);
          return;
        }
        await withPayoutSetupRetry(() =>
          stripeConnect.updatePayoutMethod({ bank_token: token.id }),
        );
      }

      Alert.alert(
        'Payout method updated',
        'Future payouts will go to your new account.',
        [
          {
            text: 'Done',
            onPress: () => {
              if (typeof onUpdated === 'function') onUpdated();
              navigation.goBack();
            },
          },
        ],
      );
    } catch (err) {
      const { code, message } = normalizePayoutErr(
        err,
        'Could not update payout method. Please try again.',
      );

      if (code === 'INVALID_CARD') {
        Alert.alert(
          'Card not supported',
          "This card can't be used as a payout method. Try a US debit card.",
        );
      } else if (code === 'INVALID_BANK_ACCOUNT') {
        Alert.alert(
          'Bank not supported',
          message || 'Check routing and account numbers, or try another US checking account.',
        );
      } else if (code === 'CARD_DECLINED') {
        Alert.alert('Card declined', message);
      } else {
        Alert.alert('Update failed', message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          style={styles.backBtn}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change payout method</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Choose a new US debit card or checking account for payouts. Your
          identity on file does not change.
        </Text>

        {currentLast4 ? (
          <View style={[styles.currentCard, shadows.card]}>
            <MaterialIcons
              name={currentAccountType === 'bank' ? 'account-balance' : 'credit-card'}
              size={20}
              color={colors.onSurfaceVariant}
            />
            <View style={styles.currentCardInfo}>
              <Text style={styles.currentCardLabel}>Current</Text>
              <Text style={styles.currentCardValue}>
                {currentBrand ?? (currentAccountType === 'bank' ? 'Bank' : 'Card')} ••{' '}
                {currentLast4}
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>New payout method</Text>
        <View style={styles.methodRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setPayoutChannel('card')}
            style={[
              styles.methodChip,
              payoutChannel === 'card' && styles.methodChipOn,
            ]}
          >
            <MaterialIcons
              name="credit-card"
              size={18}
              color={payoutChannel === 'card' ? colors.onSecondary : colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.methodChipText,
                payoutChannel === 'card' && styles.methodChipTextOn,
              ]}
            >
              Debit card
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setPayoutChannel('bank')}
            style={[
              styles.methodChip,
              payoutChannel === 'bank' && styles.methodChipOn,
            ]}
          >
            <MaterialIcons
              name="account-balance"
              size={18}
              color={payoutChannel === 'bank' ? colors.onSecondary : colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.methodChipText,
                payoutChannel === 'bank' && styles.methodChipTextOn,
              ]}
            >
              Bank account
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, shadows.card]}>
          {payoutChannel === 'card' ? (
            <>
              <CardField
                postalCodeEnabled={false}
                placeholders={{ number: '4242 4242 4242 4242' }}
                cardStyle={{
                  backgroundColor: colors.surfaceContainerLow,
                  textColor: colors.onSurface,
                  placeholderColor: colors.outline,
                  borderRadius: 8,
                  fontSize: 16,
                }}
                style={styles.cardField}
                onCardChange={(details) => setCardComplete(!!details?.complete)}
              />
              <Text style={styles.helpText}>
                US debit card only. Payouts run on Stripe's daily schedule.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.bankFieldLabel}>Name on account</Text>
              <TextInput
                style={styles.bankInput}
                value={accountHolderName}
                onChangeText={setAccountHolderName}
                placeholder="Same as on your bank account"
                placeholderTextColor={colors.outline}
                autoCapitalize="words"
              />
              <Text style={styles.bankFieldLabel}>Routing number</Text>
              <TextInput
                style={styles.bankInput}
                value={bankRouting}
                onChangeText={(v) => setBankRouting(digitsOnly(v).slice(0, 9))}
                placeholder="9 digits"
                placeholderTextColor={colors.outline}
                keyboardType="number-pad"
                maxLength={9}
              />
              <Text style={styles.bankFieldLabel}>Account number</Text>
              <TextInput
                style={styles.bankInput}
                value={bankAccount}
                onChangeText={(v) =>
                  setBankAccount(String(v ?? '').replace(/[^\d\s]/g, ''))
                }
                placeholder="Checking"
                placeholderTextColor={colors.outline}
                keyboardType="number-pad"
                secureTextEntry
              />
              <Text style={styles.helpText}>
                US checking account. ACH deposits typically take 1–3 business days.
              </Text>
            </>
          )}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={submitting || !canSubmit}
          style={[
            styles.submitBtn,
            (submitting || !canSubmit) && styles.submitBtnDisabled,
          ]}
        >
          <LinearGradient
            colors={[colors.secondary, colors.secondaryDim]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.submitGradient}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onSecondary} />
            ) : (
              <>
                <MaterialIcons name="lock" size={18} color={colors.onSecondary} />
                <Text style={styles.submitText}>Save</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 20,
    fontWeight: '800',
    color: colors.onSurface,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  intro: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: colors.onSurfaceVariant,
    marginBottom: 20,
  },
  currentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  currentCardInfo: {
    flex: 1,
  },
  currentCardLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
  },
  currentCardValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  methodRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  methodChipOn: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondaryDim,
  },
  methodChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  methodChipTextOn: {
    color: colors.onSecondary,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 18,
    marginBottom: 14,
  },
  cardField: {
    height: 50,
    marginBottom: 4,
  },
  bankFieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  bankInput: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    marginBottom: 12,
  },
  helpText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    lineHeight: 16,
    marginTop: 4,
  },
  submitBtn: {
    marginTop: 12,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    minHeight: 54,
  },
  submitText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});

import React, { useState } from 'react';
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
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import { colors, radii, shadows } from '../theme';
import { stripeConnect } from '../services/api';

/**
 * Lightweight "change payout method" screen for users who already
 * completed initial setup. We do NOT re-collect identity (name, DOB,
 * SSN, address) here — that's still on file on the Stripe Custom
 * account. This form just tokenizes a new debit card and asks the
 * backend to attach it as the default external account.
 *
 * Contrast with `SetupPayoutsScreen` which is the first-time onboarding
 * path and requires the full KYC payload.
 */
export default function UpdatePayoutCardScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { createToken } = useStripe();

  const [cardComplete, setCardComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const currentBrand = route?.params?.currentBrand;
  const currentLast4 = route?.params?.currentLast4;
  const onUpdated = route?.params?.onUpdated;

  const handleSubmit = async () => {
    if (submitting) return;
    if (!cardComplete) {
      Alert.alert('Incomplete', 'Please enter complete debit card details.');
      return;
    }

    setSubmitting(true);
    try {
      // Tokenize as a Connect external-account card (currency:'usd' flags
      // it for payout use vs. a charging token). Raw PAN never leaves
      // the device.
      const { token, error: tokenError } = await createToken({
        type: 'Card',
        currency: 'usd',
      });
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

      await stripeConnect.updatePayoutCard({ card_token: token.id });

      Alert.alert(
        'Payout method updated',
        "Future payouts will go to your new card.",
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
      const code = err?.error?.code;
      const message =
        err?.error?.message
        ?? err?.message
        ?? 'Could not update payout method. Please try again.';

      if (code === 'INVALID_CARD') {
        Alert.alert(
          'Card not supported',
          "This card can't be used as a payout method. Try a US debit card.",
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
          Enter the new US debit card you want your payouts sent to. Your
          identity info stays the same — we only replace the card on file.
        </Text>

        {currentLast4 ? (
          <View style={[styles.currentCard, shadows.card]}>
            <MaterialIcons
              name="credit-card"
              size={20}
              color={colors.onSurfaceVariant}
            />
            <View style={styles.currentCardInfo}>
              <Text style={styles.currentCardLabel}>Current</Text>
              <Text style={styles.currentCardValue}>
                {currentBrand ?? 'Card'} •• {currentLast4}
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>New payout method</Text>
        <View style={[styles.card, shadows.card]}>
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
            Tap the card field to fill from your Wallet, or enter a US debit
            card manually. Future payouts go to this card starting with the
            next daily run.
          </Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={submitting || !cardComplete}
          style={[
            styles.submitBtn,
            (submitting || !cardComplete) && styles.submitBtnDisabled,
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
                <Text style={styles.submitText}>Save new card</Text>
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

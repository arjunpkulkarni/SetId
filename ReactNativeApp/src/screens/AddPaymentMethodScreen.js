import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardField, useStripe, usePlatformPay, PlatformPayButton } from '@stripe/stripe-react-native';
import { colors, radii } from '../theme';
import { paymentMethods as paymentMethodsApi } from '../services/api';

function TopBar({ insets, onBack }) {
  return (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <TouchableOpacity onPress={onBack} style={styles.topBarBtn} activeOpacity={0.7}>
        <MaterialIcons name="close" size={24} color={colors.onSurfaceVariant} />
      </TouchableOpacity>
      <Text style={styles.topBarTitle}>Add Payment Method</Text>
      <View style={styles.topBarBtn} />
    </View>
  );
}

export default function AddPaymentMethodScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { confirmSetupIntent } = useStripe();
  const { isPlatformPaySupported, confirmPlatformPaySetupIntent } = usePlatformPay();
  const returnBillId = route?.params?.billId;

  const [cardComplete, setCardComplete] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [applePaySupported, setApplePaySupported] = useState(false);

  useEffect(() => {
    (async () => {
      const supported = await isPlatformPaySupported();
      setApplePaySupported(supported);
    })();
  }, [isPlatformPaySupported]);

  const onAddSuccess = () => {
    if (returnBillId) {
      navigation.replace('ReviewPayment', { billId: returnBillId });
    } else {
      navigation.goBack();
    }
  };

  const handleApplePay = async () => {
    setProcessing(true);
    try {
      const setupRes = await paymentMethodsApi.createSetupIntent();
      const clientSecret = setupRes?.data?.client_secret ?? setupRes?.client_secret;

      if (!clientSecret) throw new Error('No client secret returned from server');

      const { setupIntent, error } = await confirmPlatformPaySetupIntent(clientSecret, {
        applePay: {
          merchantCountryCode: 'US',
        },
      });

      if (error) {
        if (error.code !== 'Canceled') {
          Alert.alert('Error', error.message);
        }
        setProcessing(false);
        return;
      }

      if (setupIntent?.status !== 'Succeeded') {
        Alert.alert('Setup failed', 'Unable to verify via Apple Pay. Please try again.');
        setProcessing(false);
        return;
      }

      const paymentMethodId = setupIntent.paymentMethodId;
      await paymentMethodsApi.attachPaymentMethod(paymentMethodId);

      Alert.alert('Success', 'Apple Pay added successfully!', [
        { text: 'OK', onPress: onAddSuccess },
      ]);
    } catch (err) {
      console.error('[AddPaymentMethod] Apple Pay error:', err);
      Alert.alert('Error', err?.message || 'Failed to set up Apple Pay');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddCard = async () => {
    if (!cardComplete) {
      Alert.alert('Incomplete', 'Please enter complete card details.');
      return;
    }

    setProcessing(true);
    try {
      const setupRes = await paymentMethodsApi.createSetupIntent();
      const clientSecret = setupRes?.data?.client_secret ?? setupRes?.client_secret;

      if (!clientSecret) throw new Error('No client secret returned from server');

      const { setupIntent, error } = await confirmSetupIntent(clientSecret, {
        paymentMethodType: 'Card',
      });

      if (error) {
        Alert.alert('Error', error.message);
        setProcessing(false);
        return;
      }

      if (setupIntent?.status !== 'Succeeded') {
        Alert.alert('Setup failed', 'Unable to verify your card. Please try again.');
        setProcessing(false);
        return;
      }

      const paymentMethodId = setupIntent.paymentMethodId;
      await paymentMethodsApi.attachPaymentMethod(paymentMethodId);

      Alert.alert('Success', 'Payment method added successfully!', [
        { text: 'OK', onPress: onAddSuccess },
      ]);
    } catch (err) {
      console.error('[AddPaymentMethod] error:', err);
      Alert.alert('Error', err?.message || 'Failed to add payment method');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.root}>
      <TopBar insets={insets} onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <MaterialIcons name="credit-card" size={36} color={colors.secondary} />
          </View>
          <Text style={styles.heroTitle}>Add Payment Method</Text>
          <Text style={styles.heroSubtitle}>
            Add a card to receive payments from your group. Your card info is securely stored by Stripe.
          </Text>
        </View>

        {applePaySupported && (
          <View style={styles.applePaySection}>
            <PlatformPayButton
              onPress={handleApplePay}
              type={PlatformPayButton.Type.SetUp}
              appearance={PlatformPayButton.Appearance.Black}
              borderRadius={28}
              style={styles.applePayButton}
              disabled={processing}
            />
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or pay with card</Text>
              <View style={styles.dividerLine} />
            </View>
          </View>
        )}

        <View style={styles.cardSection}>
          <Text style={styles.sectionLabel}>CARD DETAILS</Text>
          <View style={styles.cardFieldWrapper}>
            <CardField
              postalCodeEnabled={true}
              placeholders={{
                number: '4242 4242 4242 4242',
              }}
              cardStyle={styles.cardField}
              style={styles.cardFieldContainer}
              onCardChange={(cardDetails) => {
                setCardComplete(cardDetails.complete);
              }}
            />
          </View>
        </View>

        <View style={styles.infoCard}>
          <MaterialIcons name="lock" size={20} color={colors.secondary} />
          <View style={styles.infoContent}>
            <Text style={styles.infoTitle}>Secure & Encrypted</Text>
            <Text style={styles.infoText}>
              Your card details are never stored on our servers. All payment processing is handled securely by Stripe.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleAddCard}
          disabled={!cardComplete || processing}
          style={[
            styles.addButton,
            (!cardComplete || processing) && styles.addButtonDisabled,
          ]}
        >
          {processing ? (
            <ActivityIndicator color={colors.onSecondary} />
          ) : (
            <>
              <MaterialIcons name="add-card" size={20} color={colors.onSecondary} />
              <Text style={styles.addButtonText}>Add Card</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 56,
    backgroundColor: 'rgba(248, 249, 250, 0.85)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(248, 249, 250, 0.92)' },
    }),
  },
  topBarBtn: {
    width: 44,
    height: 44,
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

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heroTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 320,
  },

  applePaySection: {
    marginBottom: 8,
  },
  applePayButton: {
    height: 56,
    width: '100%',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  dividerText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginHorizontal: 16,
  },
  cardSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
    marginBottom: 12,
  },
  cardFieldWrapper: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 4,
  },
  cardFieldContainer: {
    height: 50,
  },
  cardField: {
    backgroundColor: colors.surfaceContainerLowest,
    textColor: colors.onSurface,
    placeholderColor: colors.onSurfaceVariant,
    borderRadius: radii.lg,
  },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 16,
    marginBottom: 24,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
    marginBottom: 4,
  },
  infoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    lineHeight: 19,
  },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.secondary,
    height: 56,
    borderRadius: radii.full,
    marginBottom: 16,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});

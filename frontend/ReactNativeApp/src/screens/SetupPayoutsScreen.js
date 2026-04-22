import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
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
import { useAuth } from '../contexts/AuthContext';
import { stripeConnect, users as usersApi } from '../services/api';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Digits-only string — used for SSN + ZIP + DOB fields. */
function digitsOnly(v) {
  return String(v ?? '').replace(/\D/g, '');
}

/** Split a full_name like "John Q. Public" into { first: "John", last: "Q. Public" }.
 *  Pre-fills the form when we already know the user's name from signup. */
function splitName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function LabeledField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'words',
  maxLength,
  autoCorrect = false,
  secureTextEntry = false,
  style,
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.outline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        maxLength={maxLength}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function SetupPayoutsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { createToken, createPaymentMethod } = useStripe();

  // Load the full profile once so we can pre-fill name + phone. The auth
  // context only carries the bare user summary.
  const [prefilled, setPrefilled] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // DOB broken into three inputs for a no-datepicker implementation.
  const [dobMonth, setDobMonth] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobYear, setDobYear] = useState('');

  const [addressLine1, setAddressLine1] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [addressPostalCode, setAddressPostalCode] = useState('');

  const [ssnLast4, setSsnLast4] = useState('');

  const [cardComplete, setCardComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await usersApi.getMyProfile();
        if (cancelled) return;
        const p = res?.data ?? {};
        const { first, last } = splitName(p.full_name);
        setFirstName(first);
        setLastName(last);
        // Don't pre-fill the synthetic `phone.users.spltr` email — that
        // was auto-generated at signup, not a real address.
        const e = String(p.email ?? '');
        if (e && !e.endsWith('@phone.users.spltr')) {
          setEmail(e);
        }
        if (p.phone) setPhone(p.phone);
      } catch {
        // Non-fatal — user can type the fields from scratch.
      } finally {
        if (!cancelled) setPrefilled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Validation ────────────────────────────────────────────────────────

  const validate = () => {
    const missing = [];
    if (!firstName.trim()) missing.push('First name');
    if (!lastName.trim()) missing.push('Last name');
    if (!email.trim()) missing.push('Email');
    if (!phone.trim()) missing.push('Phone');
    if (!dobMonth.trim() || !dobDay.trim() || !dobYear.trim()) {
      missing.push('Date of birth');
    }
    if (!addressLine1.trim()) missing.push('Street address');
    if (!addressCity.trim()) missing.push('City');
    if (!addressState.trim()) missing.push('State');
    if (!addressPostalCode.trim()) missing.push('ZIP');
    if (digitsOnly(ssnLast4).length !== 4) missing.push('SSN last 4');
    if (!cardComplete) missing.push('Debit card');

    if (missing.length) {
      Alert.alert('Missing info', `Please fill in: ${missing.join(', ')}`);
      return false;
    }

    const m = Number(dobMonth);
    const d = Number(dobDay);
    const y = Number(dobYear);
    if (!(m >= 1 && m <= 12)) {
      Alert.alert('Invalid date', 'Month must be 1-12.');
      return false;
    }
    if (!(d >= 1 && d <= 31)) {
      Alert.alert('Invalid date', 'Day must be 1-31.');
      return false;
    }
    const thisYear = new Date().getFullYear();
    if (!(y >= 1900 && y <= thisYear)) {
      Alert.alert('Invalid date', `Year must be 1900-${thisYear}.`);
      return false;
    }
    // Stripe requires account owners to be at least 13 (in practice 18+
    // for money transmission). Flag here so users don't get a confusing
    // Stripe-side rejection.
    const age = thisYear - y;
    if (age < 18) {
      Alert.alert(
        'Too young',
        'You must be at least 18 years old to receive payouts.',
      );
      return false;
    }

    if (addressState.trim().length !== 2) {
      Alert.alert('Invalid state', 'Use the 2-letter state code (e.g. NY).');
      return false;
    }

    return true;
  };

  // ── Submit ────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      // 1) Tokenize the debit card as a Connect external-account token.
      //    Passing `currency: 'usd'` tags it for use on a Connect account
      //    (vs. a plain card token for charging). The raw PAN never
      //    leaves the device.
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      const { token, error: tokenError } = await createToken({
        type: 'Card',
        name: fullName,
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

      // 2) ALSO create a reusable PaymentMethod from the same card input.
      //    This is what the platform's Stripe Customer will charge when
      //    the user pays for a bill as a guest. Without this, the user
      //    would have to re-add their card via the separate "Add Payment
      //    Method" flow — same card, duplicate work.
      //
      //    Non-fatal: if this fails we still complete payout setup and
      //    the user can add a payment method later via the old flow.
      let paymentMethodId = null;
      try {
        const { paymentMethod, error: pmError } = await createPaymentMethod({
          paymentMethodType: 'Card',
          paymentMethodData: {
            billingDetails: {
              name: fullName,
              email: email.trim() || undefined,
              phone: phone.trim() || undefined,
            },
          },
        });
        if (!pmError && paymentMethod?.id) {
          paymentMethodId = paymentMethod.id;
        }
      } catch (pmErr) {
        if (__DEV__) console.warn('[SetupPayouts] createPaymentMethod failed', pmErr);
      }

      // 3) Submit identity + token (+ optional PM id) to the backend. The
      //    server creates (or reuses) the Custom account, sets identity,
      //    attaches the card as external account, accepts the Stripe ToS,
      //    and — if paymentMethodId is present — also attaches the PM to
      //    the user's Stripe Customer so the same card works for
      //    charging them when they pay a bill.
      await stripeConnect.setupPayouts({
        individual: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          dob_day: Number(dobDay),
          dob_month: Number(dobMonth),
          dob_year: Number(dobYear),
          address_line1: addressLine1.trim(),
          address_city: addressCity.trim(),
          address_state: addressState.trim().toUpperCase(),
          address_postal_code: addressPostalCode.trim(),
          ssn_last_4: digitsOnly(ssnLast4),
        },
        card_token: token.id,
        payment_method_id: paymentMethodId,
      });

      Alert.alert(
        'Payouts set up',
        'Your debit card is ready to receive instant payouts.',
        [
          {
            text: 'Done',
            onPress: () => navigation.goBack(),
          },
        ],
      );
    } catch (err) {
      const code = err?.error?.code;
      const message =
        err?.error?.message
        ?? err?.message
        ?? 'Could not set up payouts. Please try again.';

      // Friendly copy for the most common rejection reasons.
      if (code === 'INVALID_CARD') {
        Alert.alert(
          'Unsupported card',
          'Stripe only accepts US debit cards for instant payouts. Try a different card.',
        );
      } else if (code === 'CARD_DECLINED') {
        Alert.alert('Card declined', message);
      } else if (code === 'IDENTITY_REJECTED') {
        Alert.alert('Identity check failed', message);
      } else {
        Alert.alert('Setup failed', message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (!prefilled) {
    return (
      <View style={styles.rootLoading}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

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
        <Text style={styles.headerTitle}>Set up payouts</Text>
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
          Add a debit card to receive your share of the bill. This is
          processed by Stripe — your card details never touch our servers.
        </Text>

        {/* Identity ------------------------------------------------------ */}
        <Text style={styles.sectionLabel}>Your info</Text>
        <View style={[styles.card, shadows.card]}>
          <View style={styles.row2}>
            <LabeledField
              label="First name"
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Jane"
              style={styles.rowHalf}
            />
            <LabeledField
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              placeholder="Doe"
              style={styles.rowHalf}
            />
          </View>
          <LabeledField
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <LabeledField
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="+1 415 555 1234"
            keyboardType="phone-pad"
            autoCapitalize="none"
          />
        </View>

        {/* DOB ----------------------------------------------------------- */}
        <Text style={styles.sectionLabel}>Date of birth</Text>
        <View style={[styles.card, shadows.card]}>
          <View style={styles.row3}>
            <LabeledField
              label="MM"
              value={dobMonth}
              onChangeText={(v) => setDobMonth(digitsOnly(v).slice(0, 2))}
              placeholder="MM"
              keyboardType="number-pad"
              maxLength={2}
              style={styles.rowSmall}
            />
            <LabeledField
              label="DD"
              value={dobDay}
              onChangeText={(v) => setDobDay(digitsOnly(v).slice(0, 2))}
              placeholder="DD"
              keyboardType="number-pad"
              maxLength={2}
              style={styles.rowSmall}
            />
            <LabeledField
              label="YYYY"
              value={dobYear}
              onChangeText={(v) => setDobYear(digitsOnly(v).slice(0, 4))}
              placeholder="YYYY"
              keyboardType="number-pad"
              maxLength={4}
              style={styles.rowLarge}
            />
          </View>
        </View>

        {/* Address ------------------------------------------------------- */}
        <Text style={styles.sectionLabel}>Address</Text>
        <View style={[styles.card, shadows.card]}>
          <LabeledField
            label="Street"
            value={addressLine1}
            onChangeText={setAddressLine1}
            placeholder="123 Market St"
          />
          <LabeledField
            label="City"
            value={addressCity}
            onChangeText={setAddressCity}
            placeholder="San Francisco"
          />
          <View style={styles.row2}>
            <LabeledField
              label="State"
              value={addressState}
              onChangeText={(v) =>
                setAddressState(v.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase())
              }
              placeholder="CA"
              autoCapitalize="characters"
              maxLength={2}
              style={styles.rowSmall}
            />
            <LabeledField
              label="ZIP"
              value={addressPostalCode}
              onChangeText={(v) => setAddressPostalCode(digitsOnly(v).slice(0, 5))}
              placeholder="94103"
              keyboardType="number-pad"
              maxLength={5}
              style={styles.rowLarge}
            />
          </View>
        </View>

        {/* SSN ----------------------------------------------------------- */}
        <Text style={styles.sectionLabel}>Identity verification</Text>
        <View style={[styles.card, shadows.card]}>
          <LabeledField
            label="Last 4 of SSN"
            value={ssnLast4}
            onChangeText={(v) => setSsnLast4(digitsOnly(v).slice(0, 4))}
            placeholder="1234"
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
          />
          <Text style={styles.helpText}>
            Required by US law for payout accounts. Encrypted end-to-end and
            sent directly to Stripe.
          </Text>
        </View>

        {/* Debit card ---------------------------------------------------- */}
        <Text style={styles.sectionLabel}>Debit card</Text>
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
            US debit cards only. Credit cards and non-US cards can't receive
            instant payouts from Stripe.
          </Text>
        </View>

        {/* Submit -------------------------------------------------------- */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={submitting}
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
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
                <Text style={styles.submitText}>Save & activate payouts</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.legal}>
          By continuing you agree to Stripe's{' '}
          <Text style={styles.legalLink}>Connected Account Agreement</Text>{' '}
          and confirm that the info above is accurate.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  rootLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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

  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
    marginBottom: 10,
    marginTop: 10,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 18,
    marginBottom: 14,
  },

  field: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },

  row2: {
    flexDirection: 'row',
    gap: 12,
  },
  rowHalf: {
    flex: 1,
  },
  row3: {
    flexDirection: 'row',
    gap: 10,
  },
  rowSmall: {
    flex: 1,
  },
  rowLarge: {
    flex: 2,
  },

  helpText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    lineHeight: 16,
    marginTop: 4,
  },

  cardField: {
    height: 50,
    marginBottom: 4,
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

  legal: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 16,
  },
  legalLink: {
    color: colors.secondary,
    fontFamily: 'Inter_600SemiBold',
  },
});

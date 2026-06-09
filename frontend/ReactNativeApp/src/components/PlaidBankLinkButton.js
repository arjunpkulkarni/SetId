import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { create, open } from 'react-native-plaid-link-sdk';
import { colors, radii, shadows } from '../theme';
import { plaid as plaidApi } from '../services/api';

/**
 * Opens Plaid Link and completes payout or guest-pay bank linking on the server.
 */
export default function PlaidBankLinkButton({
  purpose = 'payout',
  paymentId,
  payToken,
  onLinked,
  onExit,
  disabled = false,
  label = 'Connect bank securely',
  compact = false,
}) {
  const [loading, setLoading] = useState(false);

  const completeOnServer = useCallback(
    async (publicToken, accountId) => {
      if (purpose === 'payout') {
        await plaidApi.completePayout({
          public_token: publicToken,
          account_id: accountId,
        });
      } else {
        await plaidApi.completeGuestPay({
          public_token: publicToken,
          account_id: accountId,
          payment_id: paymentId,
          pay_token: payToken,
        });
      }
    },
    [purpose, paymentId, payToken],
  );

  const handlePress = useCallback(async () => {
    if (loading || disabled) return;
    setLoading(true);
    try {
      const tokenRes = await plaidApi.createLinkToken({
        purpose,
        payment_id: paymentId,
        pay_token: payToken,
      });
      const linkToken = tokenRes?.data?.link_token;
      if (!linkToken) {
        throw new Error('Missing Plaid link token');
      }

      create({ token: linkToken });

      open({
        onSuccess: async (success) => {
          try {
            const accountId =
              success?.metadata?.accounts?.[0]?.id
              || success?.metadata?.account?.id;
            if (!success?.publicToken || !accountId) {
              throw new Error('Plaid did not return account details');
            }
            await completeOnServer(success.publicToken, accountId);
            onLinked?.(success);
          } catch (err) {
            const msg =
              err?.response?.data?.error?.message
              || err?.message
              || 'Could not link that bank account.';
            Alert.alert('Bank link failed', msg);
          } finally {
            setLoading(false);
          }
        },
        onExit: (exit) => {
          setLoading(false);
          onExit?.(exit);
        },
      });
    } catch (err) {
      setLoading(false);
      const code = err?.response?.data?.error?.code;
      const msg =
        err?.response?.data?.error?.message
        || err?.message
        || 'Could not start bank linking.';
      if (code === 'PLAID_DISABLED') {
        Alert.alert(
          'Bank linking unavailable',
          'Enter your bank details manually for now.',
        );
      } else {
        Alert.alert('Bank link', msg);
      }
    }
  }, [loading, disabled, purpose, paymentId, payToken, completeOnServer, onLinked, onExit]);

  if (compact) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handlePress}
        disabled={loading || disabled}
        style={[styles.compactBtn, (loading || disabled) && styles.disabled]}
      >
        {loading ? (
          <ActivityIndicator color={colors.secondary} size="small" />
        ) : (
          <>
            <MaterialIcons name="account-balance" size={18} color={colors.secondary} />
            <Text style={styles.compactText}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      disabled={loading || disabled}
      style={(loading || disabled) && styles.disabled}
    >
      <LinearGradient
        colors={[colors.secondary, colors.secondaryDim]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        {loading ? (
          <ActivityIndicator color={colors.onSecondary} />
        ) : (
          <View style={styles.row}>
            <MaterialIcons name="lock" size={20} color={colors.onSecondary} />
            <Text style={styles.label}>{label}</Text>
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    borderRadius: radii.full,
    paddingHorizontal: 20,
    ...shadows.settleButton,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  compactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: 'rgba(10, 91, 73, 0.2)',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
  },
  compactText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: colors.secondary,
  },
  disabled: {
    opacity: 0.55,
  },
});

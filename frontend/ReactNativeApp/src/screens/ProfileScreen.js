import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, shadows } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { users as usersApi, stripeConnect } from '../services/api';
import LazyImage from '../components/LazyImage';

/** Pretty-print a phone number, falling back to the raw value or an empty
 *  string. Accepts E.164 (e.g. "+14155551234") and returns "+1 (415) 555-1234"
 *  for US/CA numbers; otherwise returns the input untouched. */
function formatPhoneForDisplay(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  // Cached Connect status so the Payouts row shows the right color (red /
  // yellow / green) without navigating into the Payouts screen. `null`
  // while loading; `undefined` if the fetch failed (we degrade gracefully
  // and just show the neutral state).
  const [connectStatus, setConnectStatus] = useState(null);

  const loadProfile = useCallback(async () => {
    try {
      const res = await usersApi.getMyProfile();
      setProfile(res.data);
    } catch {
      setProfile(null);
    }
  }, []);

  const loadConnectStatus = useCallback(async () => {
    try {
      const res = await stripeConnect.getStatus();
      setConnectStatus(res?.data ?? null);
    } catch {
      setConnectStatus(undefined);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      Promise.all([loadProfile(), loadConnectStatus()]).finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [loadProfile, loadConnectStatus]),
  );

  const display = profile || user;
  const initials = (display?.full_name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // Phone-auth users have a synthetic email like `14155551234@phone.users.spltr`
  // that we never want to show — render their phone number instead (or nothing).
  const isSyntheticEmail = (display?.email || '').endsWith('@phone.users.spltr');
  const contactLine = isSyntheticEmail
    ? formatPhoneForDisplay(display?.phone)
    : (display?.email || '');

  const goToPayouts = useCallback(() => {
    const parent = navigation.getParent();
    if (parent) parent.navigate('Payouts');
    else navigation.navigate('Payouts');
  }, [navigation]);

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your account. Your personal details will be wiped and you\'ll be signed out. Bills and payments you were part of will remain for the other members involved.\n\nThis cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (deleting) return;
            setDeleting(true);
            try {
              await usersApi.deleteAccount();
              // logout clears cached state + token and flips the RootNavigator
              // back to the auth stack.
              await logout();
            } catch (err) {
              setDeleting(false);
              Alert.alert(
                'Could not delete account',
                err?.error?.message
                  ?? err?.message
                  ?? 'Something went wrong. Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.secondary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={[styles.heroCard, shadows.card]}>
              <View style={styles.avatarLarge}>
                {display?.avatar_url ? (
                  <LazyImage
                    source={{ uri: display.avatar_url }}
                    style={styles.avatarImg}
                    fallbackIcon="person"
                    fallbackIconSize={40}
                  />
                ) : (
                  <Text style={styles.avatarInitials}>{initials}</Text>
                )}
              </View>
              <Text style={styles.name}>{display?.full_name || 'User'}</Text>
              {contactLine ? (
                <Text style={styles.email}>{contactLine}</Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Account</Text>
              <View style={[styles.rowCard, shadows.card]}>
                <View style={styles.row}>
                  <MaterialIcons name="badge" size={22} color={colors.onSurfaceVariant} />
                  <Text style={styles.rowText}>Member since</Text>
                  <Text style={styles.rowValue}>
                    {display?.created_at
                      ? new Date(display.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Payouts — routes the user into the PayoutsScreen which
                handles onboarding + balance + instant cash-out. The small
                badge here just hints at the current state. */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Payouts</Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={goToPayouts}
                style={[styles.rowCard, shadows.card]}
              >
                <View style={styles.row}>
                  <MaterialIcons
                    name="account-balance-wallet"
                    size={22}
                    color={
                      connectStatus?.payouts_enabled
                        ? colors.secondary
                        : connectStatus?.connected
                          ? colors.tertiary
                          : colors.onSurfaceVariant
                    }
                  />
                  <View style={styles.payoutTextCol}>
                    <Text style={styles.rowText}>Payouts</Text>
                    <Text style={styles.payoutSubtitle}>
                      {!connectStatus
                        ? 'Check status'
                        : !connectStatus.connected
                          ? 'Not connected — tap to set up'
                          : !connectStatus.details_submitted
                            ? 'Finish onboarding'
                            : !connectStatus.payouts_enabled
                              ? 'Verification pending'
                              : connectStatus.external_account_last4
                                ? `Active · ${connectStatus.external_account_brand ?? (connectStatus.external_account_type === 'bank' ? 'Bank' : 'Card')} •• ${connectStatus.external_account_last4}`
                                : 'Payouts active'}
                    </Text>
                  </View>
                  <MaterialIcons
                    name="chevron-right"
                    size={22}
                    color={colors.onSurfaceVariant}
                  />
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity activeOpacity={0.85} onPress={handleLogout}>
              <LinearGradient
                colors={[colors.error, '#7d2c2a']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.logoutBtn}
              >
                <MaterialIcons name="logout" size={20} color={colors.onError} />
                <Text style={styles.logoutText}>Log out</Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.dangerZone}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleDeleteAccount}
                disabled={deleting}
                style={[
                  styles.deleteBtn,
                  deleting && styles.deleteBtnDisabled,
                ]}
              >
                <View style={styles.deleteIconWrap}>
                  {deleting ? (
                    <ActivityIndicator size="small" color={colors.error} />
                  ) : (
                    <MaterialIcons
                      name="delete-outline"
                      size={20}
                      color={colors.error}
                    />
                  )}
                </View>
                <View style={styles.deleteTextCol}>
                  <Text style={styles.deleteTitle}>
                    {deleting ? 'Deleting account…' : 'Delete account'}
                  </Text>
                  <Text style={styles.deleteSubtitle} numberOfLines={2}>
                    Permanently remove your account and personal details.
                    This cannot be undone.
                  </Text>
                </View>
                <MaterialIcons
                  name="chevron-right"
                  size={22}
                  color={colors.error}
                  style={styles.deleteChevron}
                />
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  headerTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onSurface,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  heroCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 28,
    alignItems: 'center',
    marginBottom: 28,
  },
  avatarLarge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 16,
  },
  avatarImg: {
    width: 88,
    height: 88,
  },
  avatarInitials: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 32,
    fontWeight: '800',
    color: colors.secondary,
  },
  name: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    fontWeight: '700',
    color: colors.onSurface,
    textAlign: 'center',
  },
  email: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.onSurfaceVariant,
    marginTop: 6,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  rowCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 14,
  },
  rowText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.onSurface,
  },
  rowValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: colors.onSurfaceVariant,
  },
  payoutTextCol: {
    flex: 1,
  },
  payoutSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: radii.full,
    marginTop: 8,
  },
  logoutText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onError,
  },
  dangerZone: {
    marginTop: 32,
  },
  dangerZoneLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.error,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: radii.xl,
    backgroundColor: colors.errorContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.error,
  },
  deleteBtnDisabled: {
    opacity: 0.6,
  },
  deleteIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteTextCol: {
    flex: 1,
  },
  deleteTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.error,
  },
  deleteSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.error,
    opacity: 0.8,
    marginTop: 3,
    lineHeight: 16,
  },
  deleteChevron: {
    marginLeft: 4,
    opacity: 0.8,
  },
});

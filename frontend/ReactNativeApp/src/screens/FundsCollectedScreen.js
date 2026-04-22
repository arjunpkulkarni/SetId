import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions } from '@react-navigation/native';
import { colors, radii, shadows } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { bills as billsApi } from '../services/api';
import LazyImage from '../components/LazyImage';

function formatMoney(n) {
  const x = typeof n === 'string' ? parseFloat(n) : Number(n);
  if (Number.isNaN(x)) return '$0.00';
  return `$${x.toFixed(2)}`;
}

function TopAppBar({ insets, user }) {
  const initials = (user?.full_name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBarInner}>
        <Text style={styles.appTitle}>SPLTR</Text>
        <View style={styles.headerRight}>
          <View style={styles.avatarWrap}>
            {user?.avatar_url ? (
              <LazyImage
                source={{ uri: user.avatar_url }}
                style={styles.avatarImg}
                fallbackIcon="person"
              />
            ) : (
              <Text style={styles.avatarInitials}>{initials}</Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function SuccessHeader({ amount, merchantName }) {
  return (
    <View style={styles.successHeader}>
      <View style={styles.successIcon}>
        <MaterialIcons name="check-circle" size={32} color={colors.secondaryDim} />
      </View>
      <Text style={styles.successTitle}>Payment recorded</Text>
      <Text style={styles.successDesc}>
        {formatMoney(amount)} for {merchantName || 'your bill'} was processed successfully.
      </Text>
    </View>
  );
}

function AmountCard({ amount, billTitle }) {
  return (
    <View style={styles.cardWrapper}>
      <LinearGradient
        colors={[colors.secondary, colors.secondaryDim]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.amountCard}
      >
        <Text style={styles.cardLabel}>AMOUNT PAID</Text>
        <Text style={styles.cardAmount}>{formatMoney(amount)}</Text>
        {billTitle ? <Text style={styles.cardBillTitle}>{billTitle}</Text> : null}
        <View style={styles.cardFooter}>
          <MaterialIcons name="verified-user" size={20} color="rgba(227, 255, 246, 0.75)" />
          <Text style={styles.cardFooterText}>Secured with Stripe</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

function InfoCard() {
  return (
    <View style={styles.infoCard}>
      <View style={styles.infoHeader}>
        <MaterialIcons name="info" size={22} color={colors.secondary} />
        <Text style={styles.infoTitle}>What happens next</Text>
      </View>
      <Text style={styles.infoDesc}>
        Your payment is saved on this bill. Other members can pay their shares from their
        accounts. You can return to the dashboard to see updated balances.
      </Text>
    </View>
  );
}

export default function FundsCollectedScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const amount = route?.params?.amount ?? 0;
  const merchantName = route?.params?.merchantName;
  const billTitle = route?.params?.billTitle;
  // `billId` is optional — when it's present (e.g. user came here from
  // ReviewPayment after sending a bill), we can flip the bill to
  // `settled` in-place so it moves out of Active on the dashboard.
  const billId = route?.params?.billId;

  const [completing, setCompleting] = useState(false);

  const goDashboard = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [
          {
            name: 'MainTabs',
            state: {
              routes: [{ name: 'DashboardTab' }],
              index: 0,
            },
          },
        ],
      }),
    );
  };

  const handleMarkCompleted = () => {
    if (!billId) {
      // No billId in route params — can't know which bill to settle.
      // This shouldn't normally happen; the confirmation + dashboard
      // return below still guides the user somewhere sensible.
      Alert.alert(
        'Nothing to mark',
        'This bill is already in your history. Tap Back to Dashboard.',
      );
      return;
    }
    Alert.alert(
      'Mark bill completed?',
      'This moves the bill out of your active list. You can still view it from Activity.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark completed',
          style: 'default',
          onPress: async () => {
            if (completing) return;
            setCompleting(true);
            try {
              await billsApi.update(billId, { status: 'settled' });
              goDashboard();
            } catch (err) {
              setCompleting(false);
              Alert.alert(
                'Could not update bill',
                err?.error?.message ?? err?.message ?? 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <TopAppBar insets={insets} user={user} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SuccessHeader amount={amount} merchantName={merchantName} />
        <AmountCard amount={amount} billTitle={billTitle} />
        <InfoCard />

        {/* Primary: finalize the bill. Only shown when we know which
            bill we're on. After tapping, the bill's status flips to
            `settled` and the dashboard shows it under Settled rather
            than Active. */}
        {billId ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleMarkCompleted}
            disabled={completing}
            style={[styles.primaryBtn, completing && styles.primaryBtnDisabled]}
          >
            <LinearGradient
              colors={[colors.secondary, colors.secondaryDim]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryGradient}
            >
              {completing ? (
                <ActivityIndicator color={colors.onSecondary} />
              ) : (
                <>
                  <MaterialIcons name="check-circle" size={22} color={colors.onSecondary} />
                  <Text style={styles.primaryText}>Mark bill completed</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={goDashboard}
          style={billId ? styles.secondaryBtn : styles.primaryBtn}
        >
          {billId ? (
            <>
              <MaterialIcons name="dashboard" size={20} color={colors.secondary} />
              <Text style={styles.secondaryText}>Back to Dashboard</Text>
            </>
          ) : (
            <LinearGradient
              colors={[colors.secondary, colors.secondaryDim]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryGradient}
            >
              <MaterialIcons name="dashboard" size={22} color={colors.onSecondary} />
              <Text style={styles.primaryText}>Back to Dashboard</Text>
            </LinearGradient>
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
    backgroundColor: 'rgba(248, 249, 250, 0.7)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(248, 249, 250, 0.92)' },
    }),
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  appTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onSurface,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: 32,
    height: 32,
  },
  avatarInitials: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: colors.secondary,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 24,
  },

  successHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 8,
  },
  successDesc: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 22,
  },

  cardWrapper: {
    marginBottom: 24,
  },
  amountCard: {
    borderRadius: radii.xl,
    padding: 28,
    ...Platform.select({
      ios: {
        shadowColor: colors.secondary,
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.25,
        shadowRadius: 32,
      },
      android: { elevation: 10 },
    }),
  },
  cardLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: 'rgba(227, 255, 246, 0.65)',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cardAmount: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1,
    color: colors.onSecondary,
    marginBottom: 8,
  },
  cardBillTitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: 'rgba(227, 255, 246, 0.9)',
    marginBottom: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardFooterText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: 'rgba(227, 255, 246, 0.75)',
  },

  infoCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 24,
    marginBottom: 28,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  infoTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
  },
  infoDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    lineHeight: 21,
  },

  primaryBtn: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    ...shadows.settleButton,
  },
  primaryGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: radii.xl,
  },
  primaryText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: radii.xl,
    backgroundColor: 'transparent',
    marginTop: 12,
  },
  secondaryText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.secondary,
  },
});

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import DashboardScreen from '../screens/DashboardScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { bills } from '../services/api';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

const TAB_ACTIVE = '#105D4B';
const TAB_INACTIVE = colors.outlineVariant;
const FAB_GREEN_MID = '#1FA87A';
const FAB_GREEN = '#105D4B';

const DRAFT_BILL_TITLE = 'Settld Bill';

function TabBarIcon({ name, color, focused }) {
  return (
    <View style={styles.iconWrap}>
      <MaterialIcons name={name} size={24} color={color} />
      <View style={[styles.focusIndicator, focused && styles.focusIndicatorOn]} />
    </View>
  );
}

function CenterScanTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const [creatingBill, setCreatingBill] = useState(false);

  const dashRouteIndex = state.routes.findIndex((r) => r.name === 'DashboardTab');
  const profileRouteIndex = state.routes.findIndex((r) => r.name === 'ProfileTab');

  const dashFocused = state.index === dashRouteIndex;
  const profileFocused = state.index === profileRouteIndex;

  const openScan = useCallback(async () => {
    if (creatingBill) return;
    setCreatingBill(true);
    try {
      const res = await bills.create({ title: DRAFT_BILL_TITLE });
      const billId = res?.data?.id;
      if (!billId) throw new Error('Missing bill ID');
      navigation.navigate('ScanReceipt', { billId });
    } catch (err) {
      Alert.alert(
        'Could not start bill',
        err?.error?.message ?? err?.message ?? 'Please try again.',
      );
    } finally {
      setCreatingBill(false);
    }
  }, [creatingBill, navigation]);

  const bottomPad = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 12);

  return (
    <View style={[styles.barWrap, { paddingBottom: bottomPad }]}>
      <View style={styles.sideRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ selected: dashFocused }}
          style={styles.sideTap}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('DashboardTab')}
        >
          <TabBarIcon
            name="dashboard"
            color={dashFocused ? TAB_ACTIVE : TAB_INACTIVE}
            focused={dashFocused}
          />
          <Text style={[styles.label, dashFocused && styles.labelActive]}>Dashboard</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ selected: profileFocused }}
          style={styles.sideTap}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('ProfileTab')}
        >
          <TabBarIcon
            name="person"
            color={profileFocused ? TAB_ACTIVE : TAB_INACTIVE}
            focused={profileFocused}
          />
          <Text style={[styles.label, profileFocused && styles.labelActive]}>Profile</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.fabAnchor, { bottom: bottomPad + 26 }]} pointerEvents="box-none">
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Scan receipt"
          activeOpacity={0.92}
          disabled={creatingBill}
          onPress={openScan}
          style={styles.fabTouchable}
        >
          <LinearGradient
            colors={[FAB_GREEN_MID, FAB_GREEN]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.fabGradient}
          >
            {creatingBill ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <MaterialIcons name="center-focus-strong" size={26} color="#FFFFFF" />
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CenterScanTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  barWrap: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    shadowColor: '#2b3437',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 12,
    overflow: 'visible',
  },
  sideRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
  },
  sideTap: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    maxWidth: 160,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    minHeight: 44,
  },
  focusIndicator: {
    marginTop: 6,
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  focusIndicatorOn: {
    backgroundColor: TAB_ACTIVE,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: 2,
    marginBottom: 2,
    color: TAB_INACTIVE,
  },
  labelActive: {
    color: TAB_ACTIVE,
  },
  fabAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  fabTouchable: {
    shadowColor: FAB_GREEN,
    shadowOpacity: 0.33,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  fabGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

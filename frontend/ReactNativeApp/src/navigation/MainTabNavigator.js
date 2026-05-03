import React from 'react';
import { Platform, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';

import DashboardScreen from '../screens/DashboardScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();

const TAB_ACTIVE = '#004D40';

function tabBarIconFactory(iconName) {
  return function TabBarIcon({ color, size, focused }) {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'flex-start', minHeight: 48 }}>
        <MaterialIcons name={iconName} size={size ?? 24} color={color} />
        <View
          style={{
            marginTop: 6,
            width: 28,
            height: 3,
            borderRadius: 2,
            backgroundColor: focused ? TAB_ACTIVE : 'transparent',
          }}
        />
      </View>
    );
  };
}

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TAB_ACTIVE,
        tabBarInactiveTintColor: colors.outlineVariant,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderTopWidth: 0,
          elevation: 12,
          shadowColor: '#2b3437',
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.08,
          shadowRadius: 20,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingTop: 10,
          paddingBottom: Platform.OS === 'ios' ? 28 : 12,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 12,
          fontWeight: '600',
          letterSpacing: 0.2,
          marginTop: 0,
          marginBottom: 4,
        },
        tabBarItemStyle: {
          paddingTop: 0,
        },
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarIcon: tabBarIconFactory('dashboard'),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: 'Profile',
          tabBarIcon: tabBarIconFactory('person'),
        }}
      />
    </Tab.Navigator>
  );
}

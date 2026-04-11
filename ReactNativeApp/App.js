import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  Manrope_400Regular,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';

import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import BillSplitScreen from './src/screens/BillSplitScreen';
import ReviewPaymentScreen from './src/screens/ReviewPaymentScreen';
import ActivityDetailScreen from './src/screens/ActivityDetailScreen';
import ScanReceiptScreen from './src/screens/ScanReceiptScreen';
import CreateBillScreen from './src/screens/CreateBillScreen';
import FundsCollectedScreen from './src/screens/FundsCollectedScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';

const AuthStack = createNativeStackNavigator();
const MainStack = createNativeStackNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen
        name="Signup"
        component={SignupScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </AuthStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainStack.Navigator screenOptions={{ headerShown: false }}>
      <MainStack.Screen name="MainTabs" component={MainTabNavigator} />
      <MainStack.Screen
        name="BillSplit"
        component={BillSplitScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ReviewPayment"
        component={ReviewPaymentScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ActivityDetail"
        component={ActivityDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="CreateBill"
        component={CreateBillScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <MainStack.Screen
        name="ScanReceipt"
        component={ScanReceiptScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <MainStack.Screen
        name="FundsCollected"
        component={FundsCollectedScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </MainStack.Navigator>
  );
}

function RootNavigator() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#006c5c" />
      </View>
    );
  }

  return user ? <MainNavigator /> : <AuthNavigator />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#006c5c" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
  },
});

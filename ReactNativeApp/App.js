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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import LandingScreen from './src/screens/LandingScreen';
import PhoneAuthScreen from './src/screens/PhoneAuthScreen';
import VerifyOTPScreen from './src/screens/VerifyOTPScreen';

import PhoneLoginScreen from './src/screens/PhoneLoginScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import BillSplitScreen from './src/screens/BillSplitScreen';
import ReviewPaymentScreen from './src/screens/ReviewPaymentScreen';
import ActivityDetailScreen from './src/screens/ActivityDetailScreen';
import ScanReceiptScreen from './src/screens/ScanReceiptScreen';
import FundsCollectedScreen from './src/screens/FundsCollectedScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import JoinBillScreen from './src/screens/JoinBillScreen';
import AddPaymentMethodScreen from './src/screens/AddPaymentMethodScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';

const AuthStack = createNativeStackNavigator();
const MainStack = createNativeStackNavigator();
const OnboardingStack = createNativeStackNavigator();

function AuthNavigator() {
  return (
    <AuthStack.Navigator
      screenOptions={{ headerShown: false }}
      initialRouteName="Landing"
    >
      <AuthStack.Screen name="Landing" component={LandingScreen} />
      <AuthStack.Screen
        name="Login"
        component={PhoneLoginScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <AuthStack.Screen
        name="PhoneAuth"
        component={PhoneAuthScreen}
        options={{ animation: 'fade' }}
      />
      <AuthStack.Screen
        name="VerifyOTP"
        component={VerifyOTPScreen}
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
      <MainStack.Screen
        name="JoinBill"
        component={JoinBillScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="AddPaymentMethod"
        component={AddPaymentMethodScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
    </MainStack.Navigator>
  );
}

function OnboardingNavigator() {
  return (
    <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
      <OnboardingStack.Screen name="OnboardingMain" component={OnboardingScreen} />
    </OnboardingStack.Navigator>
  );
}

function RootNavigator() {
  const { user, token, needsOnboarding, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#006c5c" />
      </View>
    );
  }

  if (!token) return <AuthNavigator />;
  if (needsOnboarding) return <OnboardingNavigator />;
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
      <GestureHandlerRootView style={styles.gestureRoot}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#006c5c" />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <StripeProvider
          publishableKey="pk_live_51RF1vSA5ckD2kd7M4w7D7m5FPVLiZNSjAUy1VcwulfDZOvmeLZ62RPK8igrgmhKmj34BtdXDO7CBZSPuWGjHjKin00yWltIKKh"
          merchantIdentifier="merchant.com.culinAILLC.settld"
        >
          <AuthProvider>
            <NavigationContainer>
              <StatusBar style="dark" />
              <RootNavigator />
            </NavigationContainer>
          </AuthProvider>
        </StripeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f9fa',
  },
});

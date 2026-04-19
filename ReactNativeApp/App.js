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
import { Provider as ReduxProvider } from 'react-redux';
import { store } from './src/store/store';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { startTimer, endTimer, markEvent } from './src/utils/performance';
import OfflineBanner from './src/components/OfflineBanner';
// Import critical screens immediately
import LandingScreen from './src/screens/LandingScreen';
import PhoneAuthScreen from './src/screens/PhoneAuthScreen';
import VerifyOTPScreen from './src/screens/VerifyOTPScreen';
import PhoneLoginScreen from './src/screens/PhoneLoginScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';
import LazyScreen from './src/components/LazyScreen';

// Lazy load non-critical screens to improve initial startup
const BillSplitScreen = React.lazy(() => import('./src/screens/BillSplitScreen'));
const ReviewPaymentScreen = React.lazy(() => import('./src/screens/ReviewPaymentScreen'));
const ActivityDetailScreen = React.lazy(() => import('./src/screens/ActivityDetailScreen'));
const ScanReceiptScreen = React.lazy(() => import('./src/screens/ScanReceiptScreen'));
const FundsCollectedScreen = React.lazy(() => import('./src/screens/FundsCollectedScreen'));
const NotificationsScreen = React.lazy(() => import('./src/screens/NotificationsScreen'));
const JoinBillScreen = React.lazy(() => import('./src/screens/JoinBillScreen'));
const AddPaymentMethodScreen = React.lazy(() => import('./src/screens/AddPaymentMethodScreen'));

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
        component={(props) => <LazyScreen component={BillSplitScreen} {...props} />}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ReviewPayment"
        component={(props) => <LazyScreen component={ReviewPaymentScreen} {...props} />}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ActivityDetail"
        component={(props) => <LazyScreen component={ActivityDetailScreen} {...props} />}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ScanReceipt"
        component={(props) => <LazyScreen component={ScanReceiptScreen} {...props} />}
        options={{ animation: 'slide_from_bottom' }}
      />
      <MainStack.Screen
        name="FundsCollected"
        component={(props) => <LazyScreen component={FundsCollectedScreen} {...props} />}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="Notifications"
        component={(props) => <LazyScreen component={NotificationsScreen} {...props} />}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="JoinBill"
        component={(props) => <LazyScreen component={JoinBillScreen} {...props} />}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="AddPaymentMethod"
        component={(props) => <LazyScreen component={AddPaymentMethodScreen} {...props} />}
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
  React.useEffect(() => {
    startTimer('app_startup');
    markEvent('app_init');
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Don't block the app if fonts fail to load - fall back to system fonts
  const shouldRender = fontsLoaded || fontError;
  
  React.useEffect(() => {
    if (shouldRender) {
      endTimer('app_startup');
      markEvent('fonts_loaded', { fontsLoaded, fontError: !!fontError });
    }
  }, [shouldRender, fontsLoaded, fontError]);

  if (!shouldRender) {
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
      <ReduxProvider store={store}>
        <SafeAreaProvider>
          <StripeProvider
            publishableKey="pk_live_51RF1vSA5ckD2kd7M4w7D7m5FPVLiZNSjAUy1VcwulfDZOvmeLZ62RPK8igrgmhKmj34BtdXDO7CBZSPuWGjHjKin00yWltIKKh"
            merchantIdentifier="merchant.com.culinAILLC.settld"
          >
            <AuthProvider>
              <NavigationContainer>
                <StatusBar style="dark" />
                <RootNavigator />
                <OfflineBanner />
              </NavigationContainer>
            </AuthProvider>
          </StripeProvider>
        </SafeAreaProvider>
      </ReduxProvider>
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

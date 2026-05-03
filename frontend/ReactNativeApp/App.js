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
import AuthChoiceScreen from './src/screens/AuthChoiceScreen';
import PhoneAuthScreen from './src/screens/PhoneAuthScreen';
import VerifyOTPScreen from './src/screens/VerifyOTPScreen';
import PhoneLoginScreen from './src/screens/PhoneLoginScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';
import LazyScreen from './src/components/LazyScreen';
// Eager import: expo-camera + React.lazy/Metro code-splitting often breaks native module
// resolution ("unknown module", lazy default export undefined). Keep this screen in the main bundle.
import ScanReceiptScreen from './src/screens/ScanReceiptScreen';

// Lazy load non-critical screens to improve initial startup
const BillSplitScreen = React.lazy(() => import('./src/screens/BillSplitScreen'));
const ReceiptSetupTipScreen = React.lazy(() => import('./src/screens/ReceiptSetupTipScreen'));
const ReceiptSetupPartyScreen = React.lazy(() => import('./src/screens/ReceiptSetupPartyScreen'));
const ReviewPaymentScreen = React.lazy(() => import('./src/screens/ReviewPaymentScreen'));
const ActivityDetailScreen = React.lazy(() => import('./src/screens/ActivityDetailScreen'));
const FundsCollectedScreen = React.lazy(() => import('./src/screens/FundsCollectedScreen'));
const NotificationsScreen = React.lazy(() => import('./src/screens/NotificationsScreen'));
const JoinBillScreen = React.lazy(() => import('./src/screens/JoinBillScreen'));
const PayoutsScreen = React.lazy(() => import('./src/screens/PayoutsScreen'));
const SetupPayoutsScreen = React.lazy(() => import('./src/screens/SetupPayoutsScreen'));
const UpdatePayoutCardScreen = React.lazy(() =>
  import('./src/screens/UpdatePayoutCardScreen'),
);

// Stable components for lazy screens — inline `component={() => ...}` identities change every
// MainNavigator render and trigger React Navigation warnings + unnecessary remounts.
function BillSplitStackScreen(props) {
  return <LazyScreen component={BillSplitScreen} {...props} />;
}
function ReceiptSetupTipStackScreen(props) {
  return <LazyScreen component={ReceiptSetupTipScreen} {...props} />;
}
function ReceiptSetupPartyStackScreen(props) {
  return <LazyScreen component={ReceiptSetupPartyScreen} {...props} />;
}
function ReviewPaymentStackScreen(props) {
  return <LazyScreen component={ReviewPaymentScreen} {...props} />;
}
function ActivityDetailStackScreen(props) {
  return <LazyScreen component={ActivityDetailScreen} {...props} />;
}
function FundsCollectedStackScreen(props) {
  return <LazyScreen component={FundsCollectedScreen} {...props} />;
}
function NotificationsStackScreen(props) {
  return <LazyScreen component={NotificationsScreen} {...props} />;
}
function JoinBillStackScreen(props) {
  return <LazyScreen component={JoinBillScreen} {...props} />;
}
function PayoutsStackScreen(props) {
  return <LazyScreen component={PayoutsScreen} {...props} />;
}
function SetupPayoutsStackScreen(props) {
  return <LazyScreen component={SetupPayoutsScreen} {...props} />;
}
function UpdatePayoutCardStackScreen(props) {
  return <LazyScreen component={UpdatePayoutCardScreen} {...props} />;
}

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
        name="AuthChoice"
        component={AuthChoiceScreen}
        options={{ animation: 'slide_from_right' }}
      />
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
        component={BillSplitStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ReceiptSetupTip"
        component={ReceiptSetupTipStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ReceiptSetupParty"
        component={ReceiptSetupPartyStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ReviewPayment"
        component={ReviewPaymentStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ActivityDetail"
        component={ActivityDetailStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="ScanReceipt"
        component={ScanReceiptScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <MainStack.Screen
        name="FundsCollected"
        component={FundsCollectedStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="Notifications"
        component={NotificationsStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="JoinBill"
        component={JoinBillStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="Payouts"
        component={PayoutsStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="UpdatePayoutCard"
        component={UpdatePayoutCardStackScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <MainStack.Screen
        name="SetupPayouts"
        component={SetupPayoutsStackScreen}
        options={{ animation: 'slide_from_right' }}
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

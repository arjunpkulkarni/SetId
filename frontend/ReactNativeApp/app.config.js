/** @type {import('expo/config').ExpoConfig} */
module.exports = {
  expo: {
    name: 'Settld',
    slug: 'settld',
    owner: 'arjunpkulkarni',
    version: '1.0.4',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.culinAILLC.settld',
      // CFBundleVersion (Info.plist). Increase for every Store / TestFlight binary;
      // must be greater than any build already uploaded for this app.
      buildNumber: '4',
      usesAppleSignIn: true,
      infoPlist: {
        // Home Screen label / App Store listings use display name separately;
        // this stays the marketed app name on device.
        CFBundleDisplayName: 'Settld',
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      permissions: [
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-font',
      'expo-apple-authentication',
      [
        'expo-camera',
        {
          cameraPermission:
            'Allow $(PRODUCT_NAME) to use the camera to scan receipts.',
        },
      ],
      [
        '@stripe/stripe-react-native',
        {
          enableGooglePay: false,
        },
      ],
    ],
    extra: {
      eas: {
        projectId: '7156aea7-b6ad-4117-94d0-404fb6902a31',
      },
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/7156aea7-b6ad-4117-94d0-404fb6902a31',
    },
  },
};

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, radii, shadows } from '../theme';
import { receipts } from '../services/api';
import * as ImagePicker from 'expo-image-picker';

const { width: SW } = Dimensions.get('window');
const RETICLE_W = SW - 96;
const RETICLE_H = RETICLE_W * 1.15;

function ScanLine() {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: RETICLE_H - 4,
          duration: 2200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [translateY]);

  return (
    <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]}>
      <LinearGradient
        colors={['transparent', colors.secondaryContainer, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.scanLineGradient}
      />
    </Animated.View>
  );
}

function PulsingDot() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.pulsingDot, { opacity }]} />;
}

function CornerBracket({ position }) {
  const posStyles = {
    topLeft: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
    topRight: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
    bottomLeft: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
    bottomRight: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },
  };
  return <View style={[styles.cornerBracket, posStyles[position]]} />;
}

export default function ScanReceiptScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const billId = route?.params?.billId;
  const cameraRef = useRef(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const autoRequestedPermission = useRef(false);

  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [statusText, setStatusText] = useState('Line up the receipt, then tap Capture');
  const [parsedData, setParsedData] = useState(null);

  useEffect(() => {
    if (!permission || permission.granted || autoRequestedPermission.current) return;
    if (!permission.canAskAgain) return;
    autoRequestedPermission.current = true;
    requestPermission();
  }, [permission, requestPermission]);

  const processReceiptUri = useCallback(
    async (uri, mimeType = 'image/jpeg', fileName = 'receipt.jpg') => {
      let cleanupStatusTimer;

      try {
        setUploading(true);
        setStatusText('Uploading receipt…');

        const file = {
          uri,
          name: fileName,
          type: mimeType,
        };

        await receipts.upload(billId, file);
        setUploading(false);

        setParsing(true);
        setStatusText('Extracting text…');
        cleanupStatusTimer = setTimeout(() => {
          setStatusText('Cleaning receipt…');
        }, 900);

        const parseRes = await receipts.parse(billId);
        clearTimeout(cleanupStatusTimer);

        // Expand any multi-quantity lines into individual quantity=1 rows so
        // each unit can be assigned to a different member. "2 Chicken
        // Sandwich @ $20" becomes two separate "1 Chicken Sandwich @ $10"
        // rows. We distribute any cent-remainder across the first rows so
        // the sum still matches the original line total exactly.
        //
        // The parse response's items are the OCR output and do NOT carry the
        // persisted DB ids we need for `deletes`. Pull the stored rows from
        // listItems, which returns the actual receipt_item records.
        let itemsRes;
        try {
          itemsRes = await receipts.listItems(billId);
        } catch (listErr) {
          if (__DEV__) console.warn('[SCAN] listItems failed after parse', listErr);
        }
        const storedItems = Array.isArray(itemsRes?.data)
          ? itemsRes.data
          : Array.isArray(itemsRes?.data?.items)
            ? itemsRes.data.items
            : [];

        const needsExpansion = storedItems.some(
          (it) => it?.id && Math.floor(Number(it.quantity ?? 1)) > 1,
        );

        if (needsExpansion) {
          setStatusText('Splitting items by unit…');

          const deletes = [];
          const creates = [];

          for (const it of storedItems) {
            const qty = Math.max(1, Math.floor(Number(it.quantity ?? 1)));
            if (!it?.id || qty <= 1) continue;

            deletes.push(it.id);

            const totalCents = Math.round(parseFloat(it.total_price ?? 0) * 100);
            const baseCents = Math.floor(totalCents / qty);
            const remainder = totalCents - baseCents * qty;

            for (let i = 0; i < qty; i++) {
              const cents = baseCents + (i < remainder ? 1 : 0);
              creates.push({
                name: it.name,
                quantity: 1,
                total_price: (cents / 100).toFixed(2),
              });
            }
          }

          if (creates.length > 0 && deletes.length > 0) {
            try {
              const syncRes = await receipts.syncItems(billId, {
                creates,
                updates: [],
                deletes,
              });
              const syncedItems = syncRes?.data?.items ?? [];
              setParsedData({
                ...parseRes.data,
                items: syncedItems.length > 0 ? syncedItems : parseRes.data?.items,
              });
            } catch (syncErr) {
              if (__DEV__) console.warn('[SCAN] expansion sync failed', syncErr);
              setParsedData(parseRes.data);
            }
          } else {
            setParsedData(parseRes.data);
          }
        } else {
          setParsedData(parseRes.data);
        }

        setParsing(false);
        setStatusText('Receipt parsed!');

        setTimeout(() => {
          navigation.navigate('BillSplit', { billId, refresh: Date.now() });
        }, 800);
      } catch (err) {
        if (cleanupStatusTimer) clearTimeout(cleanupStatusTimer);
        setUploading(false);
        setParsing(false);
        setStatusText('Line up the receipt, then tap Capture');
        Alert.alert('Error', err?.message ?? err?.error?.message ?? 'Failed to process receipt');
      }
    },
    [billId, navigation],
  );

  const captureFromPreview = async () => {
    if (!cameraRef.current || !cameraReady) {
      Alert.alert('Camera not ready', 'Please wait a moment and try again.');
      return;
    }

    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      const ext = photo.format === 'png' ? 'png' : 'jpg';
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      await processReceiptUri(photo.uri, mime, `receipt.${ext}`);
    } catch (err) {
      Alert.alert('Capture failed', err?.message ?? 'Could not take photo');
    } finally {
      setCapturing(false);
    }
  };

  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      await processReceiptUri(
        asset.uri,
        asset.mimeType || 'image/jpeg',
        asset.fileName || 'receipt.jpg',
      );
    } catch (err) {
      Alert.alert('Error', err?.message ?? err?.error?.message ?? 'Failed to pick image');
    }
  };

  const busy = uploading || parsing || capturing;
  const canUseCamera = permission?.granted;

  return (
    <View style={styles.root}>
      {canUseCamera ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onCameraReady={() => setCameraReady(true)}
        />
      ) : (
        <View style={styles.cameraBgPlaceholder}>
          <MaterialIcons name="photo-camera" size={64} color="rgba(255,255,255,0.15)" />
          {!permission?.canAskAgain && permission && !permission.granted ? (
            <Text style={styles.permissionHint}>Camera access is off. Enable it in Settings to scan.</Text>
          ) : null}
        </View>
      )}

      {/* Top Bar */}
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <View style={styles.topBarInner}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
            style={styles.topBarBtn}
          >
            <MaterialIcons name="close" size={24} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Scan Receipt</Text>
          <View style={styles.topBarBtn} />
        </View>
      </View>

      {/* Reticle */}
      <View style={styles.reticleContainer}>
        <View style={styles.reticle}>
          <CornerBracket position="topLeft" />
          <CornerBracket position="topRight" />
          <CornerBracket position="bottomLeft" />
          <CornerBracket position="bottomRight" />
          {!parsedData && <ScanLine />}
          {parsedData && (
            <View style={styles.floatingBadgeMerchant}>
              <MaterialIcons name="check-circle" size={12} color={colors.onSecondaryContainer} />
              <Text style={styles.floatingBadgeText}>PARSED</Text>
            </View>
          )}
        </View>
      </View>

      {/* Bottom Sheet */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View>
              <Text style={styles.statusLabel}>STATUS</Text>
              <Text style={styles.statusTitle}>{statusText}</Text>
            </View>
            {/* {busy && (
              <View style={styles.aiBadge}>
                <PulsingDot />
                <Text style={styles.aiBadgeText}>AI Processing</Text>
              </View>
            )} */}
          </View>

          {parsedData && (
            <View style={styles.parsedSummary}>
              <View style={styles.parsedRow}>
                <Text style={styles.parsedLabel}>Items found</Text>
                <Text style={styles.parsedValue}>{parsedData.items?.length ?? 0}</Text>
              </View>
              <View style={styles.parsedRow}>
                <Text style={styles.parsedLabel}>Total</Text>
                <Text style={styles.parsedValueBold}>
                  ${parseFloat(parsedData.total ?? 0).toFixed(2)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {!busy && !parsedData && (
          <>
            {!canUseCamera && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => requestPermission()}
                style={styles.actionBtnPrimary}
              >
                <LinearGradient
                  colors={[colors.secondary, colors.secondaryDim]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.actionGradient}
                >
                  <MaterialIcons name="videocam" size={22} color={colors.onSecondary} />
                  <Text style={styles.actionTextPrimary}>Allow camera access</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            {canUseCamera && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={captureFromPreview}
                  disabled={!cameraReady}
                  style={[styles.actionBtnPrimary, !cameraReady && { opacity: 0.55 }]}
                >
                  <LinearGradient
                    colors={[colors.secondary, colors.secondaryDim]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.actionGradient}
                  >
                    <MaterialIcons name="camera-alt" size={22} color={colors.onSecondary} />
                    <Text style={styles.actionTextPrimary}>
                      {cameraReady ? 'Capture' : 'Starting camera…'}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={pickFromGallery}
                  style={styles.actionBtnSecondary}
                >
                  <MaterialIcons name="image" size={22} color={colors.secondary} />
                  <Text style={styles.actionTextSecondary}>Gallery</Text>
                </TouchableOpacity>
              </View>
            )}

            {!canUseCamera && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={pickFromGallery}
                style={styles.galleryOnlyBtn}
              >
                <MaterialIcons name="image" size={22} color={colors.secondary} />
                <Text style={styles.actionTextSecondary}>Choose from gallery</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {busy && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="large" color={colors.secondary} />
          </View>
        )}

        {!busy && !parsedData && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => navigation.navigate('BillSplit', { billId })}
            style={styles.skipBtn}
          >
            <Text style={styles.skipText}>Skip — add items manually</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111',
  },
  cameraBgPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 32,
  },
  permissionHint: {
    marginTop: 16,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 20,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 8,
  },
  topBarBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: -0.3,
  },

  reticleContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  reticle: {
    width: RETICLE_W,
    height: RETICLE_H,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  cornerBracket: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: colors.secondaryContainer,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    zIndex: 5,
  },
  scanLineGradient: {
    flex: 1,
  },
  floatingBadgeMerchant: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(104, 250, 221, 0.9)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
  },
  floatingBadgeText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.onSecondaryContainer,
    textTransform: 'uppercase',
  },

  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 24,
    gap: 16,
  },
  statusCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: radii.xl,
    padding: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.12, shadowRadius: 32 },
      android: { elevation: 8 },
    }),
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  statusLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.secondary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  statusTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 18,
    fontWeight: '800',
    color: colors.onSurface,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  pulsingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.secondary,
  },
  aiBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSecondaryContainer,
  },
  parsedSummary: {
    marginTop: 16,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: 14,
    gap: 8,
  },
  parsedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  parsedLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  parsedValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.onSurface,
  },
  parsedValueBold: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.secondary,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtnPrimary: {
    flex: 2,
  },
  actionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: radii.full,
    ...shadows.settleButton,
  },
  actionTextPrimary: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  actionTextSecondary: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.secondary,
  },
  galleryOnlyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
});

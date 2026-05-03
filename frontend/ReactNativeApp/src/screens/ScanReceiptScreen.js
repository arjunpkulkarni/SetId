import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Alert,
  Image,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, radii, shadows } from '../theme';
import { receipts } from '../services/api';
import * as ImagePicker from 'expo-image-picker';

// Downscale receipts to ~2000px on the long edge before upload. Keeps
// payloads under ~1MB on a full iPhone JPEG, which sidesteps any nginx
// `client_max_body_size` limit in front of the API. 2000px is still
// plenty of resolution for the OCR pipeline — the vision model
// downsamples internally anyway.
const RECEIPT_MAX_DIM = 2000;
const RECEIPT_JPEG_QUALITY = 0.82;

async function downscaleReceiptImage(uri) {
  try {
    const result = await manipulateAsync(
      uri,
      [{ resize: { width: RECEIPT_MAX_DIM } }],
      { compress: RECEIPT_JPEG_QUALITY, format: SaveFormat.JPEG },
    );
    return { uri: result.uri, mime: 'image/jpeg', ext: 'jpg' };
  } catch (err) {
    if (__DEV__) console.warn('[SCAN] image downscale failed, uploading original', err);
    return { uri, mime: 'image/jpeg', ext: 'jpg' };
  }
}

// Zoom preset values. `value` is what we pass to CameraView's `zoom`
// prop (0..1). These match roughly-familiar "nX" optical labels on
// an iPhone. The maximum digital zoom on expo-camera gets noisy fast
// so we cap at 3x (≈ 0.25) to keep OCR happy.
const ZOOM_PRESETS = [
  { label: '1x', value: 0 },
  { label: '2x', value: 0.08 },
  { label: '3x', value: 0.2 },
];

function ScanLine({ reticleHeight }) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: reticleHeight - 4,
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
  }, [translateY, reticleHeight]);

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
  const { width: windowW } = useWindowDimensions();
  const reticleW = windowW - 96;
  const reticleH = reticleW * 1.15;

  const insets = useSafeAreaInsets();
  const billId = route?.params?.billId;
  const cameraRef = useRef(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const autoRequestedPermission = useRef(false);

  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [parsedData, setParsedData] = useState(null);
  const [queuedImages, setQueuedImages] = useState([]);
  // URI of the most recently captured still. While non-null, we render this
  // frozen image in place of the live `CameraView` so the user can lower
  // their phone after tapping capture — previously the live viewfinder
  // stayed up during the 5-10s upload+parse, which felt like they had to
  // keep holding the receipt in frame.
  const [lastCaptureUri, setLastCaptureUri] = useState(null);

  // Camera zoom. expo-camera's `zoom` prop is 0..1. We keep the practical
  // range smaller (0..0.5) since higher digital-zoom values produce
  // noise that hurts OCR. Pinch-to-zoom and a tappable reset chip both
  // write to this state.
  const [zoom, setZoom] = useState(0);
  const pinchBaseZoom = useRef(0);

  // Pinch gesture → updates zoom. Runs on JS thread (no Reanimated
  // shared-values) because the CameraView's `zoom` prop is a plain
  // React prop anyway. Stutter is imperceptible at 60 fps for a simple
  // setState.
  const pinchGesture = useRef(
    Gesture.Pinch()
      .onStart(() => {
        pinchBaseZoom.current = zoom;
      })
      .onUpdate((e) => {
        // e.scale is 1 at pinch start, >1 pinching out (zoom in),
        // <1 pinching in (zoom out). Map the delta to a gentle zoom
        // adjustment — (scale-1)*0.35 feels natural on iPhone.
        const delta = (e.scale - 1) * 0.35;
        const next = Math.max(0, Math.min(0.5, pinchBaseZoom.current + delta));
        setZoom(next);
      }),
  ).current;

  // Keep the pinch base zoom in sync when zoom is reset via the chip.
  useEffect(() => {
    pinchBaseZoom.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!permission || permission.granted || autoRequestedPermission.current) return;
    if (!permission.canAskAgain) return;
    autoRequestedPermission.current = true;
    requestPermission();
  }, [permission, requestPermission]);

  const enqueueReceiptImage = useCallback((uri, mimeType = 'image/jpeg', fileName = 'receipt.jpg') => {
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const normalizedName = fileName || `receipt-page-${Date.now()}.${ext}`;
    const image = {
      uri,
      name: normalizedName,
      type: mimeType,
    };

    setQueuedImages((prev) => [...prev, image]);
  }, []);

  const processQueuedImages = useCallback(async () => {
    if (!queuedImages.length) {
      Alert.alert('No images yet', 'Capture or choose at least one receipt image first.');
      return;
    }

    try {
      setUploading(true);
      // Upload pages in order. First request replaces prior receipt; remaining requests append.
      for (let i = 0; i < queuedImages.length; i += 1) {
        const isAppend = i > 0;
        await receipts.upload(billId, queuedImages[i], { append: isAppend });
      }
      setUploading(false);

      setParsing(true);
      // Parse once after all pages are uploaded so backend can run merge/dedupe totals.
      const parseRes = await receipts.parse(billId);

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

      setTimeout(() => {
        navigation.replace('ReceiptSetupTip', { billId });
      }, 800);
    } catch (err) {
      setUploading(false);
      setParsing(false);
      // Unfreeze so the user can re-aim and retry — otherwise they'd be
      // stuck staring at a frozen image with no obvious next step.
      setLastCaptureUri(null);
      Alert.alert('Error', err?.message ?? err?.error?.message ?? 'Failed to process receipt');
    }
  }, [billId, navigation, queuedImages]);

  const captureFromPreview = async () => {
    if (!cameraRef.current || !cameraReady) {
      Alert.alert('Camera not ready', 'Please wait a moment and try again.');
      return;
    }

    // Fire a haptic + "hold steady" UI immediately so the user knows
    // the tap registered and DOESN'T move their phone during the 300-
    // 500ms shutter lag. Previously the UI only showed the frozen
    // still AFTER takePictureAsync resolved, by which point the user
    // had already moved and the captured frame was off the receipt.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1.0,
        skipProcessing: false,
        exif: false,
      });
      // Downscale before enqueueing so the upload fits under any
      // client_max_body_size proxy limit.
      const downscaled = await downscaleReceiptImage(photo.uri);
      enqueueReceiptImage(
        downscaled.uri,
        downscaled.mime,
        `receipt-${Date.now()}.${downscaled.ext}`,
      );
      // Freeze on the downscaled still so the user sees exactly what
      // will be uploaded.
      setLastCaptureUri(downscaled.uri);
      // Success haptic — tells the user "safe to lower the phone now".
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert('Capture failed', err?.message ?? 'Could not take photo');
    } finally {
      setCapturing(false);
    }
  };

  /** Drop the last queued image and unfreeze so the user can re-aim the
   *  camera. Used by the "Retake" button on the frozen view. */
  const retakeLastCapture = useCallback(() => {
    setQueuedImages((prev) => prev.slice(0, -1));
    setLastCaptureUri(null);
  }, []);

  /** Keep the captured image(s) in the queue but return to the live camera
   *  so the user can capture another receipt page. */
  const resumeCameraForNextPage = useCallback(() => {
    setLastCaptureUri(null);
  }, []);

  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1.0,
        allowsEditing: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      // Downscale the picked image for the same reason we do it on
      // capture — keeps uploads under proxy body-size limits.
      const downscaled = await downscaleReceiptImage(asset.uri);
      enqueueReceiptImage(
        downscaled.uri,
        downscaled.mime,
        asset.fileName || `receipt-${Date.now()}.${downscaled.ext}`,
      );
      setLastCaptureUri(downscaled.uri);
    } catch (err) {
      Alert.alert('Error', err?.message ?? err?.error?.message ?? 'Failed to pick image');
    }
  };

  const busy = uploading || parsing || capturing;
  const canUseCamera = permission?.granted;
  // `frozen` = we're showing a still image instead of the live camera feed.
  // Captured images live here during review + processing so the user can
  // put their phone down.
  const frozen = Boolean(lastCaptureUri);

  return (
    <View style={styles.root}>
      {frozen ? (
        // Render the captured image where the camera feed used to be. We
        // dim it slightly with the same scrim the camera view has, so the
        // bottom sheet + top bar readability is identical in both states.
        <>
          <Image
            source={{ uri: lastCaptureUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
          <View style={styles.frozenDim} pointerEvents="none" />
        </>
      ) : canUseCamera ? (
        <GestureDetector gesture={pinchGesture}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFillObject}
            facing="back"
            zoom={zoom}
            onCameraReady={() => setCameraReady(true)}
          />
        </GestureDetector>
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

      {/* Zoom presets. Tap to jump between 1x / 2x / 3x; pinch the
          camera for continuous fine-tune. Hidden on the frozen still
          and after parse since there's nothing to zoom. */}
      {canUseCamera && !frozen && !parsedData && (
        <View style={[styles.zoomPresetRow, { top: insets.top + 56 }]}>
          {ZOOM_PRESETS.map((preset) => {
            const active = Math.abs(zoom - preset.value) < 0.005;
            return (
              <TouchableOpacity
                key={preset.label}
                activeOpacity={0.85}
                onPress={() => {
                  setZoom(preset.value);
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={[styles.zoomPresetChip, active && styles.zoomPresetChipActive]}
              >
                <Text
                  style={[
                    styles.zoomPresetText,
                    active && styles.zoomPresetTextActive,
                  ]}
                >
                  {preset.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Reticle. We hide the animated scan line once a capture is frozen
          — there's nothing to "scan" anymore, the pixels are locked in.
          The corner brackets stay as a subtle frame. */}
      <View style={styles.reticleContainer}>
        <View style={[styles.reticle, { width: reticleW, height: reticleH }]}>
          <CornerBracket position="topLeft" />
          <CornerBracket position="topRight" />
          <CornerBracket position="bottomLeft" />
          <CornerBracket position="bottomRight" />
          {!parsedData && !frozen && !capturing && <ScanLine reticleHeight={reticleH} />}
          {capturing && (
            <View style={styles.holdSteadyBadge} pointerEvents="none">
              <ActivityIndicator color={colors.onSecondaryContainer} size="small" />
              <Text style={styles.holdSteadyText}>Hold steady…</Text>
            </View>
          )}
          {parsedData && (
            <View style={styles.floatingBadgeMerchant}>
              <MaterialIcons name="check-circle" size={12} color={colors.onSecondaryContainer} />
              <Text style={styles.floatingBadgeText}>PARSED</Text>
            </View>
          )}
        </View>
      </View>

      {/* Bottom Sheet — action buttons only. Status text and queued-pages
          preview are intentionally omitted; the reticle + haptics +
          frozen-image preview already tell the user what state they're
          in. Action buttons below speak for themselves. */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 24 }]}>
        {!busy && !parsedData && frozen && (
          // Frozen-image state: user has captured (or picked) at least one
          // image. Primary action is to process what they've got; secondary
          // actions let them stack another page or redo the last shot.
          <>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={processQueuedImages}
              style={styles.actionBtnFull}
            >
              <LinearGradient
                colors={[colors.secondary, colors.secondaryDim]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.actionGradient}
              >
                <Text style={styles.actionTextPrimary}>
                  {queuedImages.length > 1
                    ? `Process ${queuedImages.length} Pages`
                    : 'Process Receipt'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.actionRow}>
              {canUseCamera && (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={resumeCameraForNextPage}
                  style={styles.actionBtnSecondary}
                >
                  <MaterialIcons name="add-a-photo" size={20} color={colors.secondary} />
                  <Text style={styles.actionTextSecondary}>Add Page</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={retakeLastCapture}
                style={styles.actionBtnSecondary}
              >
                <MaterialIcons name="refresh" size={20} color={colors.secondary} />
                <Text style={styles.actionTextSecondary}>Retake</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {!busy && !parsedData && !frozen && (
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
                      {cameraReady ? 'Scan Receipt' : 'Starting camera…'}
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
  // Subtle scrim on top of the frozen still so the bottom status card +
  // top bar stay readable against bright receipts.
  frozenDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
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

  // Zoom preset pill row. Floats above the reticle on the right side
  // so it's reachable with the thumb but doesn't overlap the receipt
  // framing area.
  zoomPresetRow: {
    position: 'absolute',
    right: 16,
    zIndex: 30,
    flexDirection: 'column',
    gap: 8,
    alignItems: 'center',
  },
  zoomPresetChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  zoomPresetChipActive: {
    backgroundColor: colors.secondaryContainer,
    borderColor: colors.secondary,
  },
  zoomPresetText: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 13,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.3,
  },
  zoomPresetTextActive: {
    color: colors.onSecondaryContainer,
  },

  reticleContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  reticle: {
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
  holdSteadyBadge: {
    position: 'absolute',
    top: '42%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(104, 250, 221, 0.95)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radii.full,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  holdSteadyText: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 15,
    fontWeight: '800',
    color: colors.onSecondaryContainer,
    letterSpacing: 0.3,
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
    paddingHorizontal: 20,
    gap: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtnPrimary: {
    flex: 1,
  },
  actionBtnFull: {
    width: '100%',
  },
  actionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    minHeight: 54,
    borderRadius: radii.full,
    ...shadows.settleButton,
  },
  actionTextPrimary: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 54,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(10, 91, 73, 0.14)',
  },
  actionTextSecondary: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
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
    paddingVertical: 6,
  },
  skipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
  },
});

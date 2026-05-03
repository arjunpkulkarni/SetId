import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Animated,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';

const BRAND      = '#105D4B';
const BRAND_DARK = '#0d4a3c';
const MINT_1     = '#4FD1A7';
const MINT_2     = '#1FA87A';
const MINT_TINT  = '#E6F4F0';
const MINT_TINT_2 = '#F0F9F6';
const CTA_GRAD   = ['#4FD1A7', '#1FA87A'];

// 4 slides: 0=Intro, 1=Assign, 2=Scan, 3=Settle
const NUM_SLIDES = 4;

// ─────────────────────────────────────────────────────────────
// Floating receipt decoration
// ─────────────────────────────────────────────────────────────
function FloatingReceipt({ left, right, top, rotation, delay, width = 62, height = 88 }) {
  const floatY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(floatY, { toValue: -6, duration: 2000, useNativeDriver: true }),
          Animated.timing(floatY, { toValue: 0,  duration: 2000, useNativeDriver: true }),
        ])
      ).start();
    }, delay);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[
      styles.floatReceipt,
      { left, right, top, width, height, transform: [{ rotate: `${rotation}deg` }, { translateY: floatY }] },
    ]}>
      <View style={[styles.floatLine, { width: '70%' }]} />
      <View style={[styles.floatLine, { marginTop: 3 }]} />
      <View style={[styles.floatLine, { marginTop: 3, width: '85%' }]} />
      <View style={[styles.floatLine, { marginTop: 3 }]} />
      <View style={[styles.floatLineGreen, { marginTop: 5, width: '50%' }]} />
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// Dollar chip decoration
// ─────────────────────────────────────────────────────────────
function DollarChip({ left, top, size = 30, delay }) {
  const bobY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 180 }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(bobY, { toValue: -10, duration: 1750, useNativeDriver: true }),
          Animated.timing(bobY, { toValue: 0,   duration: 1750, useNativeDriver: true }),
        ])
      ).start();
    }, delay);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[
      styles.dollarChip,
      { left, top, width: size, height: size, borderRadius: size / 2 },
      { transform: [{ translateY: bobY }, { scale }] },
    ]}>
      <Text style={[styles.dollarChipText, { fontSize: size * 0.48 }]}>$</Text>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// (money-drop transition removed)

// ─────────────────────────────────────────────────────────────
// Slide 0 – Intro (green)
// ─────────────────────────────────────────────────────────────
function IntroSlide({ active, onGetStarted, topInset, windowWidth }) {
  const eyebrow = useRef(new Animated.Value(0)).current;
  const heading = useRef(new Animated.Value(0)).current;
  const body    = useRef(new Animated.Value(0)).current;
  const cta     = useRef(new Animated.Value(0)).current;
  const note    = useRef(new Animated.Value(0)).current;
  const logo    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      [eyebrow, heading, body, cta, note, logo].forEach(a => a.setValue(0));
      return;
    }
    Animated.stagger(120, [
      Animated.timing(logo,    { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(eyebrow, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(heading, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(body,    { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(cta,     { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(note,    { toValue: 1, duration: 700, useNativeDriver: true }),
    ]).start();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const fadeSlide = (anim, dy = 14) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }],
  });

  return (
    <LinearGradient
      colors={[BRAND_DARK, BRAND, '#0a7c63']}
      start={{ x: 0.3, y: 0 }}
      end={{ x: 0.7, y: 1 }}
      style={styles.introRoot}
    >
      {/* Ambient glows */}
      <View style={[styles.introGlow, { top: -120, right: -100, width: 320, height: 320, backgroundColor: `${MINT_1}28` }]} />
      <View style={[styles.introGlow, { bottom: -80, left: -60, width: 260, height: 260, backgroundColor: `${MINT_2}33` }]} />

      {/* Floating receipts */}
      <FloatingReceipt left={38}  top={topInset + 100} rotation={-14} delay={0}   width={62} height={88} />
      <FloatingReceipt right={44} top={topInset + 130} rotation={18}  delay={180} width={54} height={76} />
      <FloatingReceipt left={70}  top={topInset + 260} rotation={8}   delay={320} width={50} height={70} />

      {/* Dollar chips */}
      <DollarChip left={windowWidth * 0.72} top={topInset + 170} size={30} delay={240} />
      <DollarChip left={50}        top={topInset + 370} size={26} delay={360} />

      {/* Logo row at top */}
      <Animated.View style={[styles.introLogoRow, { top: topInset + 52 }, fadeSlide(logo, -10)]}>
        <View style={styles.introLogoShell}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.introLogo}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.introWordmark}>Settld.</Text>
      </Animated.View>

      {/* Hero block pinned to bottom */}
      <View style={styles.introHero}>
        <Animated.Text style={[styles.introEyebrow, fadeSlide(eyebrow)]}>
          The end of awkward math
        </Animated.Text>

        <Animated.Text style={[styles.introHeading, fadeSlide(heading, 16)]}>
          Split the bill,{'\n'}not your friendships.
        </Animated.Text>

        <Animated.Text style={[styles.introBody, fadeSlide(body, 16)]}>
          Scan a receipt. Tap who had what. Get paid — instantly.
        </Animated.Text>

        <Animated.View style={fadeSlide(cta, 20)}>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={onGetStarted}
            style={styles.introCtaTouch}
          >
            <View style={styles.introCtaBtn}>
              <Text style={styles.introCtaText}>See how it works</Text>
              <MaterialIcons name="arrow-forward" size={18} color={BRAND} />
            </View>
          </TouchableOpacity>
        </Animated.View>

        <Animated.Text style={[styles.introNote, fadeSlide(note, 16)]}>
          Free to start · No fees · 60-second setup
        </Animated.Text>
      </View>
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────
// Slide 1 – Assign (Tap to assign / Math does itself)
// ─────────────────────────────────────────────────────────────
const PEOPLE = [
  { id: 'M', name: 'Maya',   color: '#1FA87A' },
  { id: 'J', name: 'Jordan', color: '#E8A443' },
  { id: 'L', name: 'Liam',   color: '#5B8DEF' },
];
const ASSIGN_ITEMS = [
  { name: 'Truffle Pasta',  price: 28, assign: 'M',   revealStep: 1 },
  { name: 'Ribeye Steak',   price: 54, assign: 'J',   revealStep: 2 },
  { name: 'House Wine ×2',  price: 32, assign: 'ALL', revealStep: 3 },
];

function AssignSlide({ active, illusHeight }) {
  const [step, setStep] = useState(0);
  const chipScales = useRef(ASSIGN_ITEMS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!active) {
      setStep(0);
      chipScales.forEach(s => s.setValue(0));
      return;
    }
    let cancelled = false;
    const allTimers = [];
    function schedule(delay, fn) {
      const t = setTimeout(() => { if (!cancelled) fn(); }, delay);
      allTimers.push(t);
    }
    function runCycle(base = 0) {
      setStep(0);
      chipScales.forEach(s => s.setValue(0));
      schedule(base + 600, () => {
        setStep(1);
        Animated.spring(chipScales[0], { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 200 }).start();
      });
      schedule(base + 1200, () => {
        setStep(2);
        Animated.spring(chipScales[1], { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 200 }).start();
      });
      schedule(base + 1900, () => {
        setStep(3);
        Animated.spring(chipScales[2], { toValue: 1, useNativeDriver: true, damping: 8, stiffness: 200 }).start();
      });
      schedule(base + 2700, () => setStep(4));
      schedule(base + 4400, () => runCycle());
    }
    runCycle();
    return () => { cancelled = true; allTimers.forEach(clearTimeout); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const getTotals = () => {
    const t = { M: 0, J: 0, L: 0 };
    ASSIGN_ITEMS.forEach(it => {
      if (step > it.revealStep) {
        if (it.assign === 'ALL') { t.M += it.price / 3; t.J += it.price / 3; t.L += it.price / 3; }
        else t[it.assign] += it.price;
      }
    });
    if (step >= 4) { t.M += 12.33; t.J += 10; t.L += 11.67; }
    return t;
  };
  const totals = getTotals();

  return (
    <View style={styles.slideContent}>
      <View style={[styles.illustrationBox, { height: illusHeight }]}>
        <LinearGradient colors={['#FFFFFF', MINT_TINT]} start={{ x: 0.5, y: 1 }} end={{ x: 0.5, y: 0 }} style={StyleSheet.absoluteFill} />
        <View style={styles.avatarRow}>
          {PEOPLE.map(p => {
            const isActive = (p.id === 'M' && step >= 1) || (p.id === 'J' && step >= 2) || (p.id === 'L' && step >= 3);
            return (
              <View key={p.id} style={styles.avatarCol}>
                <View style={[styles.avatar, { backgroundColor: p.color }, isActive && { shadowColor: p.color, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 }]}>
                  <Text style={styles.avatarText}>{p.id}</Text>
                </View>
                <Text style={styles.avatarAmt}>${totals[p.id].toFixed(2)}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.assignCards}>
          {ASSIGN_ITEMS.map((item, i) => {
            const assigned = step > item.revealStep;
            const person = PEOPLE.find(p => p.id === item.assign);
            return (
              <View key={i} style={[styles.assignCard, assigned && { borderColor: MINT_TINT }]}>
                <View style={styles.assignCardLeft}>
                  <Text style={styles.assignCardName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.assignCardPrice}>${item.price}.00</Text>
                </View>
                {assigned ? (
                  item.assign === 'ALL' ? (
                    <View style={styles.chipCluster}>
                      {PEOPLE.map((p, j) => (
                        <Animated.View key={p.id} style={[styles.chipAvatar, { backgroundColor: p.color, marginLeft: j === 0 ? 0 : -8, zIndex: PEOPLE.length - j }, { transform: [{ scale: chipScales[i] }] }]}>
                          <Text style={styles.chipAvatarText}>{p.id}</Text>
                        </Animated.View>
                      ))}
                    </View>
                  ) : (
                    <Animated.View style={[styles.chipAvatarSingle, { backgroundColor: person.color, transform: [{ scale: chipScales[i] }] }]}>
                      <Text style={styles.chipAvatarText}>{item.assign}</Text>
                    </Animated.View>
                  )
                ) : (
                  <View style={styles.unassignedChip}><Text style={styles.unassignedText}>Assign</Text></View>
                )}
              </View>
            );
          })}
        </View>
        <View style={[styles.totalBar, step >= 4 && { borderColor: MINT_2 }]}>
          <Text style={styles.totalBarLeft}>Split of <Text style={{ fontFamily: 'Manrope_700Bold', color: '#111827' }}>$151.00</Text></Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {step >= 4 && <MaterialIcons name="check-circle" size={14} color={MINT_2} />}
            <Text style={[styles.totalBarStatus, step >= 4 && { color: BRAND }]}>{step >= 4 ? 'Balanced' : 'Pending'}</Text>
          </View>
        </View>
      </View>
      <View style={styles.copyArea}>
        <Text style={styles.slideTitle}>Tap to assign. <Text style={styles.slideTitleAccent}>Math does itself.</Text></Text>
        <Text style={styles.slideSubtitle}>Drop items onto your friends, or share them evenly. Tax and tip are split proportionally — down to the cent.</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Slide 2 – Scan
// ─────────────────────────────────────────────────────────────
const RECEIPT_ITEMS = [
  { name: 'Truffle Pasta',  price: '$28.00' },
  { name: 'Burrata Salad',  price: '$16.00' },
  { name: 'Ribeye Steak',   price: '$54.00' },
  { name: 'House Wine ×2',  price: '$32.00' },
  { name: 'Tiramisu',       price: '$12.00' },
  { name: 'Espresso ×3',    price: '$9.00'  },
];
const REVEAL_FRACS = [0.15, 0.28, 0.42, 0.55, 0.68, 0.82];
const SCAN_PERIOD  = 2400;

function ScanSlide({ active, illusHeight }) {
  const scanAnim     = useRef(new Animated.Value(0)).current;
  const itemOpacities = useRef(RECEIPT_ITEMS.map(() => new Animated.Value(0.15))).current;
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    if (!active) {
      scanAnim.stopAnimation(); scanAnim.setValue(0);
      itemOpacities.forEach(op => op.setValue(0.15));
      setRevealedCount(0);
      return;
    }
    let cancelled = false;
    const allTimers = [];
    function cycle() {
      if (cancelled) return;
      scanAnim.setValue(0);
      itemOpacities.forEach(op => op.setValue(0.15));
      setRevealedCount(0);
      Animated.timing(scanAnim, { toValue: 1, duration: SCAN_PERIOD, useNativeDriver: true }).start(({ finished }) => {
        if (finished && !cancelled) { const t = setTimeout(cycle, 200); allTimers.push(t); }
      });
      REVEAL_FRACS.forEach((frac, i) => {
        const t = setTimeout(() => {
          if (cancelled) return;
          Animated.timing(itemOpacities[i], { toValue: 1, duration: 250, useNativeDriver: true }).start();
          setRevealedCount(c => c + 1);
        }, frac * SCAN_PERIOD);
        allTimers.push(t);
      });
    }
    cycle();
    return () => { cancelled = true; allTimers.forEach(clearTimeout); scanAnim.stopAnimation(); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const scanTranslate = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [20, illusHeight - 40] });

  return (
    <View style={styles.slideContent}>
      <View style={[styles.illustrationBox, { height: illusHeight }]}>
        <LinearGradient colors={[MINT_TINT, '#FFFFFF']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[styles.vfCorner, { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 9 }]} />
        <View style={[styles.vfCorner, { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 9 }]} />
        <View style={[styles.vfCorner, { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 9 }]} />
        <View style={[styles.vfCorner, { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 9 }]} />
        <View style={styles.receiptCard}>
          <Text style={styles.receiptRestaurant}>OSTERIA LUCE</Text>
          <Text style={styles.receiptDate}>Apr 18 · Table 7</Text>
          <View style={styles.receiptDivider} />
          {RECEIPT_ITEMS.map((item, i) => (
            <Animated.View key={i} style={[styles.receiptRow, { opacity: itemOpacities[i] }]}>
              <Text style={styles.receiptItemName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.receiptItemPrice}>{item.price}</Text>
            </Animated.View>
          ))}
          <View style={styles.receiptDivider} />
          <View style={styles.receiptTotalRow}>
            <Text style={styles.receiptTotalLabel}>TOTAL</Text>
            <Text style={styles.receiptTotalAmt}>$151.00</Text>
          </View>
        </View>
        <Animated.View pointerEvents="none" style={[styles.scanLine, { transform: [{ translateY: scanTranslate }] }]} />
        <Animated.View pointerEvents="none" style={[styles.scanGlow, { transform: [{ translateY: scanTranslate }] }]} />
        <View style={styles.statusChip}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Scanning · {revealedCount} of 6 items</Text>
        </View>
      </View>
      <View style={styles.copyArea}>
        <Text style={styles.slideTitle}>Snap it. <Text style={styles.slideTitleAccent}>We'll read the fine print.</Text></Text>
        <Text style={styles.slideSubtitle}>Point your camera at any receipt. Settld pulls every item, tax, and tip in seconds — no typing.</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Slide 3 – Settle
// ─────────────────────────────────────────────────────────────
const PAYERS = [
  { id: 'M', name: 'Maya',   amount: 52.33, color: '#1FA87A', method: 'Apple Pay' },
  { id: 'J', name: 'Jordan', amount: 64.00, color: '#E8A443', method: '•• 4242'   },
  { id: 'L', name: 'Liam',   amount: 34.67, color: '#5B8DEF', method: 'Venmo'     },
];

function SettleSlide({ active, illusHeight }) {
  const [step, setStep] = useState(0);
  const progressAnim     = useRef(new Animated.Value(0)).current;
  const celebrateOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) { setStep(0); progressAnim.setValue(0); celebrateOpacity.setValue(0); return; }
    let cancelled = false;
    const allTimers = [];
    function schedule(delay, fn) { const t = setTimeout(() => { if (!cancelled) fn(); }, delay); allTimers.push(t); }
    function runCycle(base = 0) {
      setStep(0); progressAnim.setValue(0); celebrateOpacity.setValue(0);
      schedule(base + 700,  () => { setStep(1); Animated.timing(progressAnim, { toValue: 1/3, duration: 400, useNativeDriver: false }).start(); });
      schedule(base + 1400, () => { setStep(2); Animated.timing(progressAnim, { toValue: 2/3, duration: 400, useNativeDriver: false }).start(); });
      schedule(base + 2100, () => { setStep(3); Animated.timing(progressAnim, { toValue: 1,   duration: 400, useNativeDriver: false }).start(); });
      schedule(base + 2700, () => { setStep(4); Animated.timing(celebrateOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start(); });
      schedule(base + 4500, () => runCycle());
    }
    runCycle();
    return () => { cancelled = true; allTimers.forEach(clearTimeout); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const progressWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const paidCount = Math.min(step, 3);

  return (
    <View style={styles.slideContent}>
      <View style={[styles.illustrationBox, { height: illusHeight }]}>
        {step < 4 ? (
          <>
            <LinearGradient colors={[MINT_TINT, '#FFFFFF']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={styles.settleHeader}>
              <View>
                <Text style={styles.settleCollecting}>Collecting</Text>
                <Text style={styles.settleAmount}>${(151 - paidCount * 50.33).toFixed(2)}</Text>
              </View>
              <View style={styles.settlePaidChip}>
                <View style={styles.settlePaidDot} />
                <Text style={styles.settlePaidText}>{paidCount}/3 paid</Text>
              </View>
            </View>
            <View style={styles.progressBg}>
              <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <View style={styles.payerList}>
              {PAYERS.map((p, i) => {
                const paid = step > i;
                return (
                  <View key={p.id} style={[styles.payerRow, paid && { borderColor: MINT_TINT }]}>
                    <View style={[styles.payerAvatar, { backgroundColor: p.color }]}>
                      <Text style={styles.payerAvatarText}>{p.id}</Text>
                      {paid && <View style={styles.paidBadge}><MaterialIcons name="check" size={8} color="#fff" /></View>}
                    </View>
                    <View style={styles.payerInfo}>
                      <Text style={styles.payerName}>{p.name}</Text>
                      <Text style={styles.payerMethod}>{p.method}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.payerAmount, paid && { color: BRAND, textDecorationLine: 'line-through' }]}>${p.amount.toFixed(2)}</Text>
                      {paid && <View style={styles.paidLabel}><Text style={styles.paidLabelText}>PAID</Text></View>}
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: celebrateOpacity }]}>
            <LinearGradient colors={[MINT_1, MINT_2, BRAND]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, styles.celebrateInner]}>
              <View style={styles.celebrateCheck}><MaterialIcons name="check" size={44} color="#fff" /></View>
              <Text style={styles.celebrateTitle}>All settled.</Text>
              <Text style={styles.celebrateSub}>$151.00 collected in 14 seconds</Text>
            </LinearGradient>
          </Animated.View>
        )}
      </View>
      <View style={styles.copyArea}>
        <Text style={styles.slideTitle}>One tap. <Text style={styles.slideTitleAccent}>Everyone settled.</Text></Text>
        <Text style={styles.slideSubtitle}>Friends pay their share straight to you — Apple Pay, card, or bank. No chasing, no IOUs.</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Landing Screen
// ─────────────────────────────────────────────────────────────
export default function LandingScreen({ navigation }) {
  const { width: SW, height: SH } = useWindowDimensions();
  const illusH = Math.min(280, SH * 0.38);
  const swRef = useRef(SW);
  swRef.current = SW;

  const insets = useSafeAreaInsets();
  const [currentSlide, setCurrentSlide] = useState(0);
  const currentSlideRef = useRef(0);
  const slideAnim       = useRef(new Animated.Value(0)).current;
  const goToRef         = useRef(null);
  const navLock         = useRef(false);

  const isIntro = currentSlide === 0;

  const navigateOnce = useCallback((routeName) => {
    if (navLock.current) return;
    navLock.current = true;
    navigation.navigate(routeName);
    setTimeout(() => { navLock.current = false; }, 600);
  }, [navigation]);

  const goTo = useCallback((index) => {
    const sw = swRef.current;
    const clamped = Math.max(0, Math.min(NUM_SLIDES - 1, index));
    currentSlideRef.current = clamped;
    setCurrentSlide(clamped);
    Animated.spring(slideAnim, {
      toValue: -clamped * sw,
      useNativeDriver: true,
      damping: 22,
      stiffness: 200,
    }).start();
  }, [slideAnim]);
  goToRef.current = goTo;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && Math.abs(gs.dx) > 10,
      onPanResponderMove: (_, gs) => {
        const base = -currentSlideRef.current * swRef.current;
        slideAnim.setValue(base + gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        const cur = currentSlideRef.current;
        if (Math.abs(gs.dx) > 60) {
          goToRef.current(gs.dx < 0 ? Math.min(cur + 1, NUM_SLIDES - 1) : Math.max(cur - 1, 0));
        } else {
          goToRef.current(cur);
        }
      },
    })
  ).current;

  const handleHowItWorks = () => goTo(1);

  const handleNext = () => {
    if (currentSlide < NUM_SLIDES - 1) goTo(currentSlide + 1);
    else navigateOnce('AuthChoice');
  };

  // Dots and labels are for feature slides (1-3)
  const featureIndex = currentSlide - 1; // 0,1,2
  const slideLabels  = ['Next', 'Next', 'Get started'];

  return (
    <View style={[styles.root, { paddingTop: isIntro ? 0 : insets.top }]}>
      <StatusBar style={isIntro ? 'light' : 'dark'} />

      {/* Header – hidden on intro */}
      {!isIntro && (
        <View style={styles.carouselHeader}>
          <View style={styles.headerLogoShell}>
            <Image source={require('../../assets/logo.png')} style={styles.headerLogo} resizeMode="contain" />
          </View>
          <Text style={styles.headerWordmark}>Settld.</Text>
        </View>
      )}

      {/* Slide strip */}
      <View style={styles.stripClip} {...panResponder.panHandlers}>
        <Animated.View style={[styles.slideStrip, { width: NUM_SLIDES * SW }, { transform: [{ translateX: slideAnim }] }]}>
          <View style={[styles.slidePane, { width: SW }]}>
            <IntroSlide
              active={currentSlide === 0}
              onGetStarted={handleHowItWorks}
              topInset={insets.top}
              windowWidth={SW}
            />
          </View>
          <View style={[styles.slidePane, { width: SW }]}><AssignSlide active={currentSlide === 1} illusHeight={illusH} /></View>
          <View style={[styles.slidePane, { width: SW }]}><ScanSlide   active={currentSlide === 2} illusHeight={illusH} /></View>
          <View style={[styles.slidePane, { width: SW }]}><SettleSlide active={currentSlide === 3} illusHeight={illusH} /></View>
        </Animated.View>
      </View>

      {/* Footer – hidden on intro */}
      {!isIntro && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.dotsRow}>
            {[0, 1, 2].map(i => (
              <TouchableOpacity key={i} onPress={() => goTo(i + 1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <View style={[styles.dot, i === featureIndex && styles.dotActive]} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity activeOpacity={0.88} onPress={handleNext}>
            <LinearGradient colors={CTA_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ctaBtn}>
              <Text style={styles.ctaText}>{slideLabels[featureIndex] ?? 'Next'}</Text>
              <MaterialIcons name="arrow-forward" size={20} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
          <Text style={styles.footerNote}>
            Already have an account?{'  '}
            <Text style={styles.footerNoteAccent} onPress={() => navigateOnce('Login')}>Sign in</Text>
          </Text>
        </View>
      )}

    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  // ── Intro screen
  introRoot: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  introGlow: {
    position: 'absolute',
    borderRadius: 999,
  },
  introLogoRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  introLogoShell: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  introLogo: {
    width: 20,
    height: 20,
    tintColor: '#FFFFFF',
  },
  introWordmark: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  introHero: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 32,
    paddingBottom: 36,
  },
  introEyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: MINT_1,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  introHeading: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1.8,
    color: '#FFFFFF',
    marginBottom: 18,
  },
  introBody: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 25,
    color: 'rgba(255,255,255,0.82)',
    marginBottom: 32,
  },
  introCtaTouch: {
    marginBottom: 16,
  },
  introCtaBtn: {
    height: 60,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    elevation: 8,
  },
  introCtaText: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 17,
    color: BRAND,
    letterSpacing: 0.2,
  },
  introNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },

  // ── Floating receipt
  floatReceipt: {
    position: 'absolute',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 6,
  },
  floatLine: {
    height: 3,
    backgroundColor: '#E5E7EB',
    borderRadius: 1,
    marginTop: 2,
  },
  floatLineGreen: {
    height: 2,
    backgroundColor: MINT_2,
    borderRadius: 1,
  },

  // ── Dollar chip
  dollarChip: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5A623',
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 5,
  },
  dollarChipText: {
    fontFamily: 'Manrope_800ExtraBold',
    color: '#5a3a00',
  },

  // ── Money drop transition
  transitionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  flashLine: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 2,
    marginTop: -1,
    backgroundColor: MINT_1,
    shadowColor: MINT_1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  fallingBill: {
    position: 'absolute',
    width: 44,
    height: 56,
    borderRadius: 6,
    backgroundColor: MINT_2,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    padding: 4,
  },
  fallingBillInner: {
    flex: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallingBillText: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 18,
    color: '#FFFFFF',
  },

  // ── Carousel
  carouselHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  headerLogoShell: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: MINT_TINT_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogo: {
    width: 20,
    height: 20,
  },
  headerWordmark: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 18,
    color: BRAND,
    letterSpacing: -0.5,
  },
  stripClip: {
    flex: 1,
    overflow: 'hidden',
  },
  slideStrip: {
    flexDirection: 'row',
    flex: 1,
  },
  slidePane: {
    alignSelf: 'stretch',
  },
  slideContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // ── Illustration
  illustrationBox: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#EAEFED',
    overflow: 'hidden',
    position: 'relative',
  },

  // ── Copy
  copyArea: {
    paddingTop: 28,
    paddingHorizontal: 4,
    flex: 1,
  },
  slideTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    lineHeight: 34,
    color: '#111827',
    letterSpacing: -0.6,
    marginBottom: 10,
  },
  slideTitleAccent: { color: BRAND },
  slideSubtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 23,
    color: '#6B7280',
  },

  // ── Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 14,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#D9E5E0',
  },
  dotActive: {
    width: 24,
    backgroundColor: BRAND,
  },
  ctaBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: MINT_2,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 5,
  },
  ctaText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  footerNote: {
    textAlign: 'center',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#6B7280',
  },
  footerNoteAccent: {
    color: BRAND,
    fontFamily: 'Inter_700Bold',
  },

  // ── Assign slide
  avatarRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingTop: 14, paddingBottom: 12 },
  avatarCol:  { alignItems: 'center', gap: 4 },
  avatar:     { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  avatarText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 16, color: '#fff' },
  avatarAmt:  { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#374151' },
  assignCards:     { paddingHorizontal: 12, gap: 8 },
  assignCard:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: '#EEF2F0', shadowColor: BRAND, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 },
  assignCardLeft:  { flex: 1, marginRight: 10 },
  assignCardName:  { fontFamily: 'Manrope_700Bold', fontSize: 13, color: '#111827', marginBottom: 2 },
  assignCardPrice: { fontFamily: 'Inter_500Medium', fontSize: 11, color: '#6B7280' },
  chipCluster:     { flexDirection: 'row' },
  chipAvatar:      { width: 26, height: 26, borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  chipAvatarSingle:{ width: 28, height: 28, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  chipAvatarText:  { fontFamily: 'Manrope_800ExtraBold', fontSize: 11, color: '#fff' },
  unassignedChip:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBD5D0' },
  unassignedText:  { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#94A3A0' },
  totalBar:        { position: 'absolute', bottom: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#EEF2F0', shadowColor: BRAND, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2 },
  totalBarLeft:    { fontFamily: 'Inter_500Medium', fontSize: 12, color: '#6B7280' },
  totalBarStatus:  { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: '#9CA3AF' },

  // ── Scan slide
  vfCorner:         { position: 'absolute', width: 26, height: 26, borderColor: BRAND, borderStyle: 'solid' },
  receiptCard:      { position: 'absolute', left: 36, right: 36, top: 28, bottom: 48, backgroundColor: '#fff', borderRadius: 6, padding: 14, shadowColor: BRAND, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 4, transform: [{ rotate: '-1.5deg' }] },
  receiptRestaurant:{ fontFamily: 'Inter_700Bold', fontSize: 9, color: '#374151', letterSpacing: 2, textAlign: 'center', marginBottom: 2 },
  receiptDate:      { fontFamily: 'Inter_400Regular', fontSize: 7.5, color: '#9CA3AF', textAlign: 'center', marginBottom: 6 },
  receiptDivider:   { height: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB', marginBottom: 6 },
  receiptRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  receiptItemName:  { fontFamily: 'Inter_400Regular', fontSize: 9, color: '#1F2937', flex: 1, marginRight: 4 },
  receiptItemPrice: { fontFamily: 'Inter_700Bold', fontSize: 9, color: '#1F2937' },
  receiptTotalRow:  { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  receiptTotalLabel:{ fontFamily: 'Inter_700Bold', fontSize: 9.5, color: BRAND },
  receiptTotalAmt:  { fontFamily: 'Inter_700Bold', fontSize: 9.5, color: BRAND },
  scanLine:         { position: 'absolute', left: 36, right: 36, top: 0, height: 2, backgroundColor: MINT_2, shadowColor: MINT_2, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 6, zIndex: 3 },
  scanGlow:         { position: 'absolute', left: 36, right: 36, top: -38, height: 40, backgroundColor: `${MINT_2}22`, zIndex: 2 },
  statusChip:       { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.95)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3, zIndex: 4 },
  statusDot:        { width: 8, height: 8, borderRadius: 999, backgroundColor: MINT_2 },
  statusText:       { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: BRAND },

  // ── Settle slide
  settleHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  settleCollecting:{ fontFamily: 'Inter_500Medium', fontSize: 12, color: '#6B7280' },
  settleAmount:    { fontFamily: 'Manrope_800ExtraBold', fontSize: 22, color: '#111827', letterSpacing: -0.5 },
  settlePaidChip:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: MINT_TINT, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  settlePaidDot:   { width: 6, height: 6, borderRadius: 999, backgroundColor: MINT_2 },
  settlePaidText:  { fontFamily: 'Inter_700Bold', fontSize: 12, color: BRAND },
  progressBg:      { height: 6, marginHorizontal: 16, borderRadius: 999, backgroundColor: '#EEF2F0', overflow: 'hidden', marginBottom: 12 },
  progressFill:    { height: '100%', borderRadius: 999, backgroundColor: MINT_2 },
  payerList:       { paddingHorizontal: 12, gap: 8 },
  payerRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#EEF2F0', shadowColor: BRAND, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  payerAvatar:     { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' },
  payerAvatarText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 14, color: '#fff' },
  paidBadge:       { position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: 999, backgroundColor: MINT_2, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  payerInfo:       { flex: 1, minWidth: 0 },
  payerName:       { fontFamily: 'Manrope_700Bold', fontSize: 13, color: '#111827' },
  payerMethod:     { fontFamily: 'Inter_500Medium', fontSize: 11, color: '#6B7280' },
  payerAmount:     { fontFamily: 'Manrope_800ExtraBold', fontSize: 13, color: '#111827' },
  paidLabel:       { backgroundColor: MINT_2, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  paidLabelText:   { fontFamily: 'Inter_700Bold', fontSize: 9, color: '#fff', letterSpacing: 0.4 },
  celebrateInner:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  celebrateCheck:  { width: 88, height: 88, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  celebrateTitle:  { fontFamily: 'Manrope_800ExtraBold', fontSize: 26, color: '#fff', letterSpacing: -0.4 },
  celebrateSub:    { fontFamily: 'Inter_500Medium', fontSize: 14, color: 'rgba(255,255,255,0.9)' },
});

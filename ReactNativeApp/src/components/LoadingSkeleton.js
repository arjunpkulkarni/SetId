import React from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { colors, radii } from '../theme';

const LoadingSkeleton = ({ width, height, borderRadius = radii.sm }) => {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animate = () => {
      animatedValue.setValue(0);
      Animated.timing(animatedValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.ease,
        useNativeDriver: false,
      }).start(() => animate());
    };
    animate();
  }, [animatedValue]);

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [colors.surfaceContainer, colors.surfaceContainerHigh, colors.surfaceContainer],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          backgroundColor,
        },
      ]}
    />
  );
};

export const DashboardSkeleton = () => (
  <View style={styles.dashboardContainer}>
    {/* Balance Hero Skeleton */}
    <View style={styles.balanceSection}>
      <LoadingSkeleton width={120} height={16} />
      <View style={styles.spacer} />
      <LoadingSkeleton width={200} height={48} />
      <View style={styles.spacer} />
      <LoadingSkeleton width={180} height={24} borderRadius={radii.full} />
    </View>

    {/* Active Bills Skeleton */}
    <View style={styles.section}>
      <LoadingSkeleton width={120} height={20} />
      <View style={styles.spacer} />
      <View style={styles.billCard}>
        <View style={styles.billCardHeader}>
          <LoadingSkeleton width={48} height={48} borderRadius={16} />
          <LoadingSkeleton width={80} height={16} />
        </View>
        <LoadingSkeleton width={180} height={24} />
        <View style={styles.spacer} />
        <LoadingSkeleton width={140} height={16} />
        <View style={styles.spacer} />
        <View style={styles.billCardFooter}>
          <View style={styles.avatarGroup}>
            <LoadingSkeleton width={32} height={32} borderRadius={16} />
            <LoadingSkeleton width={32} height={32} borderRadius={16} />
            <LoadingSkeleton width={32} height={32} borderRadius={16} />
          </View>
          <LoadingSkeleton width={80} height={32} borderRadius={radii.full} />
        </View>
      </View>
    </View>
  </View>
);

const styles = StyleSheet.create({
  skeleton: {
    opacity: 0.7,
  },
  dashboardContainer: {
    padding: 24,
  },
  balanceSection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  section: {
    marginTop: 32,
  },
  spacer: {
    height: 12,
  },
  billCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 24,
  },
  billCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  billCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  avatarGroup: {
    flexDirection: 'row',
    gap: -8,
  },
});

export default LoadingSkeleton;
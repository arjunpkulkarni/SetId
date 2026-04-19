import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii, shadows } from '../../theme';

export function EmptyItems({ onScanReceipt, billId }) {
  return (
    <View style={styles.emptySection}>
      <View style={styles.emptyIconCircle}>
        <MaterialIcons name="receipt-long" size={36} color={colors.outlineVariant} />
      </View>
      <Text style={styles.emptyTitle}>No items yet</Text>
      <Text style={styles.emptySubtext}>Scan a receipt to automatically add items</Text>
      <TouchableOpacity activeOpacity={0.85} onPress={onScanReceipt}>
        <LinearGradient
          colors={[colors.secondary, colors.secondaryDim]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.scanButton, shadows.settleButton]}
        >
          <MaterialIcons name="document-scanner" size={20} color={colors.onSecondary} />
          <Text style={styles.scanButtonText}>Scan Receipt</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  emptySection: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
  },
  emptySubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: radii.full,
    marginTop: 8,
  },
  scanButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});
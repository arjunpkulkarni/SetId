import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii, shadows } from '../../theme';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export function BottomActions({ insets, items, assignmentMap, serverAssignments, onSend, isHost }) {
  const totalLines = items.length;
  const assignedLines = items.filter((i) => (assignmentMap[i.id] || []).length > 0).length;

  const subtotal = serverAssignments.reduce(
    (s, a) => s + parsePriceValue(a.amount_owed), 0,
  );

  return (
    <View style={[styles.bottomActions, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <View style={styles.subtotalRow}>
        <Text style={styles.assignedCount}>
          {assignedLines} of {totalLines} items assigned
        </Text>
        <Text style={styles.subtotalText}>Subtotal: {formatCurrency(subtotal)}</Text>
      </View>
      <TouchableOpacity activeOpacity={0.85} onPress={onSend}>
        <LinearGradient
          colors={[colors.secondary, colors.secondaryDim]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.sendButton, shadows.sendButton]}
        >
          <Text style={styles.sendButtonText}>
            {isHost ? 'Next' : 'Submit My Items'}
          </Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(255, 255, 255, 0.95)' },
    }),
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
    gap: 12,
  },
  assignedCount: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
  },
  subtotalText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  sendButton: {
    paddingVertical: 18,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});
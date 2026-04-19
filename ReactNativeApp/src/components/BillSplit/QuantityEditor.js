import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii } from '../../theme';

export function QuantityEditor({ quantity, onDecrement, onIncrement }) {
  return (
    <View style={styles.quantityEditor}>
      <TouchableOpacity
        onPress={onDecrement}
        activeOpacity={0.8}
        style={[styles.quantityAction, quantity === 0 && styles.quantityActionDisabled]}
      >
        <MaterialIcons
          name="remove"
          size={16}
          color={quantity === 0 ? colors.outlineVariant : colors.secondary}
        />
      </TouchableOpacity>
      <Text style={styles.quantityValue}>{quantity}</Text>
      <TouchableOpacity
        onPress={onIncrement}
        activeOpacity={0.8}
        style={styles.quantityAction}
      >
        <MaterialIcons name="add" size={16} color={colors.secondary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  quantityEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondaryContainer,
    borderRadius: radii.full,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
  },
  quantityAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityActionDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  quantityValue: {
    minWidth: 24,
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.secondary,
  },
});
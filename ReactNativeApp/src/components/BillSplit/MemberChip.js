import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';

export function MemberChip({ member, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
        {member.nickname}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radii.full,
  },
  chipActive: { 
    backgroundColor: colors.secondary 
  },
  chipInactive: { 
    backgroundColor: colors.surfaceContainerHigh 
  },
  chipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: { 
    color: colors.onSecondary 
  },
  chipTextInactive: { 
    color: colors.onSurfaceVariant 
  },
});
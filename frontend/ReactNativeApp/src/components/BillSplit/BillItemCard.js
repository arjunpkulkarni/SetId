import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii } from '../../theme';
import { equalSplitAmountFromServer } from './memberMoneyBreakdown';
import { MemberChip } from './MemberChip';
import { QuantityEditor } from './QuantityEditor';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export function BillItemCard({
  item,
  members,
  assignedMemberIds,
  onToggleMember,
  isEditingItems,
  quantity,
  name,
  onNameChange,
  price,
  onPriceChange,
  onDecrementQuantity,
  onIncrementQuantity,
  onRemoveItem,
  serverAssignments,
}) {
  const isUnassigned = assignedMemberIds.length === 0;
  const isZeroQuantity = isEditingItems && quantity === 0;
  const totalPrice = parsePriceValue(price ?? item.total_price);
  const isShared = assignedMemberIds.length > 1;
  const serverEqualShare =
    !isEditingItems && isShared
      ? equalSplitAmountFromServer(item.id, assignedMemberIds, serverAssignments ?? [])
      : null;
  const perPersonPrice = isShared
    ? (serverEqualShare != null ? serverEqualShare : totalPrice / assignedMemberIds.length)
    : totalPrice;

  return (
    <View
      style={[
        styles.itemCard,
        isUnassigned ? styles.itemCardUnassigned : styles.itemCardNormal,
        isZeroQuantity && styles.itemCardZeroQuantity,
      ]}
    >
      <View style={styles.itemCardHeader}>
        <View style={styles.itemCardInfo}>
          {isEditingItems ? (
            <TextInput
              value={name}
              onChangeText={onNameChange}
              style={styles.itemNameInput}
              placeholder="Item name"
              placeholderTextColor={colors.outlineVariant}
            />
          ) : (
            <Text style={styles.itemName}>{name}</Text>
          )}
          {isUnassigned ? (
            <Text style={styles.itemPriceUnassigned}>
              Unassigned • {formatCurrency(totalPrice)}
            </Text>
          ) : isShared ? (
            <Text style={styles.itemPrice}>
              {formatCurrency(totalPrice)} · {formatCurrency(perPersonPrice)} each
            </Text>
          ) : (
            <Text style={styles.itemPrice}>
              {formatCurrency(totalPrice)}
            </Text>
          )}
        </View>
        {isEditingItems ? (
          <QuantityEditor
            quantity={quantity}
            onDecrement={onDecrementQuantity}
            onIncrement={onIncrementQuantity}
          />
        ) : isUnassigned ? (
          <View style={styles.unassignedIcon}>
            <MaterialIcons name="priority-high" size={16} color={colors.onErrorContainer} />
          </View>
        ) : (
          <View style={styles.assignedBadge}>
            <MaterialIcons name="person" size={16} color={colors.onSurfaceVariant} />
          </View>
        )}
      </View>
      {isZeroQuantity && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onRemoveItem}
          style={styles.removeItemButton}
        >
          <Text style={styles.removeItemButtonText}>Remove Item</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.itemCardFooter, isEditingItems && styles.itemCardFooterEditing]}>
        {!isEditingItems && (
          <>
            <View style={styles.chipRowHorizontal}>
              {members.map((m) => (
                <MemberChip
                  key={m.id}
                  member={m}
                  active={assignedMemberIds.includes(m.id)}
                  onPress={() => onToggleMember(item.id, m.id)}
                />
              ))}
            </View>

            {isShared && (
              <View style={styles.sharedRow}>
                <View style={[styles.sharedToggle, styles.sharedToggleActive]}>
                  <MaterialIcons name="group" size={14} color={colors.onSecondary} />
                  <Text style={[styles.sharedToggleText, styles.sharedToggleTextActive]}>
                    Split {assignedMemberIds.length} ways
                  </Text>
                </View>
                <Text style={styles.sharedCount}>
                  {formatCurrency(perPersonPrice)} each
                </Text>
              </View>
            )}
          </>
        )}

        {isEditingItems && (
          <View style={styles.priceEditorWrap}>
            <Text style={styles.priceEditorLabel}>Price</Text>
            <View style={styles.priceEditorField}>
              <Text style={styles.priceEditorCurrency}>$</Text>
              <TextInput
                value={price}
                onChangeText={onPriceChange}
                keyboardType="decimal-pad"
                style={styles.priceEditorInput}
                placeholder="0.00"
                placeholderTextColor={colors.outlineVariant}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  itemCard: {
    padding: 20,
    borderRadius: radii.xl,
    marginBottom: 12,
  },
  itemCardNormal: {
    backgroundColor: colors.surfaceContainerLowest,
  },
  itemCardUnassigned: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
  },
  itemCardZeroQuantity: {
    backgroundColor: colors.errorContainer,
    borderWidth: 1.5,
    borderColor: '#efb8b6',
  },
  itemCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  itemCardInfo: { 
    flex: 1 
  },
  itemName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 2,
  },
  itemNameInput: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
    paddingBottom: 4,
    paddingRight: 12,
  },
  itemPrice: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
  },
  itemPriceUnassigned: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: colors.error,
  },
  removeItemButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.error,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
    marginBottom: 14,
  },
  removeItemButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontWeight: '700',
    color: colors.onError,
  },
  unassignedIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRowHorizontal: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemCardFooter: {
    marginTop: 2,
  },
  itemCardFooterEditing: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  sharedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  sharedToggleActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  sharedToggleText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  sharedToggleTextActive: {
    color: colors.onSecondary,
  },
  sharedCount: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: colors.secondary,
  },
  priceEditorWrap: {
    minWidth: 120,
    alignItems: 'flex-end',
  },
  priceEditorLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  priceEditorField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    borderRadius: radii.full,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  priceEditorCurrency: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.secondary,
    marginRight: 4,
  },
  priceEditorInput: {
    minWidth: 56,
    paddingVertical: 8,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
    textAlign: 'right',
  },
});
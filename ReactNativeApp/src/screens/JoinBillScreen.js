import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { invites } from '../services/api';

export default function JoinBillScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    const trimmedCode = code.trim();
    
    if (!trimmedCode) {
      Alert.alert('Enter Code', 'Please enter an invite code');
      return;
    }

    setLoading(true);
    try {
      // First get bill info from the token
      const infoRes = await invites.getInfo(trimmedCode);
      const billId = infoRes.data?.bill_id;
      
      if (!billId) {
        Alert.alert('Invalid Code', 'This invite code is not valid');
        return;
      }

      // Join the bill
      await invites.join(billId, trimmedCode);
      
      Alert.alert(
        'Success!',
        'You joined the bill',
        [
          {
            text: 'View Bill',
            onPress: () => {
              navigation.replace('BillSplit', { billId });
            },
          },
        ]
      );
    } catch (err) {
      const errorMsg = err?.error?.message || err?.message || 'Failed to join bill';
      Alert.alert('Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Join Bill</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons name="group-add" size={64} color={colors.secondary} />
        </View>

        <Text style={styles.title}>Enter Invite Code</Text>
        <Text style={styles.subtitle}>
          Ask your friend for the invite code to join their bill
        </Text>

        <View style={[styles.card, shadows.card]}>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="Enter code (e.g., ABC123)"
            placeholderTextColor={colors.outlineVariant}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!loading}
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.onSecondary} />
            ) : (
              <>
                <MaterialIcons name="check" size={20} color={colors.onSecondary} />
                <Text style={styles.buttonText}>Join Bill</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.helpBox}>
          <MaterialIcons name="info-outline" size={20} color={colors.onSurfaceVariant} />
          <Text style={styles.helpText}>
            The person who created the bill can share the invite code with you
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.outlineVariant,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 24,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 20,
    lineHeight: 21,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 24,
    gap: 16,
  },
  input: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    fontWeight: '600',
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.md,
    padding: 16,
    textAlign: 'center',
    letterSpacing: 2,
  },
  button: {
    backgroundColor: colors.secondary,
    borderRadius: radii.full,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  helpBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 24,
    padding: 16,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
  },
  helpText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    lineHeight: 19,
  },
});

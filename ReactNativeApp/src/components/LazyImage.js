import React, { useState, memo } from 'react';
import { View, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../theme';

/**
 * LazyImage: lightweight image component with loading + error states.
 *
 * Features:
 * - Shows a spinner until the image loads (avoids jarring pop-in).
 * - Falls back to a placeholder icon on error (broken-image URLs, offline).
 * - Memoized so parent re-renders don't force a re-download.
 *
 * Drop-in replacement for <Image source={{ uri }} style={...} />.
 */
const LazyImage = memo(function LazyImage({
  source,
  style,
  fallbackIcon = 'person',
  fallbackIconSize = 20,
  fallbackIconColor = colors.onSurfaceVariant,
  resizeMode = 'cover',
  ...props
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const uri = source?.uri;
  const showFallback = !uri || hasError;

  if (showFallback) {
    return (
      <View style={[style, styles.fallbackContainer]}>
        <MaterialIcons
          name={fallbackIcon}
          size={fallbackIconSize}
          color={fallbackIconColor}
        />
      </View>
    );
  }

  return (
    <View style={style}>
      <Image
        source={source}
        style={[StyleSheet.absoluteFillObject, { borderRadius: style?.borderRadius }]}
        resizeMode={resizeMode}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        {...props}
      />
      {isLoading && (
        <View style={[StyleSheet.absoluteFillObject, styles.loadingContainer]}>
          <ActivityIndicator size="small" color={colors.outlineVariant} />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerHighest,
  },
  fallbackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerHighest,
  },
});

export default LazyImage;
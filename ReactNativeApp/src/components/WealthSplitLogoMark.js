import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

/** White compass-style mark for brand landing (single-color glyph). */
export default function WealthSplitLogoMark({ size = 144, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="WealthSplit logo">
      <Circle cx="50" cy="50" r="40" stroke={color} strokeWidth="2.2" fill="none" opacity={0.95} />
      <Path fill={color} d="M50 22 L60 58 H40 Z" />
      <Path fill={color} d="M50 78 L40 42 H60 Z" opacity={0.42} />
    </Svg>
  );
}

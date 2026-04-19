import React, { memo } from 'react';
import { MaterialIcons } from '@expo/vector-icons';

// Pre-load commonly used icons to improve performance
const COMMON_ICONS = {
  'arrow-back': 'arrow-back',
  'person-add': 'person-add',
  'receipt-long': 'receipt-long',
  'document-scanner': 'document-scanner',
  'person': 'person',
  'remove': 'remove',
  'add': 'add',
  'priority-high': 'priority-high',
  'group': 'group',
  'dashboard': 'dashboard',
  'logout': 'logout',
  'group-add': 'group-add',
  'arrow-downward': 'arrow-downward',
  'arrow-upward': 'arrow-upward',
  'info': 'info',
  'history': 'history',
};

const Icon = memo(({ name, size = 24, color, ...props }) => {
  return (
    <MaterialIcons 
      name={COMMON_ICONS[name] || name} 
      size={size} 
      color={color} 
      {...props} 
    />
  );
});

Icon.displayName = 'Icon';

export default Icon;
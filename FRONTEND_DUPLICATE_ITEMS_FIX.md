# Fix: Duplicate Items When Navigating Back to Portion Screen

## Problem
When navigating back and forth to the portion/assignment screen, items are duplicated instead of being replaced.

## Root Causes & Solutions

### 1. State Not Being Reset (Most Common)

**Problem:**
```typescript
// Items accumulate when screen is revisited
const [items, setItems] = useState([]);

useEffect(() => {
  loadItems();  // Adds to existing items without clearing
}, []);
```

**Fix:**
```typescript
const [items, setItems] = useState([]);

useEffect(() => {
  // Clear items when component mounts
  setItems([]);
  loadItems();
  
  // Cleanup when component unmounts
  return () => {
    setItems([]);
  };
}, [billId]);  // Re-run when billId changes
```

---

### 2. Appending Instead of Replacing

**Problem:**
```typescript
const loadItems = async () => {
  const response = await api.getItems(billId);
  // WRONG - Adds to existing items
  setItems([...items, ...response.data]);
};
```

**Fix:**
```typescript
const loadItems = async () => {
  const response = await api.getItems(billId);
  // CORRECT - Replaces all items
  setItems(response.data);
};
```

---

### 3. Multiple API Calls

**Problem:**
```typescript
useEffect(() => {
  loadItems();
}, [billId]);  // Fires multiple times

useEffect(() => {
  loadItems();
}, []);  // Also fires

// Results in 2+ API calls, each adding items
```

**Fix:**
```typescript
const [isLoading, setIsLoading] = useState(false);

useEffect(() => {
  if (isLoading) return;  // Prevent duplicate calls
  
  const loadData = async () => {
    setIsLoading(true);
    try {
      const response = await api.getItems(billId);
      setItems(response.data);  // Replace, don't append
    } finally {
      setIsLoading(false);
    }
  };
  
  loadData();
}, [billId]);
```

---

### 4. React Navigation Cache Issue

**Problem:**
React Navigation keeps screens mounted, so state persists between visits.

**Fix Option A - Reset on Focus:**
```typescript
import { useFocusEffect } from '@react-navigation/native';

const PortionScreen = () => {
  const [items, setItems] = useState([]);

  useFocusEffect(
    useCallback(() => {
      // Clear and reload when screen comes into focus
      setItems([]);
      loadItems();
      
      return () => {
        // Optional: cleanup when unfocused
      };
    }, [billId])
  );
};
```

**Fix Option B - Unmount on Blur:**
```typescript
// In your navigator configuration
<Stack.Screen 
  name="Portion" 
  component={PortionScreen}
  options={{
    unmountOnBlur: true  // Forces component to unmount when navigating away
  }}
/>
```

---

## Complete Example Fix

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';

const PortionScreen = ({ route, navigation }) => {
  const { billId } = route.params;
  
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);

  // Reset and load when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      console.log('[PortionScreen] Screen focused - loading data');
      
      const loadData = async () => {
        try {
          setLoading(true);
          
          // Fetch fresh data from API
          const [itemsRes, assignmentsRes] = await Promise.all([
            api.getReceiptItems(billId),
            api.getAssignments(billId)
          ]);
          
          // IMPORTANT: Replace state, don't append
          setItems(itemsRes.data || []);
          setAssignments(assignmentsRes.data || []);
          
          console.log('[PortionScreen] Loaded items:', itemsRes.data?.length);
          
        } catch (error) {
          console.error('[PortionScreen] Error loading:', error);
        } finally {
          setLoading(false);
        }
      };
      
      loadData();
      
      // Cleanup when unfocused
      return () => {
        console.log('[PortionScreen] Screen unfocused - cleaning up');
        setItems([]);
        setAssignments([]);
      };
    }, [billId])
  );

  if (loading && items.length === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
        <Text>Loading items...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text>Total Items: {items.length}</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ItemCard item={item} />
        )}
      />
    </View>
  );
};

export default PortionScreen;
```

---

## Debugging Steps

### 1. Add Console Logs
```typescript
useEffect(() => {
  console.log('[PortionScreen] Current items count:', items.length);
}, [items]);

const loadItems = async () => {
  console.log('[PortionScreen] Loading items for bill:', billId);
  const response = await api.getItems(billId);
  console.log('[PortionScreen] API returned items:', response.data?.length);
  setItems(response.data);
  console.log('[PortionScreen] State updated, new count:', response.data?.length);
};
```

### 2. Check What You See
When you navigate to the portion screen, you should see:
```
[PortionScreen] Screen focused - loading data
[PortionScreen] Current items count: 0
[PortionScreen] Loading items for bill: abc-123
[PortionScreen] API returned items: 5
[PortionScreen] State updated, new count: 5
[PortionScreen] Current items count: 5
```

If you see duplicates:
```
[PortionScreen] Current items count: 5   ← First visit
[PortionScreen] Current items count: 10  ← After going back and returning (WRONG!)
```

---

## Quick Checklist

- [ ] Using `setItems(newItems)` not `setItems([...items, ...newItems])`
- [ ] Clearing state on mount or focus
- [ ] Using `useFocusEffect` for data loading
- [ ] Not calling `loadItems()` in multiple useEffects
- [ ] Using unique keys in FlatList (`keyExtractor`)
- [ ] Console logs show correct item counts

---

## Backend Verification

The backend is NOT the issue, but you can verify:

```bash
# Check how many items the API returns
curl http://localhost:8000/bills/{bill_id}/receipt/items -H "Authorization: Bearer TOKEN"
```

The API should always return the same number of items. If the frontend shows duplicates, it's a state management issue.

---

## Common Patterns to Avoid

```typescript
// ❌ WRONG - Accumulates state
setItems([...items, ...newItems]);

// ❌ WRONG - Multiple loads
useEffect(() => loadItems(), []);
useEffect(() => loadItems(), [billId]);

// ❌ WRONG - No cleanup
const [items, setItems] = useState(cachedItems);

// ✅ CORRECT - Replace state
setItems(newItems);

// ✅ CORRECT - Single load with cleanup
useFocusEffect(useCallback(() => {
  loadItems();
  return () => setItems([]);
}, [billId]));

// ✅ CORRECT - Fresh state on mount
const [items, setItems] = useState([]);
```

---

## Still Having Issues?

If the problem persists:

1. **Check Redux/Context** - If using global state, clear it properly
2. **Check Navigation State** - Clear params when navigating back
3. **Check AsyncStorage** - Make sure you're not loading cached duplicates
4. **Enable React DevTools** - Inspect state changes in real-time

The fix is on the frontend side - the backend is working correctly! 🚀

# Fix: getBalanceBreakdown API Function Missing

## Error
```
_servicesApi.bills.getBalanceBreakdown is not a function (it is undefined)
```

## Root Cause
Your frontend API client is missing the `getBalanceBreakdown()` function, but the backend endpoint EXISTS at:
```
GET /bills/{bill_id}/balance-breakdown
```

---

## Solution 1: Add the Missing API Function (RECOMMENDED)

### Find your API client file (likely `src/services/api.ts` or `src/api/bills.ts`)

Add this function:

```typescript
// In your bills API service
export const bills = {
  // ... existing functions ...
  
  getBalanceBreakdown: async (billId: string) => {
    const response = await apiClient.get(
      `/bills/${billId}/balance-breakdown`,
      {
        headers: {
          Authorization: `Bearer ${getToken()}`
        }
      }
    );
    return response.data;
  },
};
```

### Full Example with Axios:

```typescript
import axios from 'axios';

const API_BASE_URL = 'http://YOUR_SERVER_IP:8000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const bills = {
  getById: async (billId: string) => {
    const response = await apiClient.get(`/bills/${billId}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    return response.data;
  },

  getSummary: async (billId: string) => {
    const response = await apiClient.get(`/bills/${billId}/summary`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    return response.data;
  },

  // ADD THIS FUNCTION:
  getBalanceBreakdown: async (billId: string) => {
    const response = await apiClient.get(`/bills/${billId}/balance-breakdown`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    return response.data;
  },
};
```

---

## Solution 2: Use getSummary Instead (EASIER)

The `/bills/{bill_id}/summary` endpoint ALREADY includes the breakdown data!

### Change your ReviewPayment component:

**BEFORE (Broken):**
```typescript
const breakdown = await _servicesApi.bills.getBalanceBreakdown(billId);
```

**AFTER (Working):**
```typescript
const summary = await _servicesApi.bills.getSummary(billId);
const breakdown = {
  members: summary.data.members,
  bill_total: summary.data.bill.total,
  total_paid: summary.data.total_paid,
  total_remaining: summary.data.total_remaining,
};
```

### Summary Response Structure:

```typescript
{
  "success": true,
  "data": {
    "bill": {
      "id": "...",
      "title": "...",
      "total": "29.09",
      "service_fee": "0.51",
      "service_fee_type": "percentage",
      "service_fee_percentage": "3.5",
      // ... other fields
    },
    "members": [
      {
        "member_id": "...",
        "nickname": "John",
        "subtotal": "13.00",
        "tax_share": "1.04",
        "tip_share": "0.50",
        "fee_share": "0.49",  // ← Service fee share
        "total_owed": "14.53",
        "total_paid": "0.00",
        "remaining": "14.53"
      }
    ],
    "items": [...],
    "total_assigned": "28.00",
    "total_unassigned": "0.00",
    "total_paid": "0.00",
    "total_remaining": "29.09"
  }
}
```

---

## Recommended Approach

**Use Solution 2** (getSummary) because:
- ✅ No need to add a new API function
- ✅ One API call instead of two
- ✅ Gets all the data you need (bill + members + breakdown)
- ✅ Works immediately

### Complete Fix for ReviewPayment.tsx:

```typescript
const loadBillData = async () => {
  try {
    setLoading(true);
    
    // Use getSummary instead of getBalanceBreakdown
    const response = await _servicesApi.bills.getSummary(billId);
    
    if (!response.success) {
      throw new Error(response.error?.message || 'Failed to load bill');
    }
    
    const { bill, members } = response.data;
    
    // Set bill data
    setBill(bill);
    
    // Find current user's member data
    const myMember = members.find(m => m.user_id === currentUserId);
    if (myMember) {
      setMyBreakdown({
        subtotal: myMember.subtotal,
        tax_share: myMember.tax_share,
        tip_share: myMember.tip_share,
        fee_share: myMember.fee_share,  // ← Include service fee
        total_owed: myMember.total_owed,
      });
    }
    
  } catch (error) {
    console.error('[ReviewPayment] Error:', error);
    setError(error.message);
  } finally {
    setLoading(false);
  }
};
```

---

## TypeScript Types

```typescript
interface MemberBreakdown {
  member_id: string;
  nickname: string;
  subtotal: string;
  tax_share: string;
  tip_share: string;
  fee_share: string;        // NEW
  total_owed: string;
  total_paid: string;
  remaining: string;
}

interface BillSummaryResponse {
  success: boolean;
  data: {
    bill: {
      id: string;
      title: string;
      total: string;
      service_fee: string;
      service_fee_type?: string;
      service_fee_percentage?: string;
      // ... other fields
    };
    members: MemberBreakdown[];
    items: any[];
    total_assigned: string;
    total_unassigned: string;
    total_paid: string;
    total_remaining: string;
  };
}
```

---

## Testing

After the fix, your app should:
1. ✅ Load bill data without errors
2. ✅ Show the breakdown with service fee
3. ✅ Display correct total amounts

Test with:
```typescript
console.log('Bill data:', bill);
console.log('My breakdown:', myBreakdown);
console.log('Service fee:', myBreakdown.fee_share);
```

---

## Summary

**Quick Fix (5 minutes):**
Replace `getBalanceBreakdown()` with `getSummary()` - the data is already there!

The backend is working perfectly. You just need to use the right endpoint. 🚀

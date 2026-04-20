// Mock API for testing without backend

const mockPaymentData = {
  bill_id: "bill_123",
  bill_title: "Dinner at Joe's Restaurant",
  merchant_name: "Joe's Restaurant",
  member_name: "John Doe",
  items: [
    { name: "Burger & Fries", quantity: 1, price: 18.99 },
    { name: "Caesar Salad", quantity: 1, price: 12.50 },
    { name: "Iced Tea", quantity: 2, price: 3.50 },
  ],
  subtotal: 38.49,
  tax_share: 3.46,
  tip_share: 7.70,
  total: 49.65,
  stripe_publishable_key: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "pk_test_51234567890",
  payment_intent_client_secret: "pi_test_secret_mock_123456789",
  already_paid: false,
  token_expired: false
};

export const getPaymentDetails = async (token) => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 800));
  
  // Simulate different scenarios based on token
  if (token === 'expired-token') {
    return {
      ...mockPaymentData,
      token_expired: true
    };
  }
  
  if (token === 'paid-token') {
    return {
      ...mockPaymentData,
      already_paid: true
    };
  }
  
  if (token === 'invalid-token') {
    throw new Error('Invalid payment token');
  }
  
  // Return mock data for any other token
  return mockPaymentData;
};

export const confirmPayment = async (token, paymentIntentId) => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return {
    success: true,
    receipt_url: "https://example.com/receipt/123"
  };
};

import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(api.middleware),
});

// Wires up refetchOnFocus / refetchOnReconnect to React Native's AppState
// and NetInfo. Without this, those flags in api.js are no-ops.
setupListeners(store.dispatch);
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, unwrap, ApiError } from '../services/api';
import { getToken, setToken, removeToken } from '../services/authStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [pendingOnboardingName, setPendingOnboardingName] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    const body = await authApi.getMe();
    const data = unwrap(body);
    setUser(data);
    setNeedsOnboarding(false);
    return data;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getToken();
        setTokenState(stored);
        if (stored) {
          try {
            await refreshMe();
          } catch (e) {
            if (e instanceof ApiError && e.code === 'PROFILE_NOT_FOUND') {
              setUser(null);
              setNeedsOnboarding(true);
            } else {
              await removeToken();
              setTokenState(null);
              setUser(null);
              setNeedsOnboarding(false);
            }
          }
        }
      } catch {
        await removeToken();
        setTokenState(null);
        setUser(null);
        setNeedsOnboarding(false);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refreshMe]);

  const completePhoneAuth = useCallback(async (phone, code, firstName, intent) => {
    const body = await authApi.verifyOtp(phone, code, firstName, intent);
    const data = unwrap(body);
    const token = data.access_token;
    if (!token) throw new Error('No token returned');
    await setToken(token);
    setTokenState(token);
    if (data.user) {
      setUser(data.user);
      setNeedsOnboarding(false);
      return data.user;
    }
    try {
      const me = await refreshMe();
      return me;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PROFILE_NOT_FOUND') {
        setUser(null);
        setNeedsOnboarding(true);
        return null;
      }
      throw e;
    }
  }, [refreshMe]);

  const createProfile = useCallback(async (fullName) => {
    const body = await authApi.createProfile(fullName);
    const data = unwrap(body);
    setUser(data);
    setNeedsOnboarding(false);
    setPendingOnboardingName('');
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore — clear local state regardless
    }
    await removeToken();
    setTokenState(null);
    setUser(null);
    setNeedsOnboarding(false);
    setPendingOnboardingName('');
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        needsOnboarding,
        pendingOnboardingName,
        setPendingOnboardingName,
        completePhoneAuth,
        createProfile,
        refreshMe,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

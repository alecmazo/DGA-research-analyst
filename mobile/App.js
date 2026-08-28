import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ActivityIndicator, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as Updates from 'expo-updates';

import MarketsScreen          from './src/screens/MarketsScreen';
import HomeScreen             from './src/screens/HomeScreen';
import AnalystScreen          from './src/screens/AnalystScreen';
import StrategistScreen       from './src/screens/StrategistScreen';
import AnalysisScreen         from './src/screens/AnalysisScreen';
import ReportScreen           from './src/screens/ReportScreen';
import PortfolioSummaryScreen from './src/screens/PortfolioSummaryScreen';
import PaperTrackerScreen     from './src/screens/PaperTrackerScreen';
import PodcastScreen          from './src/screens/PodcastScreen';
import SettingsScreen         from './src/screens/SettingsScreen';
import FundScreen             from './src/screens/FundScreen';
import LoginScreen            from './src/screens/LoginScreen';
import LockScreen             from './src/screens/LockScreen';
import LPPerformanceScreen    from './src/screens/LPPerformanceScreen';
import LPPlanningScreen       from './src/screens/LPPlanningScreen';
import WatchlistScreen        from './src/screens/WatchlistScreen';
import FinancialsScreen       from './src/screens/FinancialsScreen';
import MoreScreen             from './src/screens/MoreScreen';
import CustomTabBar           from './src/components/CustomTabBar';

import { whoamiV2, getV2User, logoutV2 } from './src/api/client';
import { isBiometricEnabled, disableBiometric } from './src/api/biometric';
import { colors, ThemeProvider } from './src/design';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home"        component={HomeScreen} />
      <Stack.Screen name="Analyst"     component={AnalystScreen} />
      <Stack.Screen name="Strategist"  component={StrategistScreen} />
      <Stack.Screen name="Analysis"    component={AnalysisScreen} />
      <Stack.Screen name="Report"      component={ReportScreen} />
    </Stack.Navigator>
  );
}

function FundStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="FundHome"        component={FundScreen} />
      <Stack.Screen name="PortfolioSummary" component={PortfolioSummaryScreen} />
    </Stack.Navigator>
  );
}

// ── More stack: lower-traffic destinations behind a single tab ───────────────
function MoreStack({ onLogout, isDemo, onSwitchToLP }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MoreHome"      component={MoreScreen} />
      <Stack.Screen name="Podcast"       component={PodcastScreen} />
      <Stack.Screen name="PaperTracker"  component={PaperTrackerScreen} />
      <Stack.Screen name="Settings">
        {() => <SettingsScreen onLogout={onLogout} isDemo={isDemo} onSwitchToLP={onSwitchToLP} isLpMode={false} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

// ── GP navigator: five primary tabs + a More hub (Podcast, Settings) ─────────
function GPTabs({ onLogout, isDemo, onSwitchToLP }) {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Markets"    component={MarketsScreen} />
      <Tab.Screen name="Research"   component={HomeStack} />
      <Tab.Screen name="Financials" component={FinancialsScreen} />
      <Tab.Screen name="Positions"  component={WatchlistScreen} />
      <Tab.Screen name="Fund"       component={FundStack} />
      <Tab.Screen name="More">
        {() => <MoreStack onLogout={onLogout} isDemo={isDemo} onSwitchToLP={onSwitchToLP} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// ── LP navigator: Positions first, no Research tab ───────────────────────────
function LPTabs({ onLogout, isDemo, onSwitchToAdmin }) {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Positions" component={WatchlistScreen} />
      <Tab.Screen name="Performance">
        {() => <LPPerformanceScreen onLogout={onLogout} isDemo={isDemo} onSwitchToAdmin={onSwitchToAdmin} />}
      </Tab.Screen>
      <Tab.Screen name="Documents" component={LPPlanningScreen} />
      <Tab.Screen name="Podcast"   component={PodcastScreen} />
      <Tab.Screen name="Settings">
        {() => <SettingsScreen onLogout={onLogout} isDemo={isDemo} onSwitchToLP={null} isLpMode={true} onSwitchToAdmin={onSwitchToAdmin} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

// ── Auto-OTA: cold launch + return-to-foreground ────────────────────────────
// Native ON_LOAD + fallbackToCacheTimeout:0 downloads in the background but
// does NOT apply until the next process start. If we only call
// checkForUpdateAsync(), Expo returns isAvailable=false once the bundle is
// already sitting in isUpdatePending — so a warm reopen stayed stale until
// a force-quit. Always apply a pending update first.
let _otaInFlight = false;
let _otaLastCheckMs = 0;
const OTA_MIN_INTERVAL_MS = 45_000;

async function applyPendingUpdate(reason) {
  try {
    if (Updates.isUpdatePending) {
      console.log('[OTA] applying pending update (' + reason + ')');
      await Updates.reloadAsync();
      return true;
    }
  } catch (e) {
    console.log('[OTA] pending apply failed:', e?.message || e);
  }
  return false;
}

async function checkForOtaUpdate(reason = 'launch') {
  try {
    if (__DEV__) return;
    if (!Updates.isEnabled) return;
    if (_otaInFlight) return;
    if (await applyPendingUpdate(reason)) return;
    const now = Date.now();
    if (now - _otaLastCheckMs < OTA_MIN_INTERVAL_MS) return;
    _otaInFlight = true;
    _otaLastCheckMs = now;
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      console.log('[OTA] update available (' + reason + ') — fetching…');
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch (e) {
    console.log('[OTA] update check skipped:', e?.message || e);
  } finally {
    _otaInFlight = false;
  }
}

export default function App() {
  // null = checking, 'locked' = biometric gate, 'login' = show login,
  // otherwise the v2 user object
  const [authState, setAuthState] = useState(null);
  // Demo admin can toggle between GP admin view and LP investor view
  const [lpMode, setLpMode] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  // Reconcile auth on launch + whenever someone logs in/out
  const refreshAuth = useCallback(async () => {
    // First, try the cached user for an instant render…
    const cached = await getV2User();
    if (cached) setAuthState(cached);

    // …then verify with the server to make sure the token is still good.
    const verified = await whoamiV2();
    setAuthState(verified || 'login');
  }, []);

  // Launch gate: if the user enabled the biometric lock, show it BEFORE any
  // data — the v2 session persists, so without this the app would open straight
  // into the portfolio. Otherwise fall through to the normal cached-then-verify.
  const bootstrap = useCallback(async () => {
    if (await isBiometricEnabled()) {
      setAuthState('locked');
    } else {
      await refreshAuth();
    }
  }, [refreshAuth]);

  useEffect(() => {
    checkForOtaUpdate('cold-start');
    bootstrap();
  }, [bootstrap]);

  // Warm reopen: apply a bundle already downloaded by native ON_LOAD, then
  // check Expo for a newer one. Data screens also refresh via useAppResume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active') {
        checkForOtaUpdate('foreground');
      }
    });
    return () => sub.remove();
  }, []);

  const handleLoggedIn = useCallback((user) => {
    setLpMode(false);   // always start in admin view after fresh login
    setAuthState(user);
  }, []);

  // LockScreen resolved a session (or 'login' if the stored session was stale).
  const handleUnlocked = useCallback((user) => {
    setLpMode(false);
    setAuthState(user || 'login');
  }, []);
  const handleLogout = useCallback(async () => {
    await logoutV2();          // clear v2 token + cached user from AsyncStorage
    await disableBiometric();  // full sign-out also clears the biometric lock + stored creds
    setLpMode(false);
    setAuthState('login');
  }, []);

  // ── Splash while we read AsyncStorage + verify ────────────────────────────
  if (authState === null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  // ── Biometric lock → require Face ID / Touch ID before revealing data ─────
  if (authState === 'locked') {
    return (
      <>
        <StatusBar style="light" />
        <LockScreen
          onUnlocked={handleUnlocked}
          onUsePassword={() => setAuthState('login')}
        />
      </>
    );
  }

  // ── Not signed in → show login ───────────────────────────────────────────
  if (authState === 'login') {
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen onLoggedIn={handleLoggedIn} />
      </>
    );
  }

  // ── Signed in → branch by role ───────────────────────────────────────────
  // Admin has full GP access (same tabs as GP)
  const isGPOrAdmin = authState.role === 'gp' || authState.role === 'admin';
  const isDemo      = !!authState.demo_mode;

  return (
    <ThemeProvider>
      <NavigationContainer key={lpMode ? 'lp' : 'gp'}>
        <StatusBar style="light" />
        {isGPOrAdmin && !lpMode
          ? <GPTabs onLogout={handleLogout} isDemo={isDemo} onSwitchToLP={() => setLpMode(true)} />
          : <LPTabs onLogout={handleLogout} isDemo={isDemo} onSwitchToAdmin={isGPOrAdmin ? () => setLpMode(false) : null} />
        }
      </NavigationContainer>
    </ThemeProvider>
  );
}

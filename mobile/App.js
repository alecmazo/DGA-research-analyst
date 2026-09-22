import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ActivityIndicator, AppState, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import SupportFab             from './src/components/SupportFab';

import { whoamiV2, getV2User, logoutV2 } from './src/api/client';
import { isBiometricEnabled, disableBiometric } from './src/api/biometric';
import { colors, ThemeProvider } from './src/design';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

class BootBoundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0b1220', padding: 28, justifyContent: 'center' }}>
          <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
            DGA could not open this screen
          </Text>
          <Text style={{ color: '#cbd5e1', fontSize: 14 }}>
            {String(this.state.err.message || this.state.err)}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

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
      <Stack.Screen name="Planning">
        {() => <LPPlanningScreen gpMode />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

// ── More stack: lower-traffic destinations behind a single tab ───────────────
function MoreStack({ onLogout, isDemo, onSwitchToLP }) {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MoreHome"      component={MoreScreen} />
      <Stack.Screen name="Planning">
        {() => <LPPlanningScreen gpMode />}
      </Stack.Screen>
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
  const [tab, setTab] = useState('Markets');
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
        screenListeners={{
          state: (e) => {
            const s = e.data?.state;
            const name = s?.routes?.[s.index]?.name;
            if (name) setTab(name);
          },
        }}
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
      <SupportFab surface={`mobile-gp/${tab}`} />
    </View>
  );
}

// ── LP navigator: Positions first, no Research tab ───────────────────────────
function LPTabs({ onLogout, isDemo, onSwitchToAdmin }) {
  return (
    <View style={{ flex: 1 }}>
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
      <SupportFab surface="mobile-lp/Positions" />
    </View>
  );
}

// ── Auto-OTA: download in background; never reload on cold start ────────────
// Applying a pending update on launch white-screens a demo. Fetch on
// cold-start; apply only after the app has been in-session 90s and then
// backgrounds, or from Settings.
let _otaInFlight = false;
let _otaLastCheckMs = 0;
const OTA_MIN_INTERVAL_MS = 45_000;
const SESSION_START_MS = Date.now();
const OTA_APPLY_AFTER_MS = 90_000;

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

async function fetchOtaOnly() {
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      console.log('[OTA] fetching update (no reload)');
      await Updates.fetchUpdateAsync();
    }
  } catch (e) {
    console.log('[OTA] fetch skipped:', e?.message || e);
  }
}

async function checkForOtaUpdate(reason = 'launch') {
  try {
    if (__DEV__) return;
    if (!Updates.isEnabled) return;
    if (_otaInFlight) return;
    const now = Date.now();
    if (reason === 'cold-start') {
      _otaInFlight = true;
      _otaLastCheckMs = now;
      try { await fetchOtaOnly(); } finally { _otaInFlight = false; }
      return;
    }
    if (now - _otaLastCheckMs < OTA_MIN_INTERVAL_MS) return;
    _otaInFlight = true;
    _otaLastCheckMs = now;
    if (reason === 'foreground' && now - SESSION_START_MS >= OTA_APPLY_AFTER_MS) {
      if (await applyPendingUpdate(reason)) return;
    }
    await fetchOtaOnly();
    if (reason === 'settings') {
      await applyPendingUpdate('settings');
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
    // Do not touch expo-updates on launch. A check here re-downloaded a
    // crashing bundle before the first screen could paint.
    bootstrap();
  }, [bootstrap]);

  // Warm reopen: after 90s in-session, apply a pending OTA. Cold start never reloads.
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
    <SafeAreaProvider>
      <BootBoundary>
        <ThemeProvider>
          <NavigationContainer key={lpMode ? 'lp' : 'gp'}>
            <StatusBar style="light" />
            {isGPOrAdmin && !lpMode
              ? <GPTabs onLogout={handleLogout} isDemo={isDemo} onSwitchToLP={() => setLpMode(true)} />
              : <LPTabs onLogout={handleLogout} isDemo={isDemo} onSwitchToAdmin={isGPOrAdmin ? () => setLpMode(false) : null} />
            }
          </NavigationContainer>
        </ThemeProvider>
      </BootBoundary>
    </SafeAreaProvider>
  );
}

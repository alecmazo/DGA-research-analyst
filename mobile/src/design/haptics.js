/**
 * Haptic feedback abstraction.
 *
 * **Active scope:** long-press only. Tap-style and completion-style
 * haptics were intentionally muted because they fired too aggressively
 * during normal navigation. The semantic API surface (onPressTab,
 * onPressPrimary, onSuccess, etc.) is preserved so individual variants
 * can be re-enabled by changing one line below — no call-site edits.
 *
 * **Native-module compatibility note:**
 *   This module is OTA-safe. `expo-haptics` is loaded via a try/require
 *   so older TestFlight binaries that don't have the native module
 *   linked fall through silently rather than crashing. Once the next
 *   native rebuild lands in TestFlight, the same JS bundle (already
 *   pushed via OTA) automatically starts producing real iOS
 *   UIImpactFeedback haptics. No call-site edits needed.
 *
 * To re-enable any of the silent variants, swap `_silent` below for the
 * corresponding `_haptic(...)` factory call.
 */

// Defensive load — older binaries pre-`expo-haptics` will throw on
// require, so we trap it and run the rest of the app without haptics.
let Haptics = null;
try {
  // eslint-disable-next-line global-require
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

function safe(fn) {
  try { fn(); } catch {} // never let haptics crash the app
}

/** Build a haptic invoker that no-ops if expo-haptics isn't linked. */
function _impact(style) {
  return () => {
    if (!Haptics?.impactAsync) return;
    safe(() => Haptics.impactAsync(style));
  };
}

// Canonical "long-press confirmed" tap. Medium impact — firm enough
// to confirm the gesture without feeling jarring.
const _longPressTap = _impact(Haptics?.ImpactFeedbackStyle?.Medium);

// No-op for all the silent variants — preserves the API so call sites
// keep compiling, but produces no physical feedback.
const _silent = () => {};

function _selection() {
  return () => {
    if (!Haptics?.selectionAsync) return;
    safe(() => Haptics.selectionAsync());
  };
}

export const haptics = {
  // ── Active ──
  onLongPress: _longPressTap,
  onPressTab: _selection(),
  onPressPrimary: _impact(Haptics?.ImpactFeedbackStyle?.Light),
  onToggle: _selection(),

  // ── Quiet (preserve API; avoid firing on every poll/success toast) ──
  onSuccess: _silent,
  onError:   _silent,
  onWarn:    _silent,
};

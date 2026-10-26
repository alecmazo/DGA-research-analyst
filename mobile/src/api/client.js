/**
 * DGA Capital — API client for React Native
 *
 * Auth is the v2 email + password session only:
 *   1. loginV2(email, password) → POST /api/auth/v2/login
 *   2. The signed token is cached in AsyncStorage
 *   3. Every request sends x-auth-v2-token
 * A GP account can call fund and managed-account routes. An LP account
 * uses the scoped /api/v2/lp/* routes (and the two fund reads the server
 * still allows for any signed-in account).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// API base URL.
// CRITICAL: the production fallback MUST be the public Railway URL —
// `localhost` from an iPhone points to the phone itself, never your Mac.
// `EXPO_PUBLIC_API_BASE_URL` is build-time-injected via eas.json env blocks
// (development → localhost:8000 for the simulator), but if it's missing
// (e.g. an OTA bundle published from a shell without that env var set)
// we default to Railway so the iPhone can still reach the API.
// Canonical public host (custom domain → same Railway service).
// Keep railway.app as a silent fallback if DNS ever hiccups.
const PROD_API_BASE_URL  = 'https://portfolio.dgacapital.com';
const DEFAULT_BASE_URL   = process.env.EXPO_PUBLIC_API_BASE_URL || PROD_API_BASE_URL;

const BASE_URL_KEY  = '@dga_api_base_url';
const GAMMA_KEY     = '@dga_gamma_enabled';

// v2 per-user auth — email + password → signed claims token (role + scope).
const V2_TOKEN_KEY = '@dga_v2_token';
const V2_USER_KEY  = '@dga_v2_user';

// Migrate stale `localhost` URLs that older builds saved to AsyncStorage.
// On a real iPhone (TestFlight build) localhost is meaningless and every
// request fails with "Network request failed" — auto-redirect to Railway.
function isInvalidStoredUrl(url) {
  if (!url) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
}

// ── Base URL ─────────────────────────────────────────────────────────────────
export async function getBaseUrl() {
  try {
    const s = await AsyncStorage.getItem(BASE_URL_KEY);
    if (isInvalidStoredUrl(s)) {
      // Stale dev URL — overwrite with Railway and surface that to callers.
      if (s) {
        try { await AsyncStorage.setItem(BASE_URL_KEY, DEFAULT_BASE_URL); } catch {}
      }
      return DEFAULT_BASE_URL;
    }
    return s;
  } catch {
    return DEFAULT_BASE_URL;
  }
}
export async function setBaseUrl(url) {
  await AsyncStorage.setItem(BASE_URL_KEY, url.replace(/\/$/, ''));
}
// Force-reset whatever URL is stored back to the production default. Wired
// to the "Reset Server URL" button in Settings so the user can self-recover
// if a bad URL got cached and the app can't reach the API.
export async function resetBaseUrlToProd() {
  await AsyncStorage.setItem(BASE_URL_KEY, DEFAULT_BASE_URL);
  return DEFAULT_BASE_URL;
}

// ── Gamma preference ─────────────────────────────────────────────────────────
export async function getGammaEnabled() {
  try {
    const s = await AsyncStorage.getItem(GAMMA_KEY);
    return s === null ? false : s === 'true';   // default OFF
  } catch { return false; }
}
export async function setGammaEnabled(v) {
  await AsyncStorage.setItem(GAMMA_KEY, v ? 'true' : 'false');
}

// ── v2 Auth (email + password, role-aware) ────────────────────────────────────
/** Sign in via POST /api/auth/v2/login. Stores the token + user record
 *  in AsyncStorage and returns the user object. Throws with isAuthError
 *  on a 401. */
export async function loginV2(email, password, totpCode) {
  const base = await getBaseUrl();
  const payload = {
    email: String(email || '').trim(),
    password: String(password || ''),
  };
  if (totpCode) payload.totp_code = String(totpCode).trim();
  const resp = await fetch(`${base}/api/auth/v2/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (resp.status === 401) {
    const err = new Error(totpCode ? 'Invalid authentication code' : 'Invalid email or password');
    err.isAuthError = true;
    throw err;
  }
  if (!resp.ok) {
    throw new Error(`Login failed (${resp.status})`);
  }
  const data = await resp.json();
  // Password OK but a second factor (TOTP) is required — signal the UI.
  if (data && data.mfa_required) {
    const err = new Error('Two-factor authentication code required');
    err.mfaRequired = true;
    throw err;
  }
  const user = {
    lp_id:                data.lp_id,
    name:                 data.name,
    email:                data.email,
    role:                 data.role,
    must_change_password: data.must_change_password,
    fund_memberships:     data.fund_memberships || {},
    managed_account_ids:  data.managed_account_ids || [],
    impersonated:         data.impersonated || false,
    demo_mode:            data.demo_mode    || false,
  };
  await AsyncStorage.multiSet([
    [V2_TOKEN_KEY, data.token],
    [V2_USER_KEY,  JSON.stringify(user)],
  ]);
  return user;
}

/** Get the cached v2 user (no network). Returns null if not signed in. */
export async function getV2User() {
  try {
    const raw = await AsyncStorage.getItem(V2_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Get the cached v2 token. Returns '' if not signed in. */
export async function getV2Token() {
  try { return (await AsyncStorage.getItem(V2_TOKEN_KEY)) || ''; }
  catch { return ''; }
}

/** Verify the cached v2 token against /me. Refreshes the cached user
 *  record on success. Returns the user or null. */
export async function whoamiV2() {
  const [base, tok] = await Promise.all([getBaseUrl(), getV2Token()]);
  if (!tok) return null;
  try {
    const r = await fetch(`${base}/api/auth/v2/me`, {
      headers: { 'x-auth-v2-token': tok },
    });
    if (!r.ok) {
      // Token rejected — clear it so the user sees the login screen
      await AsyncStorage.multiRemove([V2_TOKEN_KEY, V2_USER_KEY]);
      return null;
    }
    const me = await r.json();
    await AsyncStorage.setItem(V2_USER_KEY, JSON.stringify(me));
    return me;
  } catch {
    return null;
  }
}

/** Sign out of v2. Clears the token + cached user record. */
export async function logoutV2() {
  await AsyncStorage.multiRemove([V2_TOKEN_KEY, V2_USER_KEY]);
}

/** Wrapped fetch that attaches the v2 session token.
 *  Use for any /api/v2/* call. Returns the raw Response object. */
export async function v2Fetch(path, options = {}) {
  const [base, tok] = await Promise.all([getBaseUrl(), getV2Token()]);
  const url = `${base}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (tok) headers['x-auth-v2-token'] = tok;
  return fetch(url, { ...options, headers, cache: 'no-store' });
}

// ── Core fetch helper ─────────────────────────────────────────────────────────
async function request(path, options = {}) {
  const [base, v2Token] = await Promise.all([getBaseUrl(), getV2Token()]);
  const url = `${base}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (v2Token) headers['x-auth-v2-token'] = v2Token;

  const resp = await fetch(url, { ...options, headers, cache: 'no-store' });

  if (resp.status === 401) {
    const err = new Error('Sign in again with your email and password.');
    err.isAuthError = true;
    throw err;
  }

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── Public API surface ────────────────────────────────────────────────────────
export const api = {
  // ---------- Health (no auth needed) ----------
  health: async () => {
    const base = await getBaseUrl();
    const resp = await fetch(`${base}/health`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    return resp.json();
  },

  // ---------- Podcasts (DGA HiTech and Systems Over Goals Daily) ----------
  listPodcastEpisodes: async (show) => {
    const q = show ? `?show=${encodeURIComponent(show)}` : '';
    const r = await v2Fetch(`/api/podcast/list${q}`);
    if (!r.ok) throw new Error(`podcast/list ${r.status}`);
    return r.json();
  },
  // Episode rows carry a public path (`/api/public/podcast/media/...`).
  // The player cannot attach the session header, so that path is the one to stream.
  resolvePodcastMediaUrl: async (pathOrUrl) => {
    if (!pathOrUrl) return null;
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const base = await getBaseUrl();
    return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  },
  // Build the public audio URL — the /audio.mp3 endpoint is auth-bypassed
  // (whitelisted in the server's auth middleware) so <Audio.Sound> can stream
  // without sending custom headers.
  // format scopes the lookup: one ticker can have multiple episodes
  // (debate / pre_mortem / memo / catalysts / quick_hit). Server falls
  // back to the latest row for the ticker if the exact format is missing.
  getPodcastAudioUrl: async (ticker, format = 'debate') => {
    const base = await getBaseUrl();
    return `${base}/api/podcast/${ticker}/audio.mp3?format=${encodeURIComponent(format)}`;
  },

  // Mint an HMAC-signed PUBLIC share link for an episode (no auth required
  // to play). Default TTL 30 days; pass a different number for shorter
  // expiry. Returns { ok, url, expires_at } on success, throws otherwise.
  mintPodcastShareLink: async (ticker, format = 'debate', ttl_hours = 720) => {
    const r = await v2Fetch(
      `/api/podcast/${encodeURIComponent(ticker)}/share-link?format=${encodeURIComponent(format)}&ttl_hours=${ttl_hours}`,
      { method: 'POST' }
    );
    if (!r.ok) throw new Error(`share-link ${r.status}`);
    return r.json();
  },

  // ---------- 🤖 AI Analyst (agentic) ----------
  // Claude runs a tool-use loop over platform data (quotes, saved reports,
  // SEC financials, news, YTD) and answers with cited numbers. GP-only —
  // requires a v2 session (request() piggybacks the v2 token automatically).
  startAgentic: (question, llmProvider = null) =>
    request('/api/research/agentic', {
      method: 'POST',
      body: JSON.stringify({
        question,
        source: 'analyst',
        ...(llmProvider ? { llm_provider: String(llmProvider).toLowerCase() } : {}),
      }),
    }),
  getAgentic: (jobId) => request(`/api/research/agentic/${encodeURIComponent(jobId)}`),

  // Saved AI Analyst runs (persisted server-side after each completed job)
  listAnalystReviews: (source = 'analyst') =>
    request(`/api/research/analyst/reviews?source=${encodeURIComponent(source)}`),
  getAnalystReview: (id) =>
    request(`/api/research/analyst/reviews/${encodeURIComponent(id)}`),
  deleteAnalystReview: (id) =>
    request(`/api/research/analyst/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  fileSupportTicket: (body) =>
    request('/api/support/tickets', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),

  // Portfolio Strategist (whole-book IC review — same job poller as agentic)
  startPortfolioStrategist: (body = {}) =>
    request('/api/research/portfolio-strategist', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  listStrategistReviews: () =>
    request('/api/research/strategist/reviews'),
  getStrategistReview: (id) =>
    request(`/api/research/strategist/reviews/${encodeURIComponent(id)}`),
  deleteStrategistReview: (id) =>
    request(`/api/research/strategist/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Free earnings card (EPS + revenue actual/consensus) — zero LLM
  getEarnings: (ticker) =>
    request(`/api/earnings/${encodeURIComponent(String(ticker || '').toUpperCase())}`),
  getEarningsBatch: (tickers) => {
    const tks = (tickers || [])
      .map((t) => String(t || '').toUpperCase().trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!tks.length) return Promise.resolve({ ok: true, cards: {}, tickers: [] });
    return request(`/api/earnings/batch?tickers=${encodeURIComponent(tks.join(','))}`);
  },

  // Email a DGA-branded PDF of an analysis (same endpoint as the web desk)
  emailResearchPdf: ({ title, question, answerHtml, stamp, to, subject } = {}) =>
    request('/api/research/email-pdf', {
      method: 'POST',
      body: JSON.stringify({
        title: title || 'AI Analyst',
        question: question || '',
        answer_html: answerHtml || '',
        stamp: stamp || '',
        to: to || '',
        subject: subject || undefined,
      }),
    }),

  // ---------- Single-ticker analysis ----------
  // llmProvider: 'grok' (default) | 'claude' | 'deepseek' | 'both'
  // Kimi is not accepted for full equity reports (server 422s).
  startAnalysis: (ticker, generateGamma = false, llmProvider = 'grok') => {
    let p = String(llmProvider || 'grok').toLowerCase().trim();
    if (p === 'kimi' || p === 'volume') p = 'deepseek';
    return request('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        ticker,
        generate_gamma: generateGamma,
        llm_provider:   p,
      }),
    });
  },

  getJobStatus: (jobId) => request(`/api/jobs/${jobId}`),
  cancelJob:    (jobId) => request('/api/jobs/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST' }),
  listJobs:     ()       => request('/api/jobs'),
  // provider: 'grok' (default) | 'claude' — opens the right MD via ?provider=
  getReport: (ticker, provider = 'grok', opts = {}) => {
    const stored = opts.asStored ? '&as_stored=1' : '';
    return request(`/api/report/${encodeURIComponent(ticker)}?provider=${encodeURIComponent(provider)}${stored}`);
  },
  listReports:  ()       => request('/api/reports'),
  // Bulk re-analyze
  startReanalyzeAll: (tickers) =>
    request('/api/reports/reanalyze-all', {
      method: 'POST',
      body: tickers ? JSON.stringify({ tickers }) : undefined,
    }),
  getReanalyzeAllStatus: (bulkId) =>
    request(`/api/reports/reanalyze-all/${bulkId}`),
  getActiveReanalyzeAll: () => request('/api/reports/reanalyze-all'),
  cancelReanalyzeAll: (bulkId) =>
    request(`/api/reports/reanalyze-all/${bulkId}/cancel`, { method: 'POST' }),
  getQuote:     (ticker) => request(`/api/quote/${ticker}`),

  // ---------- Financials (pure-DB on the server — zero LLM / zero live pulls) ----------
  getFinancialsDashboard: (ticker, periodType = 'annual') =>
    request(`/api/financials/${encodeURIComponent(ticker)}/dashboard?period_type=${periodType}`),
  getFinancialsPriceHistory: (ticker, range = 'YTD') =>
    request(`/api/financials/${encodeURIComponent(ticker)}/price-history?range=${encodeURIComponent(range)}`),
  getSpyYtd:    ()       => request('/api/market/spy-ytd'),
  // ---------- Markets dashboard (mobile home tab) ----------
  // Live index ribbon (S&P, Nasdaq, Dow, VIX, …)
  getMarketIndices: () => request('/api/market/indices'),
  getMobileHome: () => request('/api/mobile/home'),
  // Desk Market Pulse — newest public headline per ticker, no LLM.
  getMarketPulse: (tickers, opts = {}) => {
    const tks = (tickers || [])
      .map((t) => String(t || '').toUpperCase().trim())
      .filter(Boolean);
    const qs = new URLSearchParams();
    qs.set('limit', String(opts.limit != null ? opts.limit : 6));
    if (tks.length) qs.set('tickers', tks.join(','));
    if (opts.force) qs.set('force', 'true');
    if (opts.merge) qs.set('merge', 'true');
    return request(`/api/market/pulse?${qs.toString()}`);
  },
  // Desk Market Wire — free macro RSS (no LLM). Used on Markets tab.
  // Server path is public; still send tokens when present. Multiple
  // fallbacks so a single auth mode never blanks the card.
  getMarketWire: async (limit = 10) => {
    const path = `/api/v2/news/market-wire?limit=${Math.max(1, Math.min(Number(limit) || 10, 25))}`;
    const base = await getBaseUrl();
    // 1) Unauthenticated first (endpoint is on _PUBLIC_PATHS — free RSS)
    try {
      const r = await fetch(`${base}${path}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (r.ok) {
        const d = await r.json();
        if (d && (Array.isArray(d.items) || d.ok)) return d;
      }
    } catch (_) { /* fall through */ }
    // 2) Authenticated request helper
    try {
      return await request(path);
    } catch (e1) {
      // 3) v2Fetch (same session token)
      try {
        const r = await v2Fetch(path);
        if (r.ok) return r.json();
        const text = await r.text();
        throw new Error(`${r.status}: ${text}`);
      } catch (e2) {
        throw e1;
      }
    }
  },
  // Idea Generator — today's movers ≥ threshold% from the user's universe
  getIdeaFeed: (threshold = 4, limit = 60) =>
    request(`/api/v2/research/idea-feed?threshold=${threshold}&limit=${limit}&_t=${Date.now()}`),
  // Free per-ticker news (Yahoo → RSS → Google News, non-LLM) for mover expand
  getNews: (tickers, limit = 6) =>
    request(`/api/news?tickers=${encodeURIComponent(tickers)}&limit=${limit}`),
  getTickerMeta: (ticker) => request(`/api/market/ticker-meta/${encodeURIComponent(ticker)}`),
  deleteReport: (ticker) => request(`/api/report/${ticker}`, { method: 'DELETE' }),

  downloadUrl: async (ticker, type) => {
    // Linking.openURL cannot send headers, so the v2 session travels
    // as ?v2_token= (the middleware accepts that query param).
    const [base, v2] = await Promise.all([getBaseUrl(), getV2Token()]);
    const qs = new URLSearchParams();
    if (v2) qs.set('v2_token', v2);
    const q = qs.toString();
    const tk = encodeURIComponent(String(ticker || '').trim().toUpperCase());
    const fmt = String(type || 'docx').replace(/[^a-z0-9]/gi, '') || 'docx';
    return `${base}/api/download/${tk}/${fmt}${q ? `?${q}` : ''}`;
  },

  // ---------- Portfolio ----------
  listStrategies: () => request('/api/strategies'),

  startPortfolio: async ({ fileUri, fileName, mimeType, strategy, reuseExisting, generateGamma }) => {
    const [base, v2] = await Promise.all([getBaseUrl(), getV2Token()]);
    const fd = new FormData();
    fd.append('file', { uri: fileUri, name: fileName || 'portfolio.xlsx',
      type: mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fd.append('strategy',       strategy      || 'pro');
    fd.append('reuse_existing', reuseExisting ? 'true' : 'false');
    fd.append('generate_gamma', generateGamma ? 'true' : 'false');
    const headers = {};
    if (v2) headers['x-auth-v2-token'] = v2;
    const resp = await fetch(`${base}/api/portfolio`, { method: 'POST', headers, body: fd });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status}: ${text}`);
    }
    return resp.json();
  },

  getPortfolioJob: (jobId) => request(`/api/portfolio/${jobId}`),
  portfolioDownloadUrl: async (jobId) => {
    const [base, v2] = await Promise.all([getBaseUrl(), getV2Token()]);
    const qs = new URLSearchParams();
    if (v2) qs.set('v2_token', v2);
    const q = qs.toString();
    return `${base}/api/portfolio/${jobId}/download${q ? `?${q}` : ''}`;
  },
  getLastPortfolio:    () => request('/api/portfolio/last'),
  // Full payload of the last completed rebalance (synced via Dropbox on server).
  // Same shape as the AsyncStorage LAST_PORTFOLIO_KEY — whichever is newer wins.
  getLastPortfolioJob: () => request('/api/portfolio/last-job'),
  getPortfolioSummary: () => request('/api/portfolio/summary'),

  // ---------- Watchlist ----------
  getWatchlist: (fresh = false) =>
    request(fresh ? `/api/watchlist?fresh=1&_t=${Date.now()}` : '/api/watchlist'),
  addToWatchlist:      (ticker) => request(`/api/watchlist/${ticker}`, { method: 'POST' }),
  removeFromWatchlist: (ticker) => request(`/api/watchlist/${ticker}`, { method: 'DELETE' }),

  // Free (zero-LLM) stock snapshot — same payload as the desktop ticker expand card
  getStockInfo: (ticker) =>
    request(`/api/stock-info/${encodeURIComponent(String(ticker || '').trim().toUpperCase())}`),

  // ---------- Market Scan ----------
  startScan:     (tickers) => request('/api/scan', {
    method: 'POST', body: JSON.stringify({ tickers }),
  }),
  getScanJob:    (jobId) => request(`/api/scan/${jobId}`),
  getLatestScan: ()      => request('/api/scan/latest'),

  // ---------- Market Intelligence ----------
  startIntelligence: (sector = 'Tech') => request('/api/intelligence', {
    method: 'POST', body: JSON.stringify({ sector }),
  }),
  getIntelligenceJob:    (jobId) => request(`/api/intelligence/${jobId}`),
  getLatestIntelligence: ()      => request('/api/intelligence/latest'),

  // ---------- Daily Brief (Goldman-style PM morning note) ----------
  startDailyBrief:     ()      => request('/api/daily-brief', { method: 'POST' }),
  getDailyBriefJob:    (jobId) => request(`/api/daily-brief/${jobId}`),
  getLatestDailyBrief: ()      => request('/api/daily-brief/latest'),

  // ---------- Paper Portfolio Tracker ----------
  createTracker: (body) => request('/api/track', {
    method: 'POST', body: JSON.stringify(body),
  }),
  listTrackers:           ()    => request('/api/track'),
  getTracker:             (id)  => request(`/api/track/${id}`),
  closeTracker:           (id)  => request(`/api/track/${id}/close`, { method: 'POST' }),
  deleteTracker:          (id)  => request(`/api/track/${id}`, { method: 'DELETE' }),
  getLiveBenchmark:       ()    => request('/api/track/live'),
  getLiveBenchmarkDetail: (snapshotId) => request(
    '/api/track/live/detail' + (snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : '')
  ),
  listYtdSnapshots:       ()    => request('/api/track/live/snapshots'),
  deleteYtdSnapshot:      (id)  => request(`/api/track/live/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  emailYtdReport:         (email, snapshotId) => request('/api/track/live/ytd/email', {
    method: 'POST',
    body:   JSON.stringify({ email, snapshot_id: snapshotId || null }),
  }),

  // Unified YTD: Modified Dietz return + per-stock attribution in ONE call.
  // Today's total value is auto-extracted from the Account Positions CSV (sum
  // of all positions × current prices + money market).
  //
  // Optional inputs:
  //  • monthlyPerf*  — Investment Income Balance CSV (Fidelity Monthly
  //    Statement). When present, the server reads exact month-end balances
  //    for accurate chart + TWRR, AND uses its first-month "start" value as
  //    the Jan 1 begin_value if the user leaves that field blank.
  //  • beginValue    — Jan 1 portfolio total. May be null when monthlyPerf
  //    is provided; otherwise required.
  computeUnifiedYtd: async ({
    positionsUri, positionsName, positionsType,
    activityUri,  activityName,  activityType,
    monthlyPerfUri, monthlyPerfName, monthlyPerfType,
    beginValue,
  }) => {
    const [base, v2] = await Promise.all([getBaseUrl(), getV2Token()]);
    const fd = new FormData();
    fd.append('positions_file', {
      uri:  positionsUri,
      name: positionsName || 'positions.csv',
      type: positionsType || 'text/csv',
    });
    fd.append('activity_file', {
      uri:  activityUri,
      name: activityName || 'activity.csv',
      type: activityType || 'text/csv',
    });
    if (monthlyPerfUri) {
      fd.append('monthly_perf_file', {
        uri:  monthlyPerfUri,
        name: monthlyPerfName || 'monthly_perf.csv',
        type: monthlyPerfType || 'text/csv',
      });
    }
    if (beginValue != null && beginValue !== '' && Number(beginValue) > 0) {
      fd.append('begin_value', String(beginValue));
    }
    const headers = {};
    if (v2) headers['x-auth-v2-token'] = v2;
    const resp = await fetch(`${base}/api/track/live/ytd`, {
      method:  'POST',
      headers,
      body:    fd,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `${resp.status}`);
    }
    return resp.json();
  },

  // ---------- Fund Admin ----------
  // GP sessions reach these routes directly. fundId selects one book;
  // omit it to use the server default (DGA-I / FUND_ID env var).
  createFund: (payload) => request('/api/fund/admin/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  fundList: (fundType) => {
    const qs = fundType ? `?fund_type=${encodeURIComponent(fundType)}` : '';
    return request(`/api/fund/list${qs}`);
  },

  renameFund: (fundId, name, shortName) => request(
    `/api/v2/gp/fund/${encodeURIComponent(fundId)}/rename`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name, short_name: shortName }),
    },
  ),
  getYtdCache: (fundId) => request(
    `/api/fund/account/${encodeURIComponent(fundId)}/ytd-cache`,
  ),
  saveYtdCache: (fundId, nav, ytdPct, resultJson) => request(
    `/api/fund/account/${encodeURIComponent(fundId)}/ytd-cache`,
    {
      method: 'PUT',
      body: JSON.stringify({ nav, ytd_pct: ytdPct, result_json: resultJson }),
    },
  ),
  fundOverview: (fundId) => {
    const qs = fundId ? `?fund_id=${encodeURIComponent(fundId)}` : '';
    return request(`/api/fund/overview${qs}`);
  },
  fundLps: (fundId) => {
    const qs = fundId ? `?fund_id=${encodeURIComponent(fundId)}` : '';
    return request(`/api/fund/lps${qs}`);
  },
  fundPositions: (fundId) => {
    const qs = fundId ? `?fund_id=${encodeURIComponent(fundId)}` : '';
    return request(`/api/fund/positions${qs}`);
  },
  fundActivity: (fundId) => {
    const qs = fundId ? `?fund_id=${encodeURIComponent(fundId)}` : '';
    return request(`/api/fund/activity${qs}`);
  },
  fundWaterfall: (fundId) => {
    const qs = fundId ? `?fund_id=${encodeURIComponent(fundId)}` : '';
    return request(`/api/fund/waterfall${qs}`);
  },

  // Import Fidelity CSV positions for a fund.
  // fileUri / fileName / mimeType come from expo-document-picker.
  fundImportPositions: async ({ fileUri, fileName, mimeType, fundId }) => {
    const base = await getBaseUrl();
    const v2 = await getV2Token();
    const form = new FormData();
    form.append('file', { uri: fileUri, name: fileName || 'positions.csv', type: mimeType || 'text/csv' });
    if (fundId) form.append('fund_id', fundId);
    const resp = await fetch(`${base}/api/fund/import-positions`, {
      method: 'POST',
      headers: v2 ? { 'x-auth-v2-token': v2 } : {},
      body: form,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(txt || `HTTP ${resp.status}`);
    }
    return resp.json();
  },

  // Import cap table CSV/XLSX for a fund.
  fundImportCaptable: async ({ fileUri, fileName, mimeType, fundId }) => {
    const base = await getBaseUrl();
    const v2 = await getV2Token();
    const form = new FormData();
    form.append('file', { uri: fileUri, name: fileName || 'captable.csv', type: mimeType || 'text/csv' });
    if (fundId) form.append('fund_id', fundId);
    const resp = await fetch(`${base}/api/fund/import-captable`, {
      method: 'POST',
      headers: v2 ? { 'x-auth-v2-token': v2 } : {},
      body: form,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(txt || `HTTP ${resp.status}`);
    }
    return resp.json();
  },

  // Server build version (public — no auth required). Used by Settings to
  // show what's currently deployed and let the user verify the OTA update.
  getBuild: async () => {
    const base = await getBaseUrl();
    const resp = await fetch(`${base}/api/build?_t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error(`${resp.status}`);
    return resp.json();
  },

  // ---------- Batch quotes (avoids Yahoo rate limits) ----------
  getBatchQuotes: async (tickers) => {
    const list = (tickers || []).map((t) => String(t || '').trim().toUpperCase()).filter(Boolean);
    if (!list.length) return {};
    const qs = list.map(encodeURIComponent).join(',');
    const r = await v2Fetch(`/api/quotes?tickers=${qs}&_t=${Date.now()}`);
    if (!r.ok) throw new Error(`quotes ${r.status}`);
    const data = await r.json();
    if (data && data.quotes && typeof data.quotes === 'object') return data.quotes;
    return data && typeof data === 'object' ? data : {};
  },

  // ---------- Market Scan (independent ticker list) ----------
  getMarketScanTickers: async () => {
    const r = await v2Fetch('/api/scan/market-tickers');
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json(); // { tickers: [...] }
  },
  addMarketScanTicker: async (ticker) => {
    const r = await v2Fetch('/api/scan/market-tickers', {
      method: 'POST',
      body: JSON.stringify({ ticker }),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  removeMarketScanTicker: async (ticker) => {
    const r = await v2Fetch(`/api/scan/market-tickers/${encodeURIComponent(ticker)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  startMarketScan: async () => {
    const r = await v2Fetch('/api/scan/market', { method: 'POST' });
    if (!r.ok) { const e = await r.json().catch(()=>{}); throw new Error(e?.detail || `${r.status}`); }
    return r.json();
  },

  // ---------- Archived reports ----------
  getArchivedReports: async () => {
    const r = await v2Fetch('/api/reports/archived');
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  restoreReport: async (ticker) => {
    const r = await v2Fetch(`/api/reports/${encodeURIComponent(ticker)}/restore`, { method: 'POST' });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  restoreAllReports: async () => {
    const r = await v2Fetch('/api/reports/restore-all', { method: 'POST' });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },

  // ---------- Automation settings ----------
  getAutomationSettings: async () => {
    const r = await v2Fetch('/api/automation/settings');
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
  saveAutomationSettings: async (settings) => {
    const r = await v2Fetch('/api/automation/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  },
};

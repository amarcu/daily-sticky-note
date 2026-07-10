import { QUOTES } from './quotes.js';
import { LANGS, LANG_NAMES, TRANSLATIONS, LEVEL_THRESHOLDS, LEVEL_NAMES } from './i18n.js';
import { burst } from './fx.js';

const FIREBASE_CONFIG_KEY = 'stickyPlanner.firebaseConfig';
const LOCAL_TASKS_KEY = 'stickyPlanner.localTasks';
const SYNC_KEY = 'stickyPlanner.syncCode';
const POS_KEY = 'stickyPlanner.position';
const NOTIF_KEY = 'stickyPlanner.notifEnabled';
const LANG_KEY = 'stickyPlanner.lang';
const POINTS_KEY = 'stickyPlanner.points';
const AWARDED_KEY = 'stickyPlanner.awarded';
const QUOTE_CACHE_KEY = 'stickyPlanner.quoteCache';
const QUOTE_REFRESHED_KEY = 'stickyPlanner.quoteRefreshedAt';
const FIREBASE_SDK_VERSION = '12.15.0';

const POINTS_PER_TASK = 10;
// Only try to top up the quote pool every few days, and only for English (the
// public API is English) - the bundled sets already cover every language.
const QUOTE_REFRESH_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
const QUOTE_API = 'https://dummyjson.com/quotes?limit=30';
const QUOTE_CACHE_CAP = 200;

const dateLabel = document.getElementById('dateLabel');
const note = document.getElementById('note');
const dragHandle = document.getElementById('dragHandle');
const notifBtn = document.getElementById('notifBtn');
const syncBtn = document.getElementById('syncBtn');
const hideBtn = document.getElementById('hideBtn');
const syncPanel = document.getElementById('syncPanel');
const langSelect = document.getElementById('langSelect');
const localOnlyView = document.getElementById('localOnlyView');
const cloudView = document.getElementById('cloudView');
const showConnectFormBtn = document.getElementById('showConnectFormBtn');
const connectForm = document.getElementById('connectForm');
const firebaseConfigInput = document.getElementById('firebaseConfigInput');
const saveFirebaseConfigBtn = document.getElementById('saveFirebaseConfigBtn');
const configError = document.getElementById('configError');
const disconnectCloudBtn = document.getElementById('disconnectCloudBtn');
const syncCodeDisplay = document.getElementById('syncCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const connectInput = document.getElementById('connectInput');
const connectBtn = document.getElementById('connectBtn');
const syncStatus = document.getElementById('syncStatus');
const taskInput = document.getElementById('taskInput');
const timeInput = document.getElementById('timeInput');
const addBtn = document.getElementById('addBtn');
const taskList = document.getElementById('taskList');
const emptyMsg = document.getElementById('emptyMsg');
const dailyQuote = document.getElementById('dailyQuote');
const scoreBar = document.getElementById('scoreBar');
const levelName = document.getElementById('levelName');
const pointsLabel = document.getElementById('pointsLabel');
const progressFill = document.getElementById('progressFill');
const toNextLabel = document.getElementById('toNextLabel');
const toast = document.getElementById('toast');
const updateBanner = document.getElementById('updateBanner');
const updateText = document.getElementById('updateText');
const updateBtn = document.getElementById('updateBtn');

// Desktop build detection. The Tauri shell exposes a global `window.__TAURI__`
// object (we opt into this with `withGlobalTauri` in tauri.conf.json); the plain
// browser build has neither and runs as an in-page sticky note on a desk.
const isDesktop = typeof window.__TAURI__ !== 'undefined';
if (isDesktop) document.documentElement.classList.add('desktop-mode');

let tasks = [];
let points = 0;
let awardedIds = new Set();
let justAddedId = null; // task id to play the "spring in" animation for, once
let notifEnabled = false;
let applyingRemoteUpdate = false;
let saveTimer = null;
let unsubscribeSnapshot = null;
const notifiedIds = new Set();

let cloudEnabled = false;
let db = null;
let _doc, _setDoc, _onSnapshot, _serverTimestamp;

// ---- Language / i18n --------------------------------------------------------

function detectLang() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved && LANGS.includes(saved)) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGS.includes(nav) ? nav : 'en';
}

let lang = detectLang();

// Look up a translated string, filling {placeholders}. Falls back to English,
// then to the raw key, so a missing entry never renders blank.
function t(key, vars) {
  const table = TRANSLATIONS[lang] || TRANSLATIONS.en;
  let s = (table && table[key] != null) ? table[key] : (TRANSLATIONS.en[key] != null ? TRANSLATIONS.en[key] : key);
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
}

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const v = t(el.dataset.i18nTitle);
    el.title = v;
    el.setAttribute('aria-label', v);
  });
}

function applyLanguage() {
  document.documentElement.lang = lang;
  if (langSelect) langSelect.value = lang;
  applyStaticTranslations();
  dateLabel.textContent = new Date().toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' });
  updateNotifButton();
  renderScore();
  pickDailyQuote();
}

function setLanguage(l) {
  lang = LANGS.includes(l) ? l : 'en';
  localStorage.setItem(LANG_KEY, lang);
  applyLanguage();
}

if (langSelect) {
  LANGS.forEach((l) => {
    const o = document.createElement('option');
    o.value = l;
    o.textContent = LANG_NAMES[l];
    langSelect.appendChild(o);
  });
  langSelect.addEventListener('change', () => setLanguage(langSelect.value));
}

// ---- Notifications ----------------------------------------------------------

// Notifications route through the OS on desktop (the Tauri shell owns a real
// notification permission and center) and through the Web Notifications API in
// the browser. Both paths are wrapped so the rest of the app doesn't care which
// build it's running in.
async function requestNotifPermission() {
  if (isDesktop) return true; // the desktop OS surfaces notifications directly
  if (!('Notification' in window)) return null; // browser can't do it at all
  return (await Notification.requestPermission()) === 'granted';
}

function fireNotification(title, body) {
  if (isDesktop) {
    window.__TAURI__.core.invoke('notify', { title, body }).catch((e) => console.error('Notification failed', e));
    return;
  }
  try {
    new Notification(title, { body });
  } catch (e) {
    console.error('Notification failed', e);
  }
}

// Keeps the bell's look, tooltip, and saved state in sync with `notifEnabled`
// so it reads clearly as an on/off toggle.
function updateNotifButton() {
  notifBtn.classList.toggle('active', notifEnabled);
  const label = notifEnabled ? t('notifOn') : t('notifOff');
  notifBtn.title = label;
  notifBtn.setAttribute('aria-label', label);
  notifBtn.setAttribute('aria-pressed', String(notifEnabled));
  localStorage.setItem(NOTIF_KEY, notifEnabled ? '1' : '0');
}

// ---- Points & levels --------------------------------------------------------

function levelInfo(pts) {
  let index = 0;
  for (let k = 0; k < LEVEL_THRESHOLDS.length; k++) {
    if (pts >= LEVEL_THRESHOLDS[k]) index = k;
  }
  const isMax = index >= LEVEL_THRESHOLDS.length - 1;
  const cur = LEVEL_THRESHOLDS[index];
  const next = isMax ? cur : LEVEL_THRESHOLDS[index + 1];
  return { index, cur, next, isMax };
}

function renderScore() {
  if (!scoreBar) return;
  const info = levelInfo(points);
  const names = LEVEL_NAMES[lang] || LEVEL_NAMES.en;
  levelName.textContent = names[info.index];
  pointsLabel.textContent = t('points', { n: points });
  if (info.isMax) {
    progressFill.style.width = '100%';
    toNextLabel.textContent = t('maxLevel');
  } else {
    const pct = Math.round(((points - info.cur) / (info.next - info.cur)) * 100);
    progressFill.style.width = `${pct}%`;
    toNextLabel.textContent = t('toNext', { n: info.next - points, lvl: info.index + 2 });
  }
}

let toastTimer = null;
function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// Award a task once, ever (tracked by id so ticking it off, unticking, and
// re-ticking can't farm points). Celebrates when the award crosses a level.
function awardTask(id) {
  if (awardedIds.has(id)) return;
  const before = levelInfo(points).index;
  awardedIds.add(id);
  points += POINTS_PER_TASK;
  const after = levelInfo(points).index;
  renderScore();
  if (after > before) {
    const names = LEVEL_NAMES[lang] || LEVEL_NAMES.en;
    showToast(`${t('levelUp')} ${names[after]}`);
    // Bigger celebratory burst from the middle of the note on a level-up.
    const nr = note.getBoundingClientRect();
    burst(nr.left + nr.width / 2, nr.top + nr.height * 0.45, 52, 2.2);
  }
}

// ---- Daily quote (bundled sets, optionally topped up in the background) ------

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

function loadQuoteCache() {
  try {
    const raw = localStorage.getItem(QUOTE_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function quotesForLang(l) {
  const base = QUOTES[l] || QUOTES.en;
  // The background refresh only fetches English, so only the English pool grows.
  const pool = l === 'en' ? base.concat(loadQuoteCache()) : base.slice();
  return [...new Set(pool)];
}

function pickDailyQuote() {
  if (!dailyQuote) return;
  const pool = quotesForLang(lang);
  if (!pool.length) return;
  dailyQuote.textContent = pool[dayOfYear(new Date()) % pool.length];
}

// Try to grow the English pool from a public API. Deliberately swallows every
// error: no network, API down, bad payload - all just leave the bundle in place.
async function refreshQuotes() {
  try {
    const last = Number(localStorage.getItem(QUOTE_REFRESHED_KEY)) || 0;
    if (Date.now() - last < QUOTE_REFRESH_EVERY_MS) return;
    localStorage.setItem(QUOTE_REFRESHED_KEY, String(Date.now())); // throttle even if this attempt fails

    const skip = Math.floor(Math.random() * 1400);
    const res = await fetch(`${QUOTE_API}&skip=${skip}`);
    if (!res.ok) return;
    const data = await res.json();
    const incoming = (data.quotes || [])
      .map((q) => (q && typeof q.quote === 'string' ? q.quote.trim() : ''))
      .filter((s) => s.length >= 8 && s.length <= 90 && !s.includes('\n'));
    if (!incoming.length) return;

    const merged = [...new Set(loadQuoteCache().concat(incoming))].slice(-QUOTE_CACHE_CAP);
    localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(merged));
    pickDailyQuote(); // a freshly fetched line can show up right away
  } catch (e) {
    // silent by design
  }
}

// ---- Local-only storage (used whenever cloud sync isn't configured) ----

function loadLocalTasks() {
  try {
    const raw = localStorage.getItem(LOCAL_TASKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Could not read local tasks', e);
    return [];
  }
}

function loadLocalAwarded() {
  try {
    const raw = localStorage.getItem(AWARDED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveLocalState() {
  localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
  localStorage.setItem(POINTS_KEY, String(points));
  localStorage.setItem(AWARDED_KEY, JSON.stringify([...awardedIds]));
}

// ---- Cloud sync (only loaded/used if the person connects a Firebase project) ----

function loadFirebaseConfig() {
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Could not read saved Firebase config', e);
    return null;
  }
}

function getSyncCode() {
  let code = localStorage.getItem(SYNC_KEY);
  if (!code) {
    code = crypto.randomUUID();
    localStorage.setItem(SYNC_KEY, code);
  }
  return code;
}

let syncCode = getSyncCode();

function setSyncStatus(text) {
  syncStatus.textContent = text;
}

function subscribeToSync() {
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  syncCodeDisplay.textContent = syncCode;
  setSyncStatus(t('connecting'));
  const ref = _doc(db, 'lists', syncCode);
  unsubscribeSnapshot = _onSnapshot(
    ref,
    (snap) => {
      applyingRemoteUpdate = true;
      if (snap.exists()) {
        const data = snap.data();
        tasks = data.tasks || [];
        // Points only ever climb: take the higher score and the union of
        // awarded task ids so a last-write-wins sync can't erase progress.
        points = Math.max(points, data.points || 0);
        awardedIds = new Set([...awardedIds, ...(data.awarded || [])]);
      } else {
        // First time this sync code has been used - seed the cloud list from
        // whatever was on this device locally, so switching on sync doesn't
        // look like it wiped the list (points/awarded are already loaded).
        tasks = loadLocalTasks();
      }
      render();
      renderScore();
      applyingRemoteUpdate = false;
      setSyncStatus(t('synced'));
      if (!snap.exists() && (tasks.length || points)) saveNow();
    },
    (err) => {
      console.error('Sync error', err);
      setSyncStatus(t('syncError'));
    }
  );
}

async function enableCloudSync(config) {
  const [{ initializeApp }, authMod, firestoreMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`),
  ]);

  _doc = firestoreMod.doc;
  _setDoc = firestoreMod.setDoc;
  _onSnapshot = firestoreMod.onSnapshot;
  _serverTimestamp = firestoreMod.serverTimestamp;

  const firebaseApp = initializeApp(config);
  const auth = authMod.getAuth(firebaseApp);
  db = firestoreMod.getFirestore(firebaseApp);
  cloudEnabled = true;

  authMod.onAuthStateChanged(auth, (user) => {
    if (user) subscribeToSync();
  });
  await authMod.signInAnonymously(auth);
}

function connectToCode(newCode) {
  newCode = newCode.trim();
  if (!newCode || newCode === syncCode) return;
  localStorage.setItem(SYNC_KEY, newCode);
  syncCode = newCode;
  connectInput.value = '';
  subscribeToSync();
}

// ---- Save (routes to Firestore or localStorage depending on mode) ----

function scheduleSave() {
  if (applyingRemoteUpdate) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  if (cloudEnabled) {
    try {
      await _setDoc(_doc(db, 'lists', syncCode), {
        tasks,
        points,
        awarded: [...awardedIds],
        updatedAt: _serverTimestamp(),
      });
    } catch (e) {
      console.error('Save failed', e);
      setSyncStatus(t('saveError'));
    }
  } else {
    saveLocalState();
  }
}

// ---- Sync panel UI ----

syncBtn.addEventListener('click', () => {
  syncPanel.hidden = !syncPanel.hidden;
});

showConnectFormBtn.addEventListener('click', () => {
  connectForm.hidden = !connectForm.hidden;
});

// Firebase's console shows you a JS object literal (unquoted keys, a
// `const firebaseConfig = ... ;` wrapper, sometimes single quotes) -
// not strict JSON. Rather than make people hand-edit what they copied,
// tolerate that shape and convert it before parsing.
function parseFirebaseConfigInput(raw) {
  let text = raw.trim();
  const match = text.match(/{[\s\S]*}/);
  if (match) text = match[0];
  text = text
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z0-9_$]+)(\s*:)/g, '$1"$2"$3')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(text);
}

saveFirebaseConfigBtn.addEventListener('click', () => {
  configError.hidden = true;
  let parsed;
  try {
    parsed = parseFirebaseConfigInput(firebaseConfigInput.value);
  } catch (e) {
    configError.textContent = t('configErrRead');
    configError.hidden = false;
    return;
  }
  if (!parsed.apiKey || !parsed.projectId) {
    configError.textContent = t('configErrMissing');
    configError.hidden = false;
    return;
  }
  localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(parsed));
  location.reload();
});

disconnectCloudBtn.addEventListener('click', () => {
  if (!confirm(t('disconnectConfirm'))) return;
  saveLocalState();
  localStorage.removeItem(FIREBASE_CONFIG_KEY);
  location.reload();
});

copyCodeBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(syncCode);
    copyCodeBtn.textContent = t('copied');
    setTimeout(() => (copyCodeBtn.textContent = t('copy')), 1200);
  } catch (e) {
    console.error('Copy failed', e);
  }
});

connectBtn.addEventListener('click', () => connectToCode(connectInput.value));
connectInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectToCode(connectInput.value);
});

// ---- Task list ----

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}

function currentHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function render() {
  taskList.innerHTML = '';
  emptyMsg.style.display = tasks.length ? 'none' : 'block';
  const nowStr = currentHHMM();

  const sorted = tasks.slice().sort((a, b) => (a.time || 'zz').localeCompare(b.time || 'zz'));

  sorted.forEach((task) => {
    const isDue = !task.done && task.time && task.time <= nowStr;

    if (isDue && notifEnabled && !notifiedIds.has(task.id)) {
      notifiedIds.add(task.id);
      fireNotification(t('taskDue'), task.text);
    }

    const row = document.createElement('div');
    row.className = 'task-row' + (isDue ? ' due' : '') + (task.done ? ' done' : '');
    // Spring the freshly-added row in, once (render() rebuilds every row, so
    // gate it on the id to avoid replaying on every re-render).
    if (task.id === justAddedId) {
      row.classList.add('row-enter');
      justAddedId = null;
    }

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = task.done;
    cb.setAttribute('aria-label', `${task.text}`);
    cb.addEventListener('change', () => {
      task.done = cb.checked;
      if (cb.checked) {
        // Confetti from the checkbox itself (grab its spot before render() wipes it).
        const r = cb.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, 28, 1.5);
        awardTask(task.id);
      }
      render();
      scheduleSave();
    });

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;

    row.appendChild(cb);
    row.appendChild(text);

    if (task.time) {
      const time = document.createElement('span');
      time.className = 'task-time';
      time.textContent = fmtTime(task.time);
      row.appendChild(time);
    }

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.type = 'button';
    del.setAttribute('aria-label', `delete: ${task.text}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener('click', () => {
      tasks = tasks.filter((x) => x.id !== task.id);
      render();
      scheduleSave();
    });
    row.appendChild(del);

    taskList.appendChild(row);
  });
}

addBtn.addEventListener('click', () => {
  const text = taskInput.value.trim();
  if (!text) return;
  const id = crypto.randomUUID();
  tasks.push({ id, text, time: timeInput.value, done: false });
  justAddedId = id;
  taskInput.value = '';
  timeInput.value = '';
  render();
  scheduleSave();
  taskInput.focus();
  // Quick press-pop on the button for a bit of feedback.
  addBtn.animate(
    [{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }],
    { duration: 180, easing: 'ease-out' }
  );
});

taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBtn.click();
});

notifBtn.addEventListener('click', async () => {
  // Already on -> turn it back off. This is the path that was missing before:
  // the bell could only ever switch on.
  if (notifEnabled) {
    notifEnabled = false;
    updateNotifButton();
    return;
  }
  const granted = await requestNotifPermission();
  if (granted === null) {
    alert(t('notSupported'));
    return;
  }
  notifEnabled = granted; // stays off if the browser/OS denied permission
  updateNotifButton();
});

setInterval(render, 15000);

// ---- Dragging (web: in-page pointer drag; desktop: native OS window drag) ----

if (isDesktop) {
  const appWindow = window.__TAURI__.window.getCurrentWindow();
  // The "x" icon (desktop-only) hides the window to the tray; there's no
  // titlebar to close it from, and closing would quit a background widget.
  hideBtn.addEventListener('click', () => appWindow.hide());
  // Drag the whole window by its header, but not when the press lands on one
  // of the action buttons - the OS moves the real window here, not a div.
  // While dragging, the note "lifts" (scale + deeper shadow) and springs back
  // to rest when you let go, like picking a real sticky off the desk.
  let liftSafety = null;
  const settle = () => {
    clearTimeout(liftSafety);
    note.classList.remove('lifting');
  };
  dragHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.header-actions')) return;
    note.classList.add('lifting');
    // Native drag may not deliver pointerup to us, so guarantee a settle.
    clearTimeout(liftSafety);
    liftSafety = setTimeout(settle, 4000);
    appWindow.startDragging();
  });
  window.addEventListener('pointerup', settle);
  window.addEventListener('pointercancel', settle);

  // Keep the window exactly as tall as the note's content (which grows and
  // shrinks as tasks, the sync panel, or the level bar change), so there are
  // never page scrollbars and never empty transparent space below the note.
  const { LogicalSize } = window.__TAURI__.window;
  const WINDOW_WIDTH = 320;
  let lastHeight = 0;
  const fitWindow = () => {
    const h = Math.ceil(document.documentElement.scrollHeight);
    if (!h || h === lastHeight) return;
    lastHeight = h;
    appWindow.setSize(new LogicalSize(WINDOW_WIDTH, h)).catch((e) => console.error('resize failed', e));
  };
  new ResizeObserver(fitWindow).observe(document.body);

  // On launch, ask whether a newer release exists; if so, show a banner that
  // downloads, installs, and relaunches into it on one click (all handled on
  // the Rust side). Silent if offline or the check fails.
  const invoke = window.__TAURI__.core.invoke;
  invoke('check_update')
    .then((version) => {
      if (!version) return;
      updateText.textContent = t('updateReady', { v: version });
      updateBtn.textContent = t('updateNow');
      updateBanner.hidden = false;
    })
    .catch((e) => console.error('update check failed', e));

  updateBtn.addEventListener('click', async () => {
    updateBtn.disabled = true;
    updateText.textContent = t('updating');
    try {
      await invoke('install_update'); // relaunches on success
    } catch (e) {
      console.error('update failed', e);
      updateText.textContent = t('updateFailed');
      updateBtn.disabled = false;
    }
  });
} else {
  function clampPosition(pos) {
    const maxLeft = Math.max(0, window.innerWidth - note.offsetWidth - 8);
    const maxTop = Math.max(0, window.innerHeight - note.offsetHeight - 8);
    return {
      left: Math.min(Math.max(pos.left, 8), maxLeft),
      top: Math.min(Math.max(pos.top, 8), maxTop),
    };
  }

  function loadPosition() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error(e);
    }
    return { top: 24, left: 24 };
  }

  function savePosition(pos) {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  }

  const startPos = clampPosition(loadPosition());
  note.style.top = `${startPos.top}px`;
  note.style.left = `${startPos.left}px`;

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  dragHandle.addEventListener('pointerdown', (e) => {
    if (window.innerWidth <= 520) return;
    dragging = true;
    note.classList.add('dragging');
    const rect = note.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    dragHandle.setPointerCapture(e.pointerId);
  });

  dragHandle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const pos = clampPosition({ left: e.clientX - offsetX, top: e.clientY - offsetY });
    note.style.left = `${pos.left}px`;
    note.style.top = `${pos.top}px`;
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    note.classList.remove('dragging');
    savePosition({ top: parseInt(note.style.top, 10), left: parseInt(note.style.left, 10) });
  }

  dragHandle.addEventListener('pointerup', endDrag);
  dragHandle.addEventListener('pointercancel', endDrag);
}

// ---- Fade the note back a little while the app isn't focused, so it sits
// quietly over whatever you're working on and snaps to full opacity the moment
// you focus or hover it. ----

function setFocused(focused) {
  document.documentElement.classList.toggle('unfocused', !focused);
}

if (isDesktop) {
  window.__TAURI__.window
    .getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => setFocused(focused))
    .catch((e) => console.error('Could not watch window focus', e));
} else {
  window.addEventListener('focus', () => setFocused(true));
  window.addEventListener('blur', () => setFocused(false));
}

// ---- Startup ----------------------------------------------------------------

// Reminders toggle (saved per device). In the browser, drop it if the
// notification permission was revoked since last time so the bell doesn't claim
// to be on when it can't actually fire.
notifEnabled = localStorage.getItem(NOTIF_KEY) === '1';
if (notifEnabled && !isDesktop && 'Notification' in window && Notification.permission !== 'granted') {
  notifEnabled = false;
}

// Points/awarded load locally first; cloud mode merges on top of these.
points = Number(localStorage.getItem(POINTS_KEY)) || 0;
awardedIds = new Set(loadLocalAwarded());

applyLanguage(); // paints every translated string, the date, the bell, and the score

const savedFirebaseConfig = loadFirebaseConfig();
if (savedFirebaseConfig) {
  localOnlyView.hidden = true;
  cloudView.hidden = false;
  enableCloudSync(savedFirebaseConfig).catch((e) => {
    console.error('Cloud sync failed to start', e);
    setSyncStatus(t('cloudStartError'));
  });
} else {
  localOnlyView.hidden = false;
  cloudView.hidden = true;
  tasks = loadLocalTasks();
}

render();
refreshQuotes(); // fire-and-forget; silently no-ops if throttled or offline

import { QUOTES } from './quotes.js';
import { LANGS, LANG_NAMES, TRANSLATIONS, LEVEL_THRESHOLDS, LEVEL_NAMES } from './i18n.js';
import { burst } from './fx.js';

const FIREBASE_CONFIG_KEY = 'stickyPlanner.firebaseConfig';
const LOCAL_TASKS_KEY = 'stickyPlanner.localTasks';
const SYNC_KEY = 'stickyPlanner.syncCode';
const POS_KEY = 'stickyPlanner.position';
const NOTIF_KEY = 'stickyPlanner.notifEnabled';
const LANG_KEY = 'stickyPlanner.lang';
const COMPACT_KEY = 'stickyPlanner.compact';
const TIMER_KEY = 'stickyPlanner.timer';
const POINTS_KEY = 'stickyPlanner.points';
const AWARDED_KEY = 'stickyPlanner.awarded';
const QUOTE_CACHE_KEY = 'stickyPlanner.quoteCache2'; // v2: per-language, curated source
const QUOTE_REFRESHED_KEY = 'stickyPlanner.quoteRefreshedAt';
const FIREBASE_SDK_VERSION = '12.15.0';

const POINTS_PER_TASK = 10;
// Only try to top up the quote pool every few days, and only for English (the
// public API is English) - the bundled sets already cover every language.
const QUOTE_REFRESH_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
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
const collapseBtn = document.getElementById('collapseBtn');
const compactCount = document.getElementById('compactCount');
const startupRow = document.getElementById('startupRow');
const startupHint = document.getElementById('startupHint');
const autostartToggle = document.getElementById('autostartToggle');
const notifSettingsRow = document.getElementById('notifSettingsRow');
const notifSettingsBtn = document.getElementById('notifSettingsBtn');
const timer = document.getElementById('timer');
const timerIdle = document.getElementById('timerIdle');
const timerRun = document.getElementById('timerRun');
const timerDisplay = document.getElementById('timerDisplay');
const timerToggle = document.getElementById('timerToggle');
const timerReset = document.getElementById('timerReset');
const timerBadge = document.getElementById('timerBadge');
const timerTask = document.getElementById('timerTask');
const timerDonePanel = document.getElementById('timerDonePanel');
const timerDoneTask = document.getElementById('timerDoneTask');
const doneMarkBtn = document.getElementById('doneMarkBtn');
const doneBreakBtn = document.getElementById('doneBreakBtn');
const doneNextBtn = document.getElementById('doneNextBtn');
const doneCloseBtn = document.getElementById('doneCloseBtn');
const wheelH = document.getElementById('wheelH');
const wheelM = document.getElementById('wheelM');
const timerStart = document.getElementById('timerStart');

// Desktop build detection. The Tauri shell exposes a global `window.__TAURI__`
// object (we opt into this with `withGlobalTauri` in tauri.conf.json); the plain
// browser build has neither and runs as an in-page sticky note on a desk.
const isDesktop = typeof window.__TAURI__ !== 'undefined';
if (isDesktop) document.documentElement.classList.add('desktop-mode');

let tasks = [];
let points = 0;
let awardedIds = new Set();
let justAddedId = null; // task id to play the "spring in" animation for, once
let sortDragActive = false; // a task row is being drag-sorted (render() pauses)
let compact = false; // collapsed to just the header bar
let onCompactToggle = null; // desktop hook: resize the window to match the collapse
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
  applyCompact(); // re-apply the collapse label + count in the new language
  if (typeof updateTimerUI === 'function') updateTimerUI(); // re-label pause/resume
}

function setLanguage(l) {
  lang = LANGS.includes(l) ? l : 'en';
  localStorage.setItem(LANG_KEY, lang);
  applyLanguage();
}

// ---- Compact / expand -------------------------------------------------------

// The compact badge shows how many tasks are still open.
function updateCompactCount() {
  if (!compactCount) return;
  const open = tasks.filter((task) => !task.done).length;
  compactCount.textContent = t('tasksLeft', { n: open });
}

function setCollapseLabel() {
  if (!collapseBtn) return;
  const label = compact ? t('expand') : t('collapse');
  collapseBtn.title = label;
  collapseBtn.setAttribute('aria-label', label);
  collapseBtn.setAttribute('aria-expanded', String(!compact));
}

// Set the collapsed/expanded state WITHOUT animating (startup, language change).
function applyCompact() {
  note.classList.toggle('compact', compact);
  const body = document.getElementById('noteBody');
  if (body) {
    body.style.transition = 'none';
    body.style.maxHeight = compact ? '0px' : '';
    void body.offsetHeight; // flush, then let transitions resume
    body.style.transition = '';
  }
  setCollapseLabel();
  updateCompactCount();
  localStorage.setItem(COMPACT_KEY, compact ? '1' : '0');
}

// Animated toggle: max-height tweens between the content height and 0, so it
// works smoothly in every webview (the grid-rows trick doesn't animate in some).
function toggleCompact() {
  const body = document.getElementById('noteBody');
  compact = !compact;
  note.classList.toggle('compact', compact);
  setCollapseLabel();
  updateCompactCount();
  localStorage.setItem(COMPACT_KEY, compact ? '1' : '0');
  if (!body) return;
  if (compact) {
    body.style.maxHeight = `${body.scrollHeight}px`;
    void body.offsetHeight;
    body.style.maxHeight = '0px';
  } else {
    body.style.maxHeight = '0px';
    void body.offsetHeight;
    body.style.maxHeight = `${body.scrollHeight}px`;
    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') return;
      body.removeEventListener('transitionend', onEnd);
      if (!compact) body.style.maxHeight = ''; // release so it can grow freely
    };
    body.addEventListener('transitionend', onEnd);
  }
  if (onCompactToggle) onCompactToggle(compact); // desktop: resize the window too
}

if (collapseBtn) {
  collapseBtn.addEventListener('click', toggleCompact);
}

// Double-clicking the header (anywhere but the action buttons) also toggles
// compact - a reliable fallback for expanding if the button is ever out of view.
dragHandle.addEventListener('dblclick', (e) => {
  if (e.target.closest('.header-actions')) return;
  toggleCompact();
});

// ---- Focus timer -----------------------------------------------------------

const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>';

let timerInterval = null;
let timerEndsAt = 0; // ms timestamp when it fires (while running)
let timerRemainingMs = 0; // remaining when paused
let timerActive = false; // a session exists (running or paused)
let timerRunning = false; // actively counting down
let timerTotalMin = 0; // for restoring the chip that was chosen
let timerTaskId = null; // task this session is for (null = free-standing session)
let timerKind = 'focus'; // 'focus' | 'break'
let timerDoneInfo = null; // {taskId} while the end-of-session prompt is showing

function fmtClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function timerRemaining() {
  return timerRunning ? timerEndsAt - Date.now() : timerRemainingMs;
}

function persistTimer() {
  if (!timerActive) {
    localStorage.removeItem(TIMER_KEY);
    return;
  }
  localStorage.setItem(
    TIMER_KEY,
    JSON.stringify({
      running: timerRunning,
      endsAt: timerEndsAt,
      remainingMs: timerRemainingMs,
      totalMin: timerTotalMin,
      taskId: timerTaskId,
      kind: timerKind,
    })
  );
}

function focusTaskById(id) {
  return id ? tasks.find((x) => x.id === id) || null : null;
}

function updateTimerUI() {
  if (!timer) return;
  timerIdle.hidden = timerActive || !!timerDoneInfo;
  timerRun.hidden = !timerActive;
  timerDonePanel.hidden = timerActive || !timerDoneInfo;
  // When a timer is running its badge takes the header slot, so the task count
  // steps aside (both + the buttons won't fit the narrow compact bar).
  note.classList.toggle('timer-on', timerActive);
  const label = fmtClock(timerRemaining());
  timerDisplay.textContent = label;
  timerBadge.textContent = label;
  timerBadge.hidden = !timerActive;
  // What this session is for: the task's text, or "Break".
  const focusTask = focusTaskById(timerTaskId);
  const what = timerKind === 'break' ? t('breakLabel') : focusTask ? focusTask.text : '';
  timerTask.textContent = what;
  timerTask.hidden = !what;
  timerRun.classList.toggle('paused', timerActive && !timerRunning);
  timerToggle.innerHTML = timerRunning ? ICON_PAUSE : ICON_PLAY;
  const ttl = timerRunning ? t('timerPause') : t('timerResume');
  timerToggle.title = ttl;
  timerToggle.setAttribute('aria-label', ttl);
}

function timerTick() {
  if (!timerRunning) return;
  if (timerEndsAt - Date.now() <= 0) {
    completeTimer();
    return;
  }
  const label = fmtClock(timerRemaining());
  timerDisplay.textContent = label;
  timerBadge.textContent = label;
}

function startTimer(minutes, opts = {}) {
  timerTotalMin = minutes;
  timerRemainingMs = minutes * 60000;
  timerEndsAt = Date.now() + timerRemainingMs;
  timerActive = true;
  timerRunning = true;
  timerTaskId = opts.taskId || null;
  timerKind = opts.kind || 'focus';
  timerDoneInfo = null;
  clearInterval(timerInterval);
  timerInterval = setInterval(timerTick, 250);
  persistTimer();
  updateTimerUI();
  render(); // highlight the focused task's row
  // Pulse the widget so the eye lands where the session just started (it lives
  // at the bottom, easy to miss when starting from a task row up top).
  if (timer) {
    timer.classList.remove('pulse');
    void timer.offsetWidth; // restart the animation if it was mid-run
    timer.classList.add('pulse');
  }
  // Make sure we're allowed to notify at the end (browser prompt on the web).
  requestNotifPermission();
}

function pauseTimer() {
  if (!timerRunning) return;
  timerRemainingMs = Math.max(0, timerEndsAt - Date.now());
  timerRunning = false;
  clearInterval(timerInterval);
  timerInterval = null;
  persistTimer();
  updateTimerUI();
}

function resumeTimer() {
  if (timerRunning || !timerActive) return;
  timerEndsAt = Date.now() + timerRemainingMs;
  timerRunning = true;
  clearInterval(timerInterval);
  timerInterval = setInterval(timerTick, 250);
  persistTimer();
  updateTimerUI();
}

function resetTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerActive = false;
  timerRunning = false;
  timerRemainingMs = 0;
  timerEndsAt = 0;
  timerTaskId = null;
  timerKind = 'focus';
  timerDoneInfo = null;
  persistTimer();
  updateTimerUI();
  render(); // clear the focused-row highlight
  requestAnimationFrame(applyPick); // wheels are visible again - restore the pick
}

function completeTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerActive = false;
  timerRunning = false;
  const wasBreak = timerKind === 'break';
  const doneTask = focusTaskById(timerTaskId);
  timerTaskId = null;
  persistTimer();
  if (wasBreak) {
    // Break's over: back to the picker, nudge to choose the next task.
    timerKind = 'focus';
    fireNotification(t('breakDoneTitle'), t('breakDoneBody'));
    updateTimerUI();
    requestAnimationFrame(applyPick);
  } else {
    // Focus session over: name the task in the alert and offer the next step
    // (mark done / take a break / focus the next task).
    const body = doneTask ? t('timerDoneTaskBody', { task: doneTask.text }) : t('timerDoneBody');
    fireNotification(t('timerDone'), body);
    timerDoneInfo = { taskId: doneTask ? doneTask.id : null };
    updateDonePanel();
    updateTimerUI();
  }
  render(); // clear the focused-row highlight
  // Burst from the note's upper-middle (not the timer at the very bottom, where
  // particles would just fall off the edge).
  const nr = note.getBoundingClientRect();
  burst(nr.left + nr.width / 2, nr.top + nr.height * 0.4, 36, 1.9);
}

// ---- Duration wheel picker (iOS Clock-style spinner drum) ----
const WHEEL_ITEM_H = 30;
const WHEEL_HOURS = 13; // 0..12
const WHEEL_MINS = 60; // 0..59
const TIMER_PICK_KEY = 'stickyPlanner.timerPick';

function buildWheel(el, count) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.textContent = String(i).padStart(2, '0');
    frag.appendChild(item);
  }
  el.appendChild(frag);
}

function wheelValue(el) {
  return Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H));
}

// Curve each number away from the centered row so it reads as a rolling drum.
function updateWheel3D(el) {
  const center = el.scrollTop / WHEEL_ITEM_H;
  const items = el.children;
  for (let i = 0; i < items.length; i++) {
    const dist = i - center;
    const ad = Math.abs(dist);
    if (ad > 3.4) {
      items[i].style.opacity = '0';
      continue;
    }
    const rot = Math.max(-70, Math.min(70, dist * -22));
    items[i].style.transform = `rotateX(${rot}deg)`;
    items[i].style.opacity = String(Math.max(0.12, 1 - ad * 0.32));
  }
}

function setWheel(el, val) {
  el.scrollTop = val * WHEEL_ITEM_H;
  updateWheel3D(el);
}

function attachWheel(el, count) {
  buildWheel(el, count);
  let raf = 0;
  el.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateWheel3D(el);
      });
    },
    { passive: true }
  );
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const next = wheelValue(el) + (e.key === 'ArrowDown' ? 1 : -1);
    setWheel(el, Math.max(0, Math.min(count - 1, next)));
  });
}

// Restore the last picked duration (default 25 min) into the wheels.
function applyPick() {
  if (!wheelH || !wheelM) return;
  let pick = { h: 0, m: 25 };
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_PICK_KEY) || 'null');
    if (saved) pick = saved;
  } catch (e) {
    /* keep the default */
  }
  setWheel(wheelH, Math.min(WHEEL_HOURS - 1, pick.h || 0));
  setWheel(wheelM, Math.min(WHEEL_MINS - 1, pick.m == null ? 25 : pick.m));
}

function startFocus() {
  const h = wheelValue(wheelH);
  const m = wheelValue(wheelM);
  const total = h * 60 + m;
  if (total <= 0) return; // nothing picked
  localStorage.setItem(TIMER_PICK_KEY, JSON.stringify({ h, m }));
  startTimer(total);
}

// The wheels' last-picked duration - also what per-task sessions run for.
function lastPickMinutes() {
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_PICK_KEY) || 'null');
    if (saved) {
      const total = (saved.h || 0) * 60 + (saved.m || 0);
      if (total > 0) return total;
    }
  } catch (e) {
    /* fall through to the default */
  }
  return 25;
}

function startFocusOnTask(taskId) {
  startTimer(lastPickMinutes(), { taskId, kind: 'focus' });
}

// The next open task to switch to (in the list's manual order), preferring one
// that isn't the task just finished.
function nextOpenTask(excludeId) {
  const open = tasks.filter((x) => !x.done);
  return open.find((x) => x.id !== excludeId) || null;
}

function updateDonePanel() {
  if (!timerDoneInfo) return;
  const doneTask = focusTaskById(timerDoneInfo.taskId);
  timerDoneTask.textContent = doneTask ? doneTask.text : '';
  timerDoneTask.hidden = !doneTask;
  doneMarkBtn.hidden = !doneTask || doneTask.done;
  doneNextBtn.hidden = !nextOpenTask(timerDoneInfo.taskId);
}

function closeDonePanel() {
  timerDoneInfo = null;
  updateTimerUI();
  requestAnimationFrame(applyPick); // the wheels are back - restore the pick
}

if (timer) {
  attachWheel(wheelH, WHEEL_HOURS);
  attachWheel(wheelM, WHEEL_MINS);
  applyPick();
  timer.addEventListener('animationend', () => timer.classList.remove('pulse'));
  timerStart.addEventListener('click', startFocus);
  timerToggle.addEventListener('click', () => (timerRunning ? pauseTimer() : resumeTimer()));
  timerReset.addEventListener('click', resetTimer);

  // End-of-session prompt: the one-tap "switch" actions.
  doneMarkBtn.addEventListener('click', () => {
    const doneTask = focusTaskById(timerDoneInfo && timerDoneInfo.taskId);
    if (doneTask && !doneTask.done) {
      doneTask.done = true;
      awardTask(doneTask.id);
      scheduleSave();
    }
    closeDonePanel();
    render();
  });
  doneBreakBtn.addEventListener('click', () => startTimer(5, { kind: 'break' }));
  doneNextBtn.addEventListener('click', () => {
    const next = nextOpenTask(timerDoneInfo && timerDoneInfo.taskId);
    if (next) startFocusOnTask(next.id);
    else closeDonePanel();
  });
  doneCloseBtn.addEventListener('click', closeDonePanel);

  // Restore a timer that was running/paused before a reload or relaunch.
  try {
    const saved = JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
    if (saved) {
      timerTotalMin = saved.totalMin || 0;
      timerTaskId = saved.taskId || null;
      timerKind = saved.kind === 'break' ? 'break' : 'focus';
      if (saved.running && saved.endsAt - Date.now() > 0) {
        timerEndsAt = saved.endsAt;
        timerActive = true;
        timerRunning = true;
        timerInterval = setInterval(timerTick, 250);
      } else if (!saved.running && saved.remainingMs > 0) {
        timerRemainingMs = saved.remainingMs;
        timerActive = true;
        timerRunning = false;
      } else {
        timerTaskId = null;
        localStorage.removeItem(TIMER_KEY); // finished while the app was closed
      }
    }
  } catch (e) {
    /* ignore a corrupt timer entry */
  }
  updateTimerUI();
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
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    return {};
  }
}

function quotesForLang(l) {
  const base = QUOTES[l] || QUOTES.en;
  const extra = loadQuoteCache()[l];
  const pool = Array.isArray(extra) ? base.concat(extra) : base.slice();
  return [...new Set(pool)];
}

function pickDailyQuote() {
  if (!dailyQuote) return;
  const pool = quotesForLang(lang);
  if (!pool.length) return;
  dailyQuote.textContent = pool[dayOfYear(new Date()) % pool.length];
}

// A generic quotes API turned out to serve Title-Cased philosophy rather than
// gentle nudges; reject anything that looks like that if it ever sneaks in.
function looksTitleCased(s) {
  const words = s.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length < 4) return false;
  const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
  return caps / words.length > 0.7;
}

// Top up the per-language pools from our own curated quotes-extra.json, served
// by the project's GitHub Pages site (which we control, so the tone stays
// right, and it sends CORS headers). Deliberately swallows every error: no
// network, file missing, bad payload - all just leave the bundle in place.
async function refreshQuotes() {
  try {
    const last = Number(localStorage.getItem(QUOTE_REFRESHED_KEY)) || 0;
    if (Date.now() - last < QUOTE_REFRESH_EVERY_MS) return;
    localStorage.setItem(QUOTE_REFRESHED_KEY, String(Date.now())); // throttle even if this attempt fails

    // The web build lives next to the file; the desktop build fetches the
    // Pages copy so new quotes reach it without an app update.
    const url = isDesktop
      ? 'https://amarcu.github.io/daily-sticky-note/quotes-extra.json'
      : 'quotes-extra.json';
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const cache = loadQuoteCache();
    let added = false;
    for (const l of LANGS) {
      const incoming = (Array.isArray(data[l]) ? data[l] : [])
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        // The Title-Case check is English-only: German capitalizes every noun
        // by grammar, so the heuristic would eat legitimate lines there.
        .filter((s) => s.length >= 8 && s.length <= 100 && !s.includes('\n') && (l !== 'en' || !looksTitleCased(s)));
      if (!incoming.length) continue;
      cache[l] = [...new Set((cache[l] || []).concat(incoming))].slice(-QUOTE_CACHE_CAP);
      added = true;
    }
    if (!added) return;
    localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(cache));
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
      updateTimerUI(); // a restored task-linked session can now show its task name
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
  if (sortDragActive) return; // don't rebuild the list out from under a drag
  taskList.innerHTML = '';
  emptyMsg.style.display = tasks.length ? 'none' : 'block';
  updateCompactCount();
  const nowStr = currentHHMM();

  // Tasks render in the array's order - the order you drag them into. (They
  // used to auto-sort by time; manual sorting replaces that.)
  tasks.forEach((task) => {
    const isDue = !task.done && task.time && task.time <= nowStr;

    if (isDue && notifEnabled && !notifiedIds.has(task.id)) {
      notifiedIds.add(task.id);
      fireNotification(t('taskDue'), task.text);
    }

    const row = document.createElement('div');
    row.className = 'task-row' + (isDue ? ' due' : '') + (task.done ? ' done' : '');
    row.dataset.id = task.id;
    if (timerActive && timerKind === 'focus' && task.id === timerTaskId) {
      row.classList.add('focusing');
    }
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

    if (!task.done) {
      const focus = document.createElement('button');
      focus.className = 'focus-btn';
      focus.type = 'button';
      focus.title = t('focusThis');
      focus.setAttribute('aria-label', `${t('focusThis')}: ${task.text}`);
      // Same stopwatch glyph as the Focus Mode widget's label, so the two read
      // as one feature.
      focus.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="14" r="7"/><path d="M12 11v3l2 2M9 2h6M12 2v3"/></svg>';
      focus.addEventListener('click', () => startFocusOnTask(task.id));
      row.appendChild(focus);
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

// ---- Drag to reorder tasks (kanban-style manual sorting) ----
// Pointer-based: press a row (not its buttons/checkbox), move a few px to
// lift it, drag up/down to slot it in - siblings animate out of the way -
// release to drop. The array order is rebuilt from the DOM and saved/synced.

const DRAG_THRESHOLD = 5;
let sortRow = null; // row under the pointer since pointerdown
let sortGrabDelta = 0; // pointer offset inside the row when lifted
let sortStartX = 0;
let sortStartY = 0;

// Animate the non-dragged rows from their old slots to their new ones (FLIP).
function moveRowAnimated(domMove) {
  const others = [...taskList.querySelectorAll('.task-row:not(.drag-sorting)')];
  const before = new Map(others.map((r) => [r, r.getBoundingClientRect().top]));
  domMove();
  for (const r of others) {
    const delta = before.get(r) - r.getBoundingClientRect().top;
    if (delta) {
      r.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: 150, easing: 'ease-out' }
      );
    }
  }
}

function positionSortRow(clientY) {
  // Follow the pointer: translate relative to the row's untransformed spot.
  const current = Number(sortRow.dataset.dragY || 0);
  const baseTop = sortRow.getBoundingClientRect().top - current;
  const next = clientY - sortGrabDelta - baseTop;
  sortRow.dataset.dragY = String(next);
  sortRow.style.transform = `translateY(${next}px) rotate(1.5deg) scale(1.02)`;
}

function endSortDrag() {
  if (!sortRow) return;
  const lifted = sortDragActive;
  sortRow.classList.remove('drag-sorting');
  sortRow.style.transform = '';
  delete sortRow.dataset.dragY;
  taskList.classList.remove('sorting');
  sortRow = null;
  sortDragActive = false;
  if (!lifted) return; // it was just a click, nothing moved
  // Rebuild the array in the DOM's new order, then save and repaint.
  const order = [...taskList.children].map((r) => r.dataset.id);
  tasks = order.map((id) => tasks.find((x) => x.id === id)).filter(Boolean);
  scheduleSave();
  render();
}

taskList.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button, input')) return;
  const row = e.target.closest('.task-row');
  if (!row) return;
  sortRow = row;
  sortStartX = e.clientX;
  sortStartY = e.clientY;
  sortGrabDelta = e.clientY - row.getBoundingClientRect().top;
  try {
    row.setPointerCapture(e.pointerId);
  } catch (err) {
    /* synthetic events have no active pointer - dragging still works */
  }
});

taskList.addEventListener('pointermove', (e) => {
  if (!sortRow) return;
  if (!sortDragActive) {
    if (Math.abs(e.clientX - sortStartX) < DRAG_THRESHOLD && Math.abs(e.clientY - sortStartY) < DRAG_THRESHOLD) {
      return;
    }
    sortDragActive = true;
    sortRow.classList.add('drag-sorting');
    taskList.classList.add('sorting');
  }
  e.preventDefault();
  positionSortRow(e.clientY);

  // Auto-scroll the (internally scrolling) list near its edges.
  const listRect = taskList.getBoundingClientRect();
  if (e.clientY < listRect.top + 20) taskList.scrollTop -= 6;
  else if (e.clientY > listRect.bottom - 20) taskList.scrollTop += 6;

  // Slot the row in front of the first sibling whose midpoint the pointer is
  // above; past them all means it goes last.
  const others = [...taskList.querySelectorAll('.task-row:not(.drag-sorting)')];
  for (const r of others) {
    const rect = r.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      if (r.previousElementSibling !== sortRow) {
        moveRowAnimated(() => taskList.insertBefore(sortRow, r));
        positionSortRow(e.clientY); // the DOM move shifted its base position
      }
      return;
    }
  }
  if (taskList.lastElementChild !== sortRow) {
    moveRowAnimated(() => taskList.appendChild(sortRow));
    positionSortRow(e.clientY);
  }
});

taskList.addEventListener('pointerup', endSortDrag);
taskList.addEventListener('pointercancel', endSortDrag);

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
  // A confirmation notification proves it works and, on macOS, registers the app
  // in Notification Center so it shows up (and can be allowed) in system settings.
  if (granted) fireNotification(t('notifEnabledTitle'), t('notifEnabledBody'));
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

  // The window is user-resizable now (the note fills it and the task list
  // flexes), so there's no content-hug auto-size. The one time we drive the
  // window size ourselves is compact/expand: shrink to the header bar and back,
  // animated to match the content collapse.
  const { LogicalSize } = window.__TAURI__.window;
  const WINDOW_WIDTH = 320;
  const EXPANDED_H_KEY = 'stickyPlanner.expandedHeight';

  function compactTargetHeight() {
    const header = document.querySelector('.note-header');
    let h = header ? header.getBoundingClientRect().height : 50;
    // Keep the update banner (above the header) on screen when collapsed, so an
    // update is always reachable even from the compact bar.
    if (updateBanner && !updateBanner.hidden) {
      h += updateBanner.getBoundingClientRect().height + 12;
    }
    return Math.round(h + 70); // header + note/body vertical paddings
  }

  let winAnimId = 0;
  function animateWindowHeight(from, to) {
    const id = ++winAnimId; // cancel any in-flight animation
    const start = performance.now();
    const dur = 340;
    const tick = (now) => {
      if (id !== winAnimId) return;
      const p = Math.min(1, (now - start) / dur);
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const h = Math.round(from + (to - from) * eased);
      appWindow.setSize(new LogicalSize(WINDOW_WIDTH, h)).catch(() => {});
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  onCompactToggle = (isCompact) => {
    if (isCompact) {
      localStorage.setItem(EXPANDED_H_KEY, String(window.innerHeight));
      animateWindowHeight(window.innerHeight, compactTargetHeight());
    } else {
      const saved = Number(localStorage.getItem(EXPANDED_H_KEY)) || 560;
      animateWindowHeight(window.innerHeight, saved);
    }
  };

  // Ask whether a newer release exists; if so, show a banner that downloads,
  // installs, and relaunches into it on one click (all handled on the Rust
  // side). Checks on launch and every 6 hours after - this is a long-lived
  // tray widget, so a launch-only check could lag behind for days. The tray
  // menu's "Check for updates" runs the same check on demand (via the
  // update-available event when it finds one). Silent if offline or failing.
  const invoke = window.__TAURI__.core.invoke;
  const showUpdateBanner = (version) => {
    updateText.textContent = t('updateReady', { v: version });
    updateBtn.textContent = t('updateNow');
    updateBanner.hidden = false;
  };
  const runUpdateCheck = () =>
    invoke('check_update')
      .then((version) => {
        if (version) showUpdateBanner(version);
      })
      .catch((e) => console.error('update check failed', e));
  runUpdateCheck();
  setInterval(runUpdateCheck, 6 * 60 * 60 * 1000);
  window.__TAURI__.event
    .listen('update-available', (e) => showUpdateBanner(e.payload))
    .catch((e) => console.error('update listener failed', e));

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

  // Start-at-login: show the in-app toggle (desktop only) and reflect the real
  // OS state. The Rust side does the per-platform registration and keeps the
  // tray checkbox in sync.
  if (startupRow) startupRow.hidden = false;
  if (startupHint) startupHint.hidden = false;
  // Desktop notifications can be blocked at the OS level (common on unsigned
  // macOS builds); give a one-click way to open the system notification pane.
  if (notifSettingsRow) notifSettingsRow.hidden = false;
  if (notifSettingsBtn) {
    notifSettingsBtn.addEventListener('click', () => {
      invoke('open_notification_settings').catch((e) => console.error('open settings failed', e));
    });
  }
  const refreshAutostart = () =>
    invoke('autostart_enabled')
      .then((on) => { if (autostartToggle) autostartToggle.checked = !!on; })
      .catch((e) => console.error('autostart check failed', e));
  refreshAutostart();
  if (autostartToggle) {
    autostartToggle.addEventListener('change', async () => {
      try {
        const now = await invoke('set_autostart', { enable: autostartToggle.checked });
        autostartToggle.checked = !!now;
      } catch (e) {
        console.error('set autostart failed', e);
        autostartToggle.checked = !autostartToggle.checked; // revert on failure
      }
    });
  }
  // Re-sync the toggle whenever the settings panel is opened (it may have been
  // changed from the tray menu meanwhile).
  syncBtn.addEventListener('click', () => {
    if (!syncPanel.hidden) refreshAutostart();
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

// Restore the collapsed/expanded state before the first paint.
compact = localStorage.getItem(COMPACT_KEY) === '1';

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
updateTimerUI(); // tasks are loaded now - a restored session can show its task name

// One-time migration: the old quote cache was filled from a generic-famous-
// quotes API (Title-Cased Nietzsche is not a gentle nudge). Drop it and clear
// the throttle so the next refresh rebuilds promptly from the curated source.
if (localStorage.getItem('stickyPlanner.quoteCache') !== null) {
  localStorage.removeItem('stickyPlanner.quoteCache');
  localStorage.removeItem(QUOTE_REFRESHED_KEY);
  pickDailyQuote(); // today's line may change now that the pool is clean
}

refreshQuotes(); // fire-and-forget; silently no-ops if throttled or offline

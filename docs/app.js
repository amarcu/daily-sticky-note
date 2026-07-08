const FIREBASE_CONFIG_KEY = 'stickyPlanner.firebaseConfig';
const LOCAL_TASKS_KEY = 'stickyPlanner.localTasks';
const SYNC_KEY = 'stickyPlanner.syncCode';
const POS_KEY = 'stickyPlanner.position';
const NOTIF_KEY = 'stickyPlanner.notifEnabled';
const FIREBASE_SDK_VERSION = '12.15.0';

const dateLabel = document.getElementById('dateLabel');
const note = document.getElementById('note');
const dragHandle = document.getElementById('dragHandle');
const notifBtn = document.getElementById('notifBtn');
const syncBtn = document.getElementById('syncBtn');
const hideBtn = document.getElementById('hideBtn');
const syncPanel = document.getElementById('syncPanel');
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

// Desktop build detection. The Tauri shell exposes a global `window.__TAURI__`
// object (we opt into this with `withGlobalTauri` in tauri.conf.json); the plain
// browser build has neither and runs as an in-page sticky note on a desk.
const isDesktop = typeof window.__TAURI__ !== 'undefined';
if (isDesktop) document.documentElement.classList.add('desktop-mode');

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
  const label = notifEnabled
    ? 'Reminders on - click to turn off'
    : 'Turn on reminders for tasks that have a time';
  notifBtn.title = label;
  notifBtn.setAttribute('aria-label', label);
  notifBtn.setAttribute('aria-pressed', String(notifEnabled));
  localStorage.setItem(NOTIF_KEY, notifEnabled ? '1' : '0');
}

let tasks = [];
let notifEnabled = false;
let applyingRemoteUpdate = false;
let saveTimer = null;
let unsubscribeSnapshot = null;
const notifiedIds = new Set();

let cloudEnabled = false;
let db = null;
let _doc, _setDoc, _onSnapshot, _serverTimestamp;

dateLabel.textContent = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

// ---- Daily note: one gentle positive / keep-learning nudge, the same one all
// day so it feels like "today's note", rotating to a new one tomorrow. ----
const DAILY_NOTES = [
  'Learn something new every day.',
  'Small steps still move you forward.',
  'Progress, not perfection.',
  'You can do hard things.',
  'One task at a time is plenty.',
  'Stay curious - it compounds.',
  'Done is better than perfect.',
  'Be kind to yourself today.',
  'Every expert was once a beginner.',
  'A little effort today pays off tomorrow.',
  'Finish one thing before starting the next.',
  'Today is a good day to learn.',
];

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

if (dailyQuote) {
  dailyQuote.textContent = DAILY_NOTES[dayOfYear(new Date()) % DAILY_NOTES.length];
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

function saveLocalTasks() {
  localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
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
  setSyncStatus('Connecting…');
  const ref = _doc(db, 'lists', syncCode);
  unsubscribeSnapshot = _onSnapshot(
    ref,
    (snap) => {
      applyingRemoteUpdate = true;
      if (snap.exists()) {
        tasks = snap.data().tasks || [];
      } else {
        // First time this sync code has been used - seed the cloud
        // list from whatever was on this device locally, so switching
        // on sync doesn't look like it wiped the list.
        tasks = loadLocalTasks();
      }
      render();
      applyingRemoteUpdate = false;
      setSyncStatus('Synced');
      if (!snap.exists() && tasks.length) saveNow();
    },
    (err) => {
      console.error('Sync error', err);
      setSyncStatus('Sync error - check the browser console');
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
      await _setDoc(_doc(db, 'lists', syncCode), { tasks, updatedAt: _serverTimestamp() });
    } catch (e) {
      console.error('Save failed', e);
      setSyncStatus('Could not save - check the browser console');
    }
  } else {
    saveLocalTasks();
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
    configError.textContent = "Couldn't read that - paste the whole config object Firebase gave you, including the { }.";
    configError.hidden = false;
    return;
  }
  if (!parsed.apiKey || !parsed.projectId) {
    configError.textContent = 'Missing apiKey or projectId - copy the full config object from your Firebase project settings.';
    configError.hidden = false;
    return;
  }
  localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(parsed));
  location.reload();
});

disconnectCloudBtn.addEventListener('click', () => {
  if (!confirm('Turn off cloud sync? Your tasks stay saved on this device only from now on.')) return;
  saveLocalTasks();
  localStorage.removeItem(FIREBASE_CONFIG_KEY);
  location.reload();
});

copyCodeBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(syncCode);
    copyCodeBtn.textContent = 'Copied';
    setTimeout(() => (copyCodeBtn.textContent = 'Copy'), 1200);
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
      fireNotification('Task due', task.text);
    }

    const row = document.createElement('div');
    row.className = 'task-row' + (isDue ? ' due' : '') + (task.done ? ' done' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = task.done;
    cb.setAttribute('aria-label', `Mark "${task.text}" done`);
    cb.addEventListener('change', () => {
      task.done = cb.checked;
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
    del.setAttribute('aria-label', `Delete "${task.text}"`);
    del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener('click', () => {
      tasks = tasks.filter((t) => t.id !== task.id);
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
  tasks.push({
    id: crypto.randomUUID(),
    text,
    time: timeInput.value,
    done: false,
  });
  taskInput.value = '';
  timeInput.value = '';
  render();
  scheduleSave();
  taskInput.focus();
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
    alert('This browser does not support notifications.');
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
  dragHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.header-actions')) return;
    appWindow.startDragging();
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

// ---- Startup: cloud mode if a Firebase config is saved, otherwise local-only ----

// Restore the reminders toggle (saved per device). In the browser, drop it if
// the notification permission was revoked since last time so the bell doesn't
// claim to be on when it can't actually fire.
notifEnabled = localStorage.getItem(NOTIF_KEY) === '1';
if (notifEnabled && !isDesktop && 'Notification' in window && Notification.permission !== 'granted') {
  notifEnabled = false;
}
updateNotifButton();

const savedFirebaseConfig = loadFirebaseConfig();
if (savedFirebaseConfig) {
  localOnlyView.hidden = true;
  cloudView.hidden = false;
  enableCloudSync(savedFirebaseConfig).catch((e) => {
    console.error('Cloud sync failed to start', e);
    setSyncStatus('Could not connect - check your Firebase config');
  });
} else {
  localOnlyView.hidden = false;
  cloudView.hidden = true;
  tasks = loadLocalTasks();
}

render();

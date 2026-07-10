// Tiny one-shot confetti bursts on a canvas that overlays the note. The render
// loop runs only while particles are alive and stops itself when they're gone,
// so an always-on-top overlay never burns battery animating nothing. Respects
// prefers-reduced-motion by doing nothing.

let canvas = null;
let ctx = null;
let particles = [];
let running = false;
let dpr = 1;

const PALETTE = ['#2e8b8f', '#e0453a', '#f2b632', '#4caf82', '#ff8a3d', '#7b61c9', '#e0b64a'];

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function resize() {
  const host = canvas.parentElement;
  const r = host.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas.style.width = `${r.width}px`;
  canvas.style.height = `${r.height}px`;
}

function ensureCanvas() {
  if (canvas) return;
  const note = document.getElementById('note');
  if (!note) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  note.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize();
  new ResizeObserver(resize).observe(note);
}

function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);
  for (const p of particles) {
    p.vy += 0.12; // gravity
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= p.decay;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }
  ctx.restore();

  const h = canvas.height / dpr;
  particles = particles.filter((p) => p.life > 0 && p.y < h + 24);
  if (particles.length) {
    requestAnimationFrame(loop);
  } else {
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// Fire a burst at a viewport coordinate (e.g. a clicked checkbox's centre).
export function burst(clientX, clientY, count = 26, power = 1.4) {
  if (prefersReducedMotion()) return;
  ensureCanvas();
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (3.5 + Math.random() * 6) * power;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3.4 * power, // extra upward pop so it reads as a burst
      size: 7 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.6,
      color: PALETTE[(Math.random() * PALETTE.length) | 0],
      life: 1,
      decay: 0.006 + Math.random() * 0.01, // slower fade = stays visible longer
    });
  }
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

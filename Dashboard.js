/* ═══════════════════════════════════════════════════════
   script.js — Smart Hall Dashboard
   ═══════════════════════════════════════════════════════ */

// ── CONFIG ──────────────────────────────────────────────
const API_CV  = "http://localhost:5050/api/state";  // Camera / face detection
const API_IOT = "http://localhost:5051/api/state";  // IoT sensors + ML classifier
const POLL_MS     = 800;
const HISTORY_MAX = 60;

const THRESHOLDS = {
  temperature: { min: 20,   max: 24   },
  humidity:    { min: 57,   max: 63   },
  light:       { min: 360,  max: 1600 },
  noise:       { min: 2000, max: 2500 },
};

// ── State ────────────────────────────────────────────────
let cvOnline      = false;
let iotOnline     = false;
let focusHistory  = [];
let knownAlertIds = new Set();

// ════════════════════════════════════════════════════════
//  Clock
// ════════════════════════════════════════════════════════
function updateClock() {
  document.getElementById("clock").textContent =
    new Date().toLocaleTimeString("en-US", { hour12: true });
}
setInterval(updateClock, 1000);
updateClock();

// ════════════════════════════════════════════════════════
//  Connection Banner
// ════════════════════════════════════════════════════════
function updateConnBanner() {
  const el = document.getElementById("conn-banner");
  if (cvOnline && iotOnline) {
    el.className  = "ok";
    el.textContent = "✅ Both APIs connected — Camera (5050) + IoT (5051) live";
  } else if (cvOnline && !iotOnline) {
    el.className  = "partial";
    el.textContent = "⚠️ Camera API online (5050) — IoT API offline (5051). Run: python Neurolytics-ML.py --port COM6";
  } else if (!cvOnline && iotOnline) {
    el.className  = "partial";
    el.textContent = "⚠️ IoT API online (5051) — Camera API offline (5050). Run: python cv_script.py";
  } else {
    el.className  = "err";
    el.textContent = "❌ Both APIs offline — start Neurolytics-ML.py (port 5051) and the CV script (port 5050)";
  }
}

// ════════════════════════════════════════════════════════
//  Environment Focus Banner
// ════════════════════════════════════════════════════════
function renderEnvBanner(ef) {
  if (!ef) return;

  const label = ef.label || "—";
  const conf  = ef.conf  || {};
  const pct   = conf[label] != null ? `${(conf[label] * 100).toFixed(0)}% confidence` : "";

  const icons = { "Focused": "✅", "Half Focus": "⚠️", "Not Focused": "🚫" };
  const cls   = { "Focused": "focused", "Half Focus": "half", "Not Focused": "notfocused" };
  const msgs  = {
    "Focused":     "✅ Environment is optimal for learning.",
    "Half Focus":  "⚠️  Environment is suboptimal — check sensors.",
    "Not Focused": "🚫 Environment is poor — readings out of range.",
  };

  document.getElementById("env-banner").className    = cls[label]  || "focused";
  document.getElementById("env-icon").textContent    = icons[label] || "🔍";
  document.getElementById("env-label").textContent   = msgs[label]  || label;
  document.getElementById("env-conf").textContent    = pct;
}

// ════════════════════════════════════════════════════════
//  Summary Bar
// ════════════════════════════════════════════════════════
function renderSummary(sum) {
  if (!sum) return;
  document.getElementById("stat-total").textContent    = sum.total       ?? 0;
  document.getElementById("stat-focused").textContent  = sum.focused     ?? 0;
  document.getElementById("stat-unfocused").textContent= sum.not_focused ?? 0;
  document.getElementById("stat-pct").textContent      =
    sum.total ? (sum.focus_pct ?? 0) + "%" : "—";
}

// ════════════════════════════════════════════════════════
//  Student Cards
// ════════════════════════════════════════════════════════
const REASON_ICONS = {
  "Sleeping":       "😴",
  "Head Down":      "⬇️",
  "Looking Away":   "👀",
  "Face Hidden":    "🚫",
  "Eyes Covered":   "🙈",
  "Gaze Distracted":"📱",
};

function reasonIcon(t) {
  if (!t) return "⚠️";
  if (t.toLowerCase().includes("phone") || t.toLowerCase().includes("holding")) return "📵";
  return REASON_ICONS[t] || "⚠️";
}

function buildCardHTML(id, s) {
  const isFoc   = s.status === "FOCUSED";
  const cls     = isFoc ? "focused" : "not-focused";
  const score   = s.score ?? 100;
  const reasons = s.reasons || [];

  const causeHTML = isFoc
    ? `<div class="cause-block is-focused">
         <span class="cause-icon">✅</span>
         <span class="cause-text">Paying attention</span>
       </div>`
    : `<div class="cause-block not-focused-block">
         <div class="cause-header">⚠️ Reason${reasons.length !== 1 ? "s" : ""}</div>
         <div class="cause-reasons">
           ${reasons.length
             ? reasons.map(r => `
               <div class="cause-row">
                 <span class="cause-row-icon">${reasonIcon(r)}</span>
                 <span class="cause-row-text">${r}</span>
               </div>`).join("")
             : `<div class="cause-row">
                  <span class="cause-row-icon">⏳</span>
                  <span class="cause-row-text">Detecting…</span>
                </div>`}
         </div>
       </div>`;

  return `
    <div class="card-stripe"></div>
    <div class="card-body">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:9px;">
          <div class="student-avatar">S${id}</div>
          <div>
            <div class="student-name">Student ${id}</div>
            <div class="pose-info">yaw: ${s.yaw || '—'} &nbsp;|&nbsp; pitch: ${s.pitch || '—'}</div>
          </div>
        </div>
        <div class="status-badge ${cls}">${isFoc ? "FOCUSED" : "NOT FOCUSED"}</div>
      </div>
      ${causeHTML}
      <div class="score-row">
        <span class="score-label">Focus</span>
        <div class="score-track">
          <div class="score-fill${score < 50 ? ' low' : ''}" style="width:${score}%"></div>
        </div>
        <span class="score-num">${score}%</span>
      </div>
    </div>`;
}

function renderStudents(students) {
  const grid = document.getElementById("student-grid");
  const ids  = students ? Object.keys(students) : [];

  if (!ids.length) {
    if (!grid.querySelector(".camera-offline")) {
      grid.innerHTML = `
        <div class="camera-offline">
          <div class="cam-icon">📷</div>
          <div class="cam-title">Camera Feed Offline</div>
          <div class="cam-sub">
            Student monitoring requires the CV script running on port 5050.<br>
            Connect a camera and start <strong>cv_script.py</strong> to see live student cards here.
          </div>
        </div>`;
    }
    return;
  }

  // Remove offline placeholder if present
  grid.querySelector(".camera-offline")?.remove();

  // Remove stale cards
  grid.querySelectorAll(".student-card").forEach(card => {
    if (!ids.includes(card.dataset.id)) card.remove();
  });

  ids.forEach(id => {
    const s   = students[id];
    const cls = s.status === "FOCUSED" ? "focused" : "not-focused";
    const existing = grid.querySelector(`[data-id="${id}"]`);

    if (existing) {
      existing.className = `student-card ${cls}`;
      existing.innerHTML = buildCardHTML(id, s);
    } else {
      const card = document.createElement("div");
      card.className  = `student-card ${cls}`;
      card.dataset.id = id;
      card.innerHTML  = buildCardHTML(id, s);
      grid.appendChild(card);
    }
  });
}

// ════════════════════════════════════════════════════════
//  Sensor Cards
// ════════════════════════════════════════════════════════
function setWarn(id, isWarn) {
  document.getElementById(id)?.classList.toggle("warn", isWarn);
}

function renderSensors(s) {
  if (!s) return;

  const temp = +s.temperature || 0;
  document.getElementById("s-temp").textContent      = temp.toFixed(1);
  document.getElementById("bar-temp").style.width    = Math.min(temp / 50 * 100, 100) + "%";
  setWarn("card-temp", temp < THRESHOLDS.temperature.min || temp > THRESHOLDS.temperature.max);

  const hum = +s.humidity || 0;
  document.getElementById("s-hum").textContent       = hum.toFixed(1);
  document.getElementById("bar-hum").style.width     = Math.min(hum, 100) + "%";
  setWarn("card-hum", hum < THRESHOLDS.humidity.min || hum > THRESHOLDS.humidity.max);

  const light = +s.light || 0;
  document.getElementById("s-light").textContent     = light;
  document.getElementById("bar-light").style.width   = Math.min(light / 2000 * 100, 100) + "%";
  setWarn("card-light", light < THRESHOLDS.light.min || light > THRESHOLDS.light.max);

  const noise = +s.noise || 0;
  document.getElementById("s-noise").textContent     = noise;
  document.getElementById("bar-noise").style.width   = Math.min(noise / 4095 * 100, 100) + "%";
  setWarn("card-noise", noise < THRESHOLDS.noise.min || noise > THRESHOLDS.noise.max);

  const motion = !!s.motion;
  document.getElementById("s-motion-text").textContent = motion ? "Motion Detected" : "No Motion";
  document.getElementById("motion-dot").className      = "motion-dot" + (motion ? " active" : "");
  setWarn("card-motion", !motion);
}

// ════════════════════════════════════════════════════════
//  Alert Log  (merged from both APIs, deduplicated)
// ════════════════════════════════════════════════════════
function renderAlerts(alerts) {
  if (!alerts?.length) return;

  const list = document.getElementById("alerts-list");
  list.querySelector(".no-alerts")?.remove();

  alerts.forEach(a => {
    const uid = `${a.time}|${a.student}|${a.message}`;
    if (knownAlertIds.has(uid)) return;
    knownAlertIds.add(uid);

    const item = document.createElement("div");
    item.className = `alert-item ${a.type === "iot" ? "iot" : ""}`;
    item.innerHTML = `
      <div class="alert-top">
        <span class="alert-student">${a.student || "IoT Sensor"}</span>
        <span class="alert-time">${a.time}</span>
      </div>
      <div class="alert-reason">${a.message}</div>`;
    list.insertBefore(item, list.firstChild);
  });

  // Keep max 60 entries
  while (list.children.length > 60) list.removeChild(list.lastChild);
}

// ════════════════════════════════════════════════════════
//  Focus History Sparkline  (canvas)
// ════════════════════════════════════════════════════════
function renderHistory(labelInt) {
  focusHistory.push(labelInt ?? 2);
  if (focusHistory.length > HISTORY_MAX) focusHistory.shift();

  const canvas = document.getElementById("history-canvas");
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.offsetWidth  || 600;
  const H      = canvas.offsetHeight || 150;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const n      = focusHistory.length;
  const stepX  = W / Math.max(n - 1, 1);
  const padY   = 22;
  const usableH = H - padY * 2;

  const colors = ["#ff4757", "#ffa502", "#00d68f"];
  const labels = ["Not Focused", "Half Focus", "Focused"];

  // Grid lines + labels
  [0, 1, 2].forEach(lv => {
    const y = padY + usableH - (lv / 2) * usableH;
    ctx.strokeStyle = "rgba(22,51,80,.8)";
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = colors[lv];
    ctx.font      = "10px 'Space Mono',monospace";
    ctx.textAlign = "left";
    ctx.fillText(labels[lv], 4, y - 3);
  });

  if (n < 2) return;

  const lx = (n - 1) * stepX;
  const ly = padY + usableH - (focusHistory[n - 1] / 2) * usableH;

  // Gradient fill under line
  const grad = ctx.createLinearGradient(0, padY, 0, H);
  grad.addColorStop(0, "rgba(0,214,143,.2)");
  grad.addColorStop(1, "rgba(0,214,143,.01)");

  ctx.beginPath();
  focusHistory.forEach((v, i) => {
    const x = i * stepX, y = padY + usableH - (v / 2) * usableH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(lx, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  focusHistory.forEach((v, i) => {
    const x = i * stepX, y = padY + usableH - (v / 2) * usableH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#00d68f";
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = "round";
  ctx.stroke();

  // Latest dot
  ctx.beginPath();
  ctx.arc(lx, ly, 5, 0, Math.PI * 2);
  ctx.fillStyle   = "#00d68f";
  ctx.shadowColor = "#00d68f";
  ctx.shadowBlur  = 8;
  ctx.fill();
  ctx.shadowBlur  = 0;
}

// ════════════════════════════════════════════════════════
//  Fetch Helper  (returns null on failure)
// ════════════════════════════════════════════════════════
async function safeFetch(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (_) {
    return null;
  }
}

// ════════════════════════════════════════════════════════
//  Main Poll  — hits both APIs concurrently then merges
// ════════════════════════════════════════════════════════
async function poll() {
  const [cvData, iotData] = await Promise.all([
    safeFetch(API_CV),
    safeFetch(API_IOT),
  ]);

  cvOnline  = cvData  !== null;
  iotOnline = iotData !== null;
  updateConnBanner();

  // Students → CV script (port 5050)
  renderStudents(cvData?.students ?? {});

  // Sensors + env_focus → IoT/ML script (port 5051)
  renderSensors(iotData?.sensors ?? null);
  renderEnvBanner(iotData?.env_focus ?? null);

  // Summary: prefer CV (real headcount), fall back to IoT
  renderSummary(cvData?.summary ?? iotData?.summary ?? null);

  // Alerts: merge both lists, interleaved
  const cvAlerts  = cvData?.alerts  ?? [];
  const iotAlerts = (iotData?.alerts ?? []).map(a => ({ ...a, type: "iot" }));
  const merged    = [];
  const maxLen    = Math.max(cvAlerts.length, iotAlerts.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < cvAlerts.length)  merged.push(cvAlerts[i]);
    if (i < iotAlerts.length) merged.push(iotAlerts[i]);
  }
  renderAlerts(merged);

  // History sparkline: prefer IoT classifier label
  renderHistory(iotData?.env_focus?.int ?? 2);
}

// ── Start ────────────────────────────────────────────────
poll();
setInterval(poll, POLL_MS);
'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 사이먼: 화면·입력·소리. 규칙은 logic.js (LOGIC_SIMON).
const L = LOGIC_SIMON;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640, CX = 180, CY = 350, GAP = 10;      // 패드 네 개가 가운데를 둘러쌈
const canvas = $('game'), ctx = canvas.getContext('2d');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// 패드: 왼쪽 위 빨강 · 오른쪽 위 파랑 · 왼쪽 아래 노랑 · 오른쪽 아래 초록
const PADS = [
  { name: '빨강', base: '#a82a2a', lit: '#ff5a55', freq: 261.6, key: 'KeyQ', cx: -1, cy: -1 },
  { name: '파랑', base: '#1f4f9a', lit: '#5aa0ff', freq: 329.6, key: 'KeyW', cx: 1, cy: -1 },
  { name: '노랑', base: '#a8841a', lit: '#ffd84a', freq: 392, key: 'KeyA', cx: -1, cy: 1 },
  { name: '초록', base: '#1f7a3a', lit: '#5aff8a', freq: 523.3, key: 'KeyS', cx: 1, cy: 1 },
];
const PW = 150, PH = 150;
const padRect = (i) => ({ x: CX + PADS[i].cx * (PW / 2 + GAP / 2) - PW / 2, y: CY + PADS[i].cy * (PH / 2 + GAP / 2) - PH / 2, w: PW, h: PH });

// ---------- 소리 ----------
let audio = null, hum = null;
let muted = store.get('simonMuted') === '1';
function ac() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); return audio; } catch (_) { return null; } }
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  try {
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}
const padTone = (i, dur = 0.35) => tone(PADS[i].freq, dur, 'triangle', 0.14);
const sfx = {
  wrong: () => { tone(110, 0.6, 'sawtooth', 0.09, -40); },
  success: () => { tone(660, 0.1, 'triangle', 0.08); setTimeout(() => tone(880, 0.16, 'triangle', 0.08), 90); },
  over: () => { tone(196, 0.5, 'sawtooth', 0.07, -80); },
  best: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'triangle', 0.07), i * 90)),
  go: () => tone(880, 0.12, 'square', 0.04),
};

// ---------- 상태 ----------
let G = null;
let state = 'title';                    // title · play · paused · over
let level = 'normal', tut = false, newBest = false, clock = 0, floats = [], pressLit = -1, pressT = 0, flashRed = 0, correctLit = -1, correctT = 0, lastShow = -1;
let best = { easy: Number(store.get('simonBestEasy')) || 0, normal: Number(store.get('simonBest')) || 0, reverse: Number(store.get('simonBestReverse')) || 0 };
const BEST_KEY = { easy: 'simonBestEasy', normal: 'simonBest', reverse: 'simonBestReverse' };

/* @test-hooks:start */
window.__sm = { get G() { return G; }, get state() { return state; }, L, step: (dt) => update(dt), press: (i) => doPress(i) };
/* @test-hooks:end */

// ---------- 흐름 ----------
function showOverlay(html) {
  const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden');
  o.querySelectorAll('button[data-level]').forEach((b) => { b.onclick = () => start(b.dataset.level); });
  o.querySelectorAll('button[data-resume]').forEach((b) => { b.onclick = resume; });
  o.querySelectorAll('button[data-quit]').forEach((b) => { b.onclick = () => { hideOverlay(); showTitle(); }; });
}
function hideOverlay() { $('overlay').classList.add('hidden'); }
const lvButtons = () => `<div class="lv"><button data-level="easy">쉬움<small>목숨 3 · 천천히</small></button><button data-level="normal">보통<small>한 번 틀리면 끝 · 기록</small></button><button data-level="reverse">거꾸로<small>순서를 뒤에서부터</small></button></div>`;
function showTitle() {
  state = 'title';
  const bs = [['쉬움', best.easy], ['보통', best.normal], ['거꾸로', best.reverse]].filter((b) => b[1]).map((b) => `${b[0]} ${b[1]}`).join(' · ');
  showOverlay(`<h1>사이먼</h1><p>빛나고 소리 나는 <b>순서를 외워서</b><br>똑같이 눌러요!</p>
    <p class="help">맞힐 때마다 순서가 <b>하나씩 길어져요</b>.<br>길어질수록 점점 빨라져요. <b>거꾸로</b>는 뒤에서부터 눌러요!</p>
    ${bs ? `<div class="big">최고 ${bs}</div>` : ''}${lvButtons()}<p class="note"><span class="pc">패드를 클릭 · Q W A S 키</span><span class="touch">빛난 패드를 순서대로 톡톡</span></p>`);
}
function start(lv) {
  tut = /[?&]tutorial=1/.test(location.search);
  if (tut) lv = 'easy';
  level = L.LEVELS[lv] ? lv : 'normal';
  G = L.newGame(Math.random, { level, tutorial: tut });
  floats = []; newBest = false; pressLit = -1; flashRed = 0; correctLit = -1; lastShow = -1;
  state = 'play'; hideOverlay(); ac();
}
function gameOver() {
  state = 'over'; sfx.over();
  const cleared = G.cleared;
  if (!tut && cleared > best[level]) { best[level] = cleared; store.set(BEST_KEY[level], String(cleared)); newBest = true; }
  setTimeout(() => {
    if (state !== 'over') return;
    showOverlay(`<h2>틀렸어요!</h2><div class="big">${cleared}개 성공</div><p>점수 ${G.score}${newBest ? ' · 🎉 새 최고 기록!' : ` · 최고 ${best[level]}개`}</p>${lvButtons()}`);
  }, 1500);
}
function pause() { if (state !== 'play') return; state = 'paused'; showOverlay(`<h2>일시정지</h2><button data-resume="1">계속하기</button><button data-quit="1" style="background:rgba(255,255,255,.14);color:#fff;box-shadow:none;font-size:14px;padding:9px 22px">그만하고 처음으로</button>`); }
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }
function toggleMute() { muted = !muted; store.set('simonMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }

// ---------- 입력 ----------
function toGame(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
function padAt(x, y) { for (let i = 0; i < 4; i++) { const r = padRect(i); if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i; } return -1; }
function doPress(i) {
  if (state !== 'play' || G.phase !== 'input') return;
  if (L.press(G, i)) { pressLit = i; pressT = 0.22; padTone(i, 0.28); handleEvents(); }
}
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); const p = toGame(e), i = padAt(p.x, p.y); if (i >= 0) doPress(i); });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') { if (!e.repeat) state === 'paused' ? resume() : pause(); return; }
  if (e.code === 'KeyM') { if (!e.repeat) toggleMute(); return; }
  if (e.repeat) return;
  const i = PADS.findIndex((p) => p.key === e.code); if (i >= 0) { doPress(i); return; }
  const m = /^(Digit|Numpad)([1-4])$/.exec(e.code); if (m) doPress(Number(m[2]) - 1);
});
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 갱신 ----------
function handleEvents() {
  for (const ev of G.events) {
    if (ev.type === 'show') { correctLit = ev.pad; correctT = L.stepOf(G.level, G.len) * 0.7; padTone(ev.pad, Math.max(0.2, correctT)); lastShow = ev.pad; }
    else if (ev.type === 'yourTurn') { sfx.go(); }
    else if (ev.type === 'ok') { tutorialSignal('pad'); }
    else if (ev.type === 'success') { sfx.success(); tutorialSignal('round'); floats.push({ x: CX, y: CY - 10, t: 0, text: `${ev.len}개 성공!`, color: '#b8ffb8' }); }
    else if (ev.type === 'wrong') {
      sfx.wrong(); flashRed = 0.6; tutorialSignal('wrong');
      floats.push({ x: CX, y: CY - 10, t: 0, text: ev.timeout ? '시간 초과!' : '틀렸어요!', color: '#ff9a9a' });
      correctLit = ev.expected; correctT = 1.2;             // 맞는 패드를 보여 줌
    } else if (ev.type === 'over') gameOver();
  }
  G.events.length = 0;
}
function update(dt) {
  clock += dt;
  if (G && state === 'play') { L.step(G, dt); handleEvents(); }
  if (pressT > 0) { pressT -= dt; if (pressT <= 0) pressLit = -1; }
  if (correctT > 0) { correctT -= dt; if (correctT <= 0) correctLit = -1; }
  flashRed = Math.max(0, flashRed - dt);
  for (const f of floats) f.t += dt; floats = floats.filter((f) => f.t < 1.2);
}

// ---------- 그리기 ----------
function draw() {
  ctx.fillStyle = '#14102a'; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(CX, CY, 40, CX, CY, 360); bg.addColorStop(0, '#2a2060'); bg.addColorStop(1, '#0c0a1c'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!G) return;
  const showLit = L.litPad(G);
  const lit = state === 'play' || state === 'paused' ? (showLit >= 0 ? showLit : pressLit >= 0 ? pressLit : (G.phase === 'fail' ? correctLit : -1)) : -1;
  for (let i = 0; i < 4; i++) {
    const r = padRect(i), on = lit === i;
    ctx.save();
    const corner = [[80, 14, 14, 14], [14, 80, 14, 14], [14, 14, 14, 80], [14, 14, 80, 14]][i];
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, [corner[0] === 80 ? 80 : 14, corner[1] === 80 ? 80 : 14, corner[2] === 80 ? 80 : 14, corner[3] === 80 ? 80 : 14]); else ctx.rect(r.x, r.y, r.w, r.h);
    if (on) { ctx.shadowColor = PADS[i].lit; ctx.shadowBlur = 36; }
    ctx.fillStyle = on ? PADS[i].lit : PADS[i].base; ctx.fill();
    ctx.shadowBlur = 0; ctx.clip();
    if (!on) { const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(0,0,0,.25)'); ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h); }
    else { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(r.x, r.y, r.w, 26); }
    ctx.restore();
    ctx.textAlign = 'center'; ctx.font = '700 11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(`${PADS[i].key.slice(3)}`, r.x + r.w / 2 + PADS[i].cx * -50, r.y + r.h / 2 + PADS[i].cy * -50 + 4);
  }
  // 가운데 표시
  ctx.fillStyle = '#10102a'; ctx.beginPath(); ctx.arc(CX, CY, 56, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '900 34px sans-serif'; ctx.fillText(String(G.len), CX, CY + 6);
  ctx.font = '700 11px sans-serif'; ctx.fillStyle = '#c8c8ff'; ctx.fillText(G.params.reverse ? '개 (거꾸로)' : '개', CX, CY + 24);
  // 위쪽 안내
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, W, 40);
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = '900 16px sans-serif'; ctx.fillText(tut ? '연습' : `점수 ${G.score}`, 10, 26);
  if (!tut) { ctx.fillStyle = '#ff6a7a'; ctx.font = '15px sans-serif'; ctx.fillText('♥'.repeat(Math.max(0, G.lives)) + '♡'.repeat(Math.max(0, G.maxLives - Math.max(0, G.lives))), 10, 58); }
  const msg = { ready: '준비…', show: G.params.reverse ? '잘 보세요! (뒤에서부터 누를 거예요)' : '잘 보고 들으세요!', input: G.params.reverse ? `거꾸로 누르세요! ${G.idx}/${G.len}` : `내 차례! ${G.idx}/${G.len}`, result: '맞았어요!', fail: G.lastWrong && G.lastWrong.timeout ? '시간 초과… 맞는 패드는 이거예요' : '아쉬워요… 맞는 패드는 이거예요' }[G.phase] || '';
  ctx.textAlign = 'center'; ctx.font = '900 19px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.fillStyle = G.phase === 'result' ? '#9dff9d' : G.phase === 'fail' ? '#ff9a9a' : '#fff'; ctx.strokeText(msg, W / 2, 112); ctx.fillText(msg, W / 2, 112);
  // 누를 차례의 진행 점
  if (G.phase === 'input' || G.phase === 'result') { const n = G.len, gap = Math.min(18, 260 / n); const x0 = W / 2 - ((n - 1) * gap) / 2; for (let i = 0; i < n; i++) { ctx.fillStyle = i < G.idx ? '#9dff9d' : 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(x0 + i * gap, 142, 4.5, 0, 7); ctx.fill(); } }
  // 남은 시간(보통·거꾸로)
  if (G.phase === 'input' && G.params.limit && !tut) { const f = Math.max(0, 1 - G.pressT / G.params.limit); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(80, 156, 200, 7); ctx.fillStyle = f > 0.3 ? '#7be0ff' : '#ff6a7a'; ctx.fillRect(81, 157, 198 * f, 5); }
  ctx.font = '900 18px sans-serif'; ctx.lineWidth = 3;
  for (const f of floats) { const k = f.t / 1.2; ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color; ctx.strokeText(f.text, f.x, f.y - 90 - k * 26); ctx.fillText(f.text, f.x, f.y - 90 - k * 26); ctx.globalAlpha = 1; }
  if (flashRed > 0) { ctx.fillStyle = `rgba(255,40,40,${flashRed * 0.5})`; ctx.fillRect(0, 0, W, H); }
}

let last = performance.now();
function frame(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame); }
showTitle();
requestAnimationFrame(frame);

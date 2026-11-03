'use strict';
// 사이먼(색·소리 순서 기억): 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 네 색 패드가 빛나고 소리 나는 순서를 보고 외워서 똑같이(거꾸로 모드는 거꾸로) 누른다. 맞힐 때마다 순서가 하나씩 길어진다.
(function (root) {
  const PADS = 4;
  const READY = 0.8, RESULT = 0.9, FAIL = 1.5;      // 보여 주기 전 · 성공 뒤 · 틀린 뒤 기다리는 시간(초)
  const LEVELS = {
    easy: { label: '쉬움', lives: 3, step: [0.9, 0.75, 0.62, 0.52], limit: 0, reverse: false },
    normal: { label: '보통', lives: 1, step: [0.7, 0.55, 0.42, 0.34], limit: 5, reverse: false },
    reverse: { label: '거꾸로', lives: 2, step: [0.8, 0.65, 0.52, 0.42], limit: 7, reverse: true },
  };
  const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

  // 순서가 길어질수록 빨라짐: 5개 · 9개 · 13개부터
  const tierOf = (len) => (len >= 13 ? 3 : len >= 9 ? 2 : len >= 5 ? 1 : 0);
  const stepOf = (level, len) => LEVELS[level].step[tierOf(len)];

  function newGame(rand, opts = {}) {
    rand = rand || Math.random;
    const lv = LEVELS[opts.level] ? opts.level : 'normal';
    const params = LEVELS[lv];
    const st = { rand, level: lv, params, seq: [], len: 0, phase: 'ready', t: 0, idx: 0, lives: params.lives, maxLives: params.lives, score: 0, cleared: 0, wrongs: 0, over: false, events: [], tutorial: !!opts.tutorial, pressT: 0, lastWrong: null };
    nextRound(st, opts.startLen || 1);
    return st;
  }

  // 순서를 하나 더하고 (같은 색이 세 번 넘게 이어지지 않게) 처음부터 보여 준다
  function nextRound(st, minLen) {
    const target = minLen ? Math.max(minLen, st.seq.length) : st.seq.length + 1;
    while (st.seq.length < target) {
      let p = Math.floor(st.rand() * PADS), n = st.seq.length;
      if (n >= 2 && st.seq[n - 1] === p && st.seq[n - 2] === p) p = (p + 1 + Math.floor(st.rand() * (PADS - 1))) % PADS;
      st.seq.push(p);
    }
    st.len = st.seq.length; st.phase = 'ready'; st.t = 0; st.idx = 0; st.pressT = 0;
    st.events.push({ type: 'round', len: st.len });
  }
  const expected = (st, i) => (st.params.reverse ? st.seq[st.len - 1 - i] : st.seq[i]);

  // 지금 빛나는 패드 (보여 주는 중일 때만), 없으면 -1
  function litPad(st) {
    if (st.phase !== 'show') return -1;
    const step = stepOf(st.level, st.len), i = Math.floor(st.t / step), within = st.t - i * step;
    return i < st.len && within < step * 0.7 ? st.seq[i] : -1;
  }

  // 패드를 눌렀다 (내 차례일 때만)
  function press(st, pad) {
    if (st.over || st.phase !== 'input' || pad < 0 || pad >= PADS) return false;
    st.pressT = 0;
    if (pad === expected(st, st.idx)) {
      st.idx++; st.events.push({ type: 'ok', pad, idx: st.idx, len: st.len });
      if (st.idx >= st.len) {
        st.score += st.len; st.cleared = Math.max(st.cleared, st.len); st.phase = 'result'; st.t = 0;
        st.events.push({ type: 'success', len: st.len, score: st.score });
      }
    } else wrong(st, pad, false);
    return true;
  }
  function wrong(st, pad, timeout) {
    st.wrongs++; st.lastWrong = { pad, expected: expected(st, st.idx), timeout };
    if (!(st.tutorial)) st.lives--;
    st.phase = 'fail'; st.t = 0;
    st.events.push({ type: 'wrong', pad, expected: st.lastWrong.expected, timeout, lives: st.lives });
    if (st.lives <= 0) { st.over = true; st.events.push({ type: 'over', cleared: st.cleared }); }
  }

  function step(st, dt) {
    if (st.over) return;
    let left = dt;
    while (left > 1e-9 && !st.over) {
      if (st.phase === 'ready') { const need = READY - st.t; if (left < need) { st.t += left; left = 0; } else { left -= need; st.phase = 'show'; st.t = 0; st.shown = 0; st.events.push({ type: 'showStart', len: st.len }); } }
      else if (st.phase === 'show') {
        const step = stepOf(st.level, st.len), total = st.len * step, need = total - st.t;
        st.t += Math.min(left, need);
        while (st.shown < st.len && st.shown * step <= st.t + 1e-9) { st.events.push({ type: 'show', pad: st.seq[st.shown], i: st.shown }); st.shown++; }
        if (left < need) left = 0; else { left -= need; st.phase = 'input'; st.t = 0; st.pressT = 0; st.events.push({ type: 'yourTurn', len: st.len }); }
      }
      else if (st.phase === 'input') {
        const lim = st.params.limit;
        if (lim && !st.tutorial) { const need = lim - st.pressT; if (left < need) { st.pressT += left; left = 0; } else { left = 0; wrong(st, -1, true); } }
        else { st.pressT += left; left = 0; }
      }
      else if (st.phase === 'result') { const need = RESULT - st.t; if (left < need) { st.t += left; left = 0; } else { left -= need; nextRound(st); } }
      else if (st.phase === 'fail') {
        const need = FAIL - st.t;
        if (left < need) { st.t += left; left = 0; }
        else { left -= need; st.phase = 'ready'; st.t = 0; st.idx = 0; st.events.push({ type: 'replay', len: st.len }); }       // 같은 순서를 다시 보여 줌
      } else break;
    }
  }

  const api = { PADS, READY, RESULT, FAIL, LEVELS, rng, tierOf, stepOf, newGame, press, step, litPad, expected };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_SIMON = api;
})(typeof window !== 'undefined' ? window : globalThis);

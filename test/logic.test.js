'use strict';
// 사이먼 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const fresh = (opts = {}) => L.newGame(L.rng(7), Object.assign({ level: 'normal' }, opts));
const clearEv = (st) => { const e = st.events.slice(); st.events.length = 0; return e; };
const toInput = (st) => { for (let i = 0; i < 60 * 80 && st.phase !== 'input'; i++) L.step(st, 1 / 60); assert.strictEqual(st.phase, 'input'); };
const answer = (st) => { toInput(st); for (let i = 0; i < st.len; i++) assert.ok(L.press(st, L.expected(st, i))); };

test('speed tiers: faster from 5, 9 and 13 steps; easy is slower than normal', () => {
  for (const level of ['easy', 'normal', 'reverse']) {
    let prev = Infinity;
    for (let len = 1; len <= 20; len++) { const s = L.stepOf(level, len); assert.ok(s <= prev + 1e-9 && s >= 0.3); prev = s; }
    assert.strictEqual(L.tierOf(4), 0); assert.strictEqual(L.tierOf(5), 1); assert.strictEqual(L.tierOf(9), 2); assert.strictEqual(L.tierOf(13), 3);
  }
  for (let len = 1; len <= 20; len++) assert.ok(L.stepOf('easy', len) > L.stepOf('normal', len));
});

test('new game: one pad to remember, lives by level, shows after a short wait', () => {
  const e = fresh({ level: 'easy' }), n = fresh({ level: 'normal' }), r = fresh({ level: 'reverse' });
  assert.deepStrictEqual([e.lives, n.lives, r.lives], [3, 1, 2]);
  assert.strictEqual(n.len, 1); assert.strictEqual(n.seq.length, 1); assert.strictEqual(n.phase, 'ready');
  assert.ok(n.seq[0] >= 0 && n.seq[0] < 4);
});

test('same seed gives the same sequence; no pad repeats more than three times in a row', () => {
  const a = L.newGame(L.rng(5), { level: 'normal' }), b = L.newGame(L.rng(5), { level: 'normal' });
  for (let r = 0; r < 40; r++) { answer(a); answer(b); for (let i = 0; i < 200 && a.phase !== 'ready'; i++) { L.step(a, 1 / 60); L.step(b, 1 / 60); } }
  assert.deepStrictEqual(a.seq, b.seq); assert.ok(a.seq.length >= 40);
  for (let i = 2; i < a.seq.length; i++) assert.ok(!(a.seq[i] === a.seq[i - 1] && a.seq[i] === a.seq[i - 2] && a.seq[i] === a.seq[i - 3] && i >= 3), 'four in a row at ' + i);
  for (let i = 2; i < a.seq.length; i++) assert.ok(!(a.seq[i] === a.seq[i - 1] && a.seq[i] === a.seq[i - 2]), 'three in a row at ' + i);
});

test('the show phase lights each pad once, in order, at the right times', () => {
  const st = fresh(); answer(st);
  for (let i = 0; i < 200 && st.phase !== 'show'; i++) L.step(st, 1 / 60);
  clearEv(st);
  const seen = []; let guard = 0;
  while (st.phase === 'show' && guard++ < 2000) { L.step(st, 1 / 120); for (const e of clearEv(st)) if (e.type === 'show') seen.push(e.pad); }
  assert.strictEqual(st.len, 2); assert.deepStrictEqual(seen, st.seq);
  const t = fresh(); toInput(t);
  const t2 = fresh(); for (let i = 0; i < 60 * 0.8 + 3; i++) L.step(t2, 1 / 60);
  assert.strictEqual(t2.phase, 'show'); assert.strictEqual(L.litPad(t2), t2.seq[0], 'the first pad is lit at the start of the show');
  for (let i = 0; i < 60 * 0.6; i++) L.step(t2, 1 / 60);
  assert.strictEqual(L.litPad(t2), -1, 'dark between pads / after the last one');
  void t;
});

test('input is ignored before your turn and after the game ends', () => {
  const st = fresh();
  assert.strictEqual(L.press(st, 0), false);
  toInput(st);
  assert.strictEqual(L.press(st, 9), false); assert.strictEqual(L.press(st, -2), false);
});

test('repeating the sequence correctly scores its length and adds one more pad', () => {
  const st = fresh();
  for (let r = 1; r <= 4; r++) {
    answer(st);
    assert.strictEqual(st.phase, 'result'); assert.strictEqual(st.cleared, r);
    for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60);
    assert.strictEqual(st.len, r + 1);
  }
  assert.strictEqual(st.score, 1 + 2 + 3 + 4);
  assert.ok(clearEv(st).filter((e) => e.type === 'success').length === 4);
});

test('reverse mode expects the sequence backwards', () => {
  const st = fresh({ level: 'reverse' });
  for (let r = 0; r < 2; r++) { answer(st); for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60); }
  toInput(st); assert.strictEqual(st.len, 3);
  assert.strictEqual(L.expected(st, 0), st.seq[2]); assert.strictEqual(L.expected(st, 2), st.seq[0]);
  const wrongFirst = st.seq[0] === st.seq[2] ? (st.seq[2] + 1) % 4 : st.seq[0];
  L.press(st, wrongFirst);
  assert.strictEqual(st.phase, 'fail', 'pressing in forward order is wrong');
});

test('a wrong press costs a life, shows the right pad, then replays the same sequence (or ends the game)', () => {
  const st = fresh({ level: 'easy' }); answer(st); for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60);
  toInput(st); const seq = st.seq.slice(); const bad = (L.expected(st, 0) + 1) % 4;
  L.press(st, bad);
  assert.strictEqual(st.lives, 2); assert.strictEqual(st.phase, 'fail');
  const ev = clearEv(st).find((e) => e.type === 'wrong'); assert.strictEqual(ev.pad, bad); assert.strictEqual(ev.expected, seq[0]);
  for (let i = 0; i < 60 * 3 && st.phase === 'fail'; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.phase, 'ready'); assert.deepStrictEqual(st.seq, seq, 'the same sequence is shown again');
  assert.strictEqual(st.idx, 0);
  const n = fresh({ level: 'normal' }); toInput(n); L.press(n, (L.expected(n, 0) + 1) % 4);
  assert.strictEqual(n.over, true); assert.strictEqual(n.lives, 0);
  assert.ok(clearEv(n).some((e) => e.type === 'over'));
  assert.strictEqual(L.press(n, 0), false);
});

test('a partly right answer then a mistake restarts the answer from the first pad on replay', () => {
  const st = fresh({ level: 'easy' });
  for (let r = 0; r < 3; r++) { answer(st); for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60); }
  toInput(st); L.press(st, L.expected(st, 0)); assert.strictEqual(st.idx, 1);
  L.press(st, (L.expected(st, 1) + 1) % 4); assert.strictEqual(st.phase, 'fail');
  for (let i = 0; i < 60 * 3 && st.phase !== 'input'; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.idx, 0);
});

test('normal and reverse have a time limit per press; easy waits forever', () => {
  const n = fresh({ level: 'normal' }); toInput(n);
  for (let i = 0; i < 60 * 4.5; i++) L.step(n, 1 / 60);
  assert.strictEqual(n.phase, 'input');
  for (let i = 0; i < 60; i++) L.step(n, 1 / 60);
  assert.strictEqual(n.over, true);
  assert.ok(clearEv(n).some((e) => e.type === 'wrong' && e.timeout));
  const e = fresh({ level: 'easy' }); toInput(e);
  for (let i = 0; i < 60 * 60; i++) L.step(e, 1 / 60);
  assert.strictEqual(e.phase, 'input'); assert.strictEqual(e.lives, 3);
  // 누를 때마다 시간이 다시 시작됨
  const m = fresh({ level: 'normal' }); answer(m); for (let i = 0; i < 200 && m.phase === 'result'; i++) L.step(m, 1 / 60); toInput(m);
  for (let i = 0; i < 60 * 4; i++) L.step(m, 1 / 60); L.press(m, L.expected(m, 0));
  for (let i = 0; i < 60 * 4; i++) L.step(m, 1 / 60);
  assert.strictEqual(m.over, false, 'the timer restarts after each press');
});

test('tutorial: lives never drop and there is no time limit', () => {
  const st = L.newGame(L.rng(2), { level: 'normal', tutorial: true }); toInput(st);
  for (let i = 0; i < 60 * 30; i++) L.step(st, 1 / 60);
  assert.strictEqual(st.phase, 'input');
  L.press(st, (L.expected(st, 0) + 1) % 4);
  assert.strictEqual(st.lives, st.maxLives); assert.strictEqual(st.over, false);
});

test('a big step gives the same result as many small ones', () => {
  const a = L.newGame(L.rng(4), { level: 'normal' }), b = L.newGame(L.rng(4), { level: 'normal' });
  for (let i = 0; i < 60 * 3; i++) L.step(a, 1 / 60);
  L.step(b, 3);
  assert.strictEqual(a.phase, b.phase);
});

test('a perfect player gets far; an impatient one loses at the first mistake in normal', () => {
  const st = L.newGame(L.rng(11), { level: 'normal' });
  for (let r = 0; r < 31 && !st.over; r++) { answer(st); for (let i = 0; i < 200 && st.phase === 'result'; i++) L.step(st, 1 / 60); }
  assert.strictEqual(st.over, false); assert.ok(st.cleared >= 31);
  assert.ok(L.stepOf('normal', 31) <= 0.34);
});

/* helpers.js — small pure utilities */

const $ = (s) => document.querySelector(s);

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function opponentOf(c) {
  return c === 'w' ? 'b' : 'w';
}

function colorName(c) {
  return c === 'w' ? 'White' : 'Black';
}

function algebra(r, c) {
  return 'abcdefgh'[c] + (8 - r);
}

function sideToMoveFromExpected(board, expected) {
  if (!expected) return 'w';
  const from = expected.split('-')[0];
  if (!from || from.length < 2) return 'w';
  const c = from.charCodeAt(0) - 97;
  const r = 8 - parseInt(from[1], 10);
  const p = board[r] && board[r][c];
  return p ? p.c : 'w';
}

function getPieceSvg(t) {
  return PIECE_SVG[t];
}

function formatTime(n) {
  if (n <= 0) return '0:00';
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

/* board.js — board creation, FEN, cloning */

function createInitialBoard() {
  const board = Array(8).fill().map(() => Array(8).fill(null));
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f++) {
    board[0][f] = { c: 'b', t: back[f] };
    board[1][f] = { c: 'b', t: 'p' };
    board[6][f] = { c: 'w', t: 'p' };
    board[7][f] = { c: 'w', t: back[f] };
  }
  return board;
}

function boardFromFen(fen) {
  const board = Array(8).fill().map(() => Array(8).fill(null));
  fen.split('/').forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (+ch) c += +ch;
      else board[r][c++] = { c: ch === ch.toUpperCase() ? 'w' : 'b', t: ch.toLowerCase() };
    }
  });
  return board;
}

function boardToFen(board) {
  return board
    .map((row) => {
      let out = '', empty = 0;
      for (const p of row) {
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p.c === 'w' ? p.t.toUpperCase() : p.t;
      }
      if (empty) out += empty;
      return out;
    })
    .join('/');
}

/* مفتاح فريد للموضع الحالي (رقعة + دور + حقوق التبييت + إمكانية الأخذ بالتمرير)
   يُستخدم لاكتشاف تكرار نفس الموضع ثلاث مرات (draw by threefold repetition) */
function positionKey(s) {
  const cw = s.castling.w, cb = s.castling.b;
  const castleStr = (cw.k ? 'K' : '') + (cw.q ? 'Q' : '') + (cb.k ? 'k' : '') + (cb.q ? 'q' : '') || '-';
  return boardToFen(s.board) + ' ' + s.turn + ' ' + castleStr + ' ' + (s.ep ? s.ep.join(',') : '-');
}

function createGameState(fen = null) {
  const s = {
    board: fen ? boardFromFen(fen) : createInitialBoard(),
    turn: 'w',
    castling: { w: { k: true, q: true }, b: { k: true, q: true } },
    ep: null,
    history: [],
    halfmove: 0,
    last: null,
    over: false,
  };
  s.positions = [positionKey(s)];
  return s;
}

/* تحويل حالة اللعبة المحلية إلى حقول قابلة للتخزين في Firestore (بدون مصفوفات متداخلة) */
function stateToMatchFields(s) {
  return {
    fen: boardToFen(s.board),
    turn: s.turn,
    castling: { wk: s.castling.w.k, wq: s.castling.w.q, bk: s.castling.b.k, bq: s.castling.b.q },
    ep: s.ep ? [s.ep[0], s.ep[1]] : null,
    halfmove: s.halfmove,
    lastFrom: s.last ? s.last[0] : null,
    lastTo: s.last ? s.last[1] : null,
    history: s.history,
    moveCount: s.history.length,
  };
}

/* إعادة بناء حالة اللعبة المحلية من وثيقة مباراة Firestore */
function matchFieldsToState(m) {
  const s = {
    board: boardFromFen(m.fen),
    turn: m.turn,
    castling: {
      w: { k: !!m.castling?.wk, q: !!m.castling?.wq },
      b: { k: !!m.castling?.bk, q: !!m.castling?.bq },
    },
    ep: m.ep || null,
    history: m.history || [],
    halfmove: m.halfmove || 0,
    last: m.lastFrom && m.lastTo ? [m.lastFrom, m.lastTo] : null,
    over: !!m.over,
  };
  // ما نخزن سجل المواضع الكامل في Firestore، فنبدأ من الموضع الحالي فقط —
  // يكفي لاكتشاف أي تكرار يحصل من هذه اللحظة فصاعدًا
  s.positions = [positionKey(s)];
  return s;
}

function cloneState(s) {
  return {
    board: s.board.map((row) => row.map((p) => (p ? { ...p } : null))),
    turn: s.turn,
    castling: {
      w: { ...s.castling.w },
      b: { ...s.castling.b },
    },
    ep: s.ep ? [...s.ep] : null,
    history: [...s.history],
    positions: [...(s.positions || [])],
    halfmove: s.halfmove,
    last: s.last,
    over: s.over,
    puzzle: s.puzzle,
    expected: s.expected,
    stage: s.stage,
    showHint: s.showHint,
    wrongAttempts: s.wrongAttempts,
  };
}

/* moves.js — move generation, legality, notation */

function pseudoMoves(s, r, c, attacks = false) {
  const piece = s.board[r][c];
  if (!piece) return [];
  const out = [];
  const add = (rr, cc, extra = {}) => {
    if (inBounds(rr, cc) && (!s.board[rr][cc] || s.board[rr][cc].c !== piece.c))
      out.push({ from: [r, c], to: [rr, cc], ...extra });
  };
  if (piece.t === 'p') {
    const dir = piece.c === 'w' ? -1 : 1;
    const start = piece.c === 'w' ? 6 : 1;
    if (!attacks && inBounds(r + dir, c) && !s.board[r + dir][c]) {
      add(r + dir, c);
      if (r === start && !s.board[r + 2 * dir][c]) add(r + 2 * dir, c, { double: true });
    }
    for (const dc of [-1, 1]) {
      const rr = r + dir, cc = c + dc;
      if (inBounds(rr, cc) && (attacks || (s.board[rr][cc] && s.board[rr][cc].c !== piece.c))) add(rr, cc);
      if (!attacks && s.ep && s.ep[0] === rr && s.ep[1] === cc) add(rr, cc, { enPassant: true });
    }
  } else if (piece.t === 'n') {
    for (const [dr, dc] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]])
      add(r + dr, c + dc);
  } else if (piece.t === 'k') {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) add(r + dr, c + dc);
    if (!attacks) {
      const rookHome = (col) => s.board[r][col]?.c === piece.c && s.board[r][col].t === 'r';
      if (s.castling[piece.c].k && !s.board[r][5] && !s.board[r][6] && rookHome(7))
        out.push({ from: [r, c], to: [r, 6], castle: 'k' });
      if (s.castling[piece.c].q && !s.board[r][1] && !s.board[r][2] && !s.board[r][3] && rookHome(0))
        out.push({ from: [r, c], to: [r, 2], castle: 'q' });
    }
  } else {
    const dirs =
      piece.t === 'b'
        ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        : piece.t === 'r'
          ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
          : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        if (!s.board[rr][cc]) out.push({ from: [r, c], to: [rr, cc] });
        else {
          if (s.board[rr][cc].c !== piece.c) out.push({ from: [r, c], to: [rr, cc] });
          break;
        }
        rr += dr;
        cc += dc;
      }
    }
  }
  return out;
}

function isAttacked(s, r, c, by) {
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      const p = s.board[i][j];
      if (p?.c === by && pseudoMoves(s, i, j, true).some((m) => m.to[0] === r && m.to[1] === c))
        return true;
    }
  return false;
}

function isInCheck(s, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (s.board[r][c]?.c === color && s.board[r][c].t === 'k')
        return isAttacked(s, r, c, opponentOf(color));
  return false;
}

function applyMove(s, move, promotion = 'q') {
  const next = cloneState(s);
  const piece = next.board[move.from[0]][move.from[1]];
  let captured = next.board[move.to[0]][move.to[1]];
  next.board[move.from[0]][move.from[1]] = null;
  next.board[move.to[0]][move.to[1]] = { ...piece };
  if (move.enPassant) {
    captured = next.board[move.from[0]][move.to[1]];
    next.board[move.from[0]][move.to[1]] = null;
  }
  if (move.castle) {
    const row = move.from[0];
    if (move.castle === 'k') {
      next.board[row][5] = next.board[row][7];
      next.board[row][7] = null;
    } else {
      next.board[row][3] = next.board[row][0];
      next.board[row][0] = null;
    }
  }
  if (piece.t === 'p' && (move.to[0] === 0 || move.to[0] === 7))
    next.board[move.to[0]][move.to[1]].t = promotion;
  if (piece.t === 'k') next.castling[piece.c].k = next.castling[piece.c].q = false;
  if (piece.t === 'r') {
    if (move.from[1] === 0) next.castling[piece.c].q = false;
    if (move.from[1] === 7) next.castling[piece.c].k = false;
  }
  if (captured?.t === 'r') {
    if (move.to[1] === 0) next.castling[opponentOf(piece.c)].q = false;
    if (move.to[1] === 7) next.castling[opponentOf(piece.c)].k = false;
  }
  next.ep = move.double ? [(move.from[0] + move.to[0]) / 2, move.from[1]] : null;
  next.halfmove = piece.t === 'p' || captured ? 0 : next.halfmove + 1;
  next.turn = opponentOf(s.turn);
  next.last = [move.from, move.to];
  next.positions.push(positionKey(next));
  return next;
}

function legalMoves(s, color = s.turn) {
  const moves = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (s.board[r][c]?.c !== color) continue;
      for (const move of pseudoMoves(s, r, c)) {
        if (move.castle) {
          const pass = move.castle === 'k' ? 5 : 3;
          if (
            isInCheck(s, color) ||
            isAttacked(s, move.from[0], pass, opponentOf(color)) ||
            isAttacked(s, move.from[0], move.to[1], opponentOf(color))
          )
            continue;
        }
        if (!isInCheck(applyMove(s, move), color)) moves.push(move);
      }
    }
  return moves;
}

function hasInsufficientMaterial(s) {
  let minor = 0,
    major = false;
  for (const row of s.board)
    for (const p of row) {
      if (!p || p.t === 'k') continue;
      if (p.t === 'p' || p.t === 'r' || p.t === 'q') major = true;
      else minor++;
    }
  return !major && minor <= 1;
}

function moveNotation(pre, move, prom, replyMoves, inCheck) {
  let base;
  if (move.castle) base = move.castle === 'k' ? 'O-O' : 'O-O-O';
  else {
    const piece = pre.board[move.from[0]][move.from[1]];
    const target = pre.board[move.to[0]][move.to[1]];
    const cap = !!target || move.enPassant;
    const file = 'abcdefgh'[move.to[1]],
      rank = 8 - move.to[0];
    const prefix =
      piece.t === 'p'
        ? cap
          ? 'abcdefgh'[move.from[1]] + 'x'
          : ''
        : piece.t.toUpperCase() + (cap ? 'x' : '');
    base = prefix + file + rank;
    if (piece.t === 'p' && (move.to[0] === 0 || move.to[0] === 7)) base += '=' + prom.toUpperCase();
  }
  if (inCheck) base += replyMoves.length ? '+' : '#';
  return base;
}

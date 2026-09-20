/* engine.js — evaluation and bot search */

function evaluate(s) {
  let score = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = s.board[r][c];
      if (!p) continue;
      const pos = PST[p.t][p.c === 'w' ? r : 7 - r][c];
      const val = PIECE_VALUE[p.t] + pos;
      score += (p.c === 'b' ? 1 : -1) * val;
    }
  const moves = legalMoves(s);
  const mobility = moves.length * 2;
  score += s.turn === 'b' ? mobility : -mobility;
  return score;
}

function orderedMoves(s, moves) {
  return moves
    .map((m) => {
      let key = 0;
      const target = s.board[m.to[0]][m.to[1]];
      if (target) key += 10 * PIECE_VALUE[target.t] - PIECE_VALUE[s.board[m.from[0]][m.from[1]].t];
      if (m.castle) key += 50;
      return { m, key };
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.m);
}

function search(s, depth, alpha = -Infinity, beta = Infinity) {
  const moves = legalMoves(s);
  if (!moves.length) return isInCheck(s, s.turn) ? (s.turn === 'b' ? -99999 - depth : 99999 + depth) : 0;
  if (!depth) return evaluate(s);
  const ordered = orderedMoves(s, moves);
  if (s.turn === 'b') {
    let best = -Infinity;
    for (const m of ordered) {
      best = Math.max(best, search(applyMove(s, m), depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of ordered) {
    best = Math.min(best, search(applyMove(s, m), depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function botMove() {
  if (state.over || state.turn !== 'b') return;
  const depth = BOT_SEARCH_DEPTH;
  const moves = orderedMoves(state, legalMoves(state));
  let alpha = -Infinity,
    best = -Infinity,
    bestMoves = [];
  for (const m of moves) {
    const score = search(applyMove(state, m), depth - 1, alpha, Infinity);
    if (score > best) {
      best = score;
      bestMoves = [m];
    } else if (score === best) bestMoves.push(m);
    alpha = Math.max(alpha, best);
  }
  makeMove(bestMoves[Math.floor(Math.random() * bestMoves.length)], 'q');
}

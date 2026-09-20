/* ui.js — board rendering, clocks, status, drag & click */

/* يحفظ نتيجة المباراة في Firebase إن كانت الخدمة متوفرة (ما بيوقف اللعبة لو مو متوفرة) */
function saveGameToFirebase(result, reason) {
  if (state.puzzle) return; // ما نسجل مباريات البازل
  // في وضع الأونلاين، كلا الطرفين يكتشفان النهاية محليًا بنفس النتيجة —
  // نسجّل مرة واحدة فقط (من طرف اللاعب الأبيض) لتفادي تكرار السجل
  if (settings.mode === 'online' && onlineColor !== 'w') return;
  if (window.ChessDB) {
    const opts = { mode: settings.mode, moves: state.history };
    if (settings.mode === 'online') {
      opts.opponentUid = onlineOpponentUid;
      opts.youAreWhite = onlineColor === 'w';
    }
    window.ChessDB.recordGameResult(result, reason, opts).catch((err) => console.error('Firebase save error:', err));
  }
}

function setStatus(title, hint) {
  $('#statusText').textContent = title;
  $('#statusHint').textContent = hint;
}

function paintClocks() {
  if (!gameStarted || settings.time <= 0 || state?.puzzle || settings.mode === 'online') {
    $('#whiteClock').textContent = '—';
    $('#blackClock').textContent = '—';
    return;
  }
  $('#whiteClock').textContent = formatTime(seconds.w);
  $('#blackClock').textContent = formatTime(seconds.b);
}

function startClocks() {
  stopClocks();
  if (settings.time <= 0 || state.puzzle) {
    paintClocks();
    return;
  }
  seconds = { w: settings.time, b: settings.time };
  paintClocks();
  clockTimer = setInterval(() => {
    if (state.over) return;
    const side = state.turn;
    seconds[side]--;
    if (seconds[side] <= 0) {
      seconds[side] = 0;
      state.over = true;
      stopClocks();
      $('#endTitle').textContent = 'Time';
      $('#endText').textContent = `${colorName(side)} ran out of time. ${colorName(opponentOf(side))} wins.`;
      setStatus('Time forfeit', `${colorName(opponentOf(side))} wins on time.`);
      showEndModal(400);
      if (window.SFX) SFX.gameEnd('win');
      saveGameToFirebase(opponentOf(side) === 'w' ? 'white' : 'black', 'timeout');
    }
    paintClocks();
  }, 1000);
}

function stopClocks() {
  clearInterval(clockTimer);
  clockTimer = null;
}

function showEndModal(delay = 650) {
  clearTimeout(showEndModal._t);
  showEndModal._t = setTimeout(() => {
    if (state && state.over) $('#endModal').classList.remove('hidden');
  }, delay);
}

function checkEnd(moves, inCheck) {
  moves = moves || legalMoves(state);
  inCheck = inCheck ?? isInCheck(state, state.turn);
  if (!moves.length) {
    state.over = true;
    stopClocks();
    const winner = opponentOf(state.turn);
    const isMate = inCheck;
    $('#endTitle').textContent = isMate ? 'Checkmate' : 'Stalemate';
    $('#endText').textContent = isMate
      ? `${colorName(winner)} wins — ${colorName(state.turn)} has no legal move while in check.`
      : 'No legal moves remain, but the king is not in check. Draw.';
    setStatus(
      isMate ? 'Checkmate!' : 'Stalemate',
      isMate
        ? `${colorName(winner)} delivered mate. Review the highlighted move.`
        : 'Draw by stalemate.'
    );
    showEndModal(isMate ? 700 : 400);
    if (window.SFX) SFX.gameEnd(isMate ? 'checkmate' : 'draw');
    const resultStr = isMate ? (winner === 'w' ? 'white' : 'black') : 'draw';
    const reasonStr = isMate ? 'checkmate' : 'stalemate';
    saveGameToFirebase(resultStr, reasonStr);
    if (settings.mode === 'online' && onlineMatchId && window.ChessDB) {
      window.ChessDB.endMatch(onlineMatchId, resultStr, reasonStr).catch(() => {});
    }
  } else if (state.halfmove >= 100) {
    state.over = true;
    stopClocks();
    $('#endTitle').textContent = 'Draw';
    $('#endText').textContent = 'Fifty moves without a pawn move or capture.';
    setStatus('Draw', 'Fifty-move rule.');
    showEndModal(400);
    if (window.SFX) SFX.gameEnd('draw');
    saveGameToFirebase('draw', 'fifty-move rule');
    if (settings.mode === 'online' && onlineMatchId && window.ChessDB) {
      window.ChessDB.endMatch(onlineMatchId, 'draw', 'fifty-move rule').catch(() => {});
    }
  } else if (hasInsufficientMaterial(state)) {
    state.over = true;
    stopClocks();
    $('#endTitle').textContent = 'Draw';
    $('#endText').textContent = 'Insufficient material to checkmate.';
    setStatus('Draw', 'Insufficient material.');
    showEndModal(400);
    if (window.SFX) SFX.gameEnd('draw');
    saveGameToFirebase('draw', 'insufficient material');
    if (settings.mode === 'online' && onlineMatchId && window.ChessDB) {
      window.ChessDB.endMatch(onlineMatchId, 'draw', 'insufficient material').catch(() => {});
    }
  } else if (state.positions && state.positions.length && state.positions.filter((p) => p === state.positions[state.positions.length - 1]).length >= 3) {
    state.over = true;
    stopClocks();
    $('#endTitle').textContent = 'Draw';
    $('#endText').textContent = 'The same position has occurred three times.';
    setStatus('Draw', 'Threefold repetition.');
    showEndModal(400);
    if (window.SFX) SFX.gameEnd('draw');
    saveGameToFirebase('draw', 'threefold repetition');
    if (settings.mode === 'online' && onlineMatchId && window.ChessDB) {
      window.ChessDB.endMatch(onlineMatchId, 'draw', 'threefold repetition').catch(() => {});
    }
  } else if (inCheck) {
    setStatus(`${colorName(state.turn)} is in check`, 'Protect the king.');
  }
}

function render() {
  if (!state) return;
  const b = $('#board');
  if (!b) return;
  b.innerHTML = '';
  const order = [...Array(8).keys()];
  const rows = flipped ? [...order].reverse() : order;
  const cols = flipped ? [...order].reverse() : order;
  const check = gameStarted && isInCheck(state, state.turn);
  let kingSq = null;
  if (check) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (state.board[r][c]?.c === state.turn && state.board[r][c].t === 'k') kingSq = [r, c];
  }
  let hintSq = null;
  if (state.expected && !state.over) {
    const show = state.puzzle && state.showHint;
    if (show) {
      const parts = state.expected.split('-');
      if (parts[1]) hintSq = [8 - +parts[1][1], parts[1].charCodeAt(0) - 97];
    }
  }
  for (const r of rows)
    for (const c of cols) {
      const sq = document.createElement('button');
      const piece = state.board[r][c];
      const isSel = selected?.[0] === r && selected?.[1] === c;
      const legal = legalForSelected.find((m) => m.to[0] === r && m.to[1] === c);
      const isLast = state.last && [state.last[0], state.last[1]].some((s) => s[0] === r && s[1] === c);
      const isKing = kingSq && kingSq[0] === r && kingSq[1] === c;
      const isHint = hintSq && hintSq[0] === r && hintSq[1] === c;
      sq.className = [
        'square',
        (r + c) % 2 ? 'dark' : '',
        isSel ? 'selected' : '',
        legal ? (piece ? 'capture' : 'legal') : '',
        isLast ? 'last' : '',
        isKing ? 'in-check' : '',
        isHint ? 'hint' : '',
      ]
        .filter(Boolean)
        .join(' ');
      sq.type = 'button';
      sq.dataset.r = r;
      sq.dataset.c = c;
      sq.onclick = () => {
        if (suppressNextClick) {
          suppressNextClick = false;
          return;
        }
        clickSquare(r, c);
      };
      sq.addEventListener('pointerdown', (e) => beginDrag(e, r, c, piece));
      if (piece) {
        const span = document.createElement('span');
        const dragSrc = draggingFrom && draggingFrom[0] === r && draggingFrom[1] === c;
        span.className =
          'piece ' + (piece.c === 'w' ? 'white-piece' : 'black-piece') + (dragSrc ? ' dragging-source' : '');
        span.innerHTML = getPieceSvg(piece.t);
        sq.append(span);
      }
      if (r === rows[rows.length - 1]) {
        const f = document.createElement('span');
        f.className = 'coord coord-file';
        f.textContent = 'abcdefgh'[c];
        sq.append(f);
      }
      if (c === cols[0]) {
        const rk = document.createElement('span');
        rk.className = 'coord coord-rank';
        rk.textContent = 8 - r;
        sq.append(rk);
      }
      b.append(sq);
    }
  b.classList.toggle('thinking', gameStarted && settings.mode === 'bot' && state.turn === 'b' && !state.over);
  if (gameStarted && !state.over && !check && !state.puzzle) {
    if (settings.mode === 'online') {
      const yourTurn = state.turn === onlineColor;
      setStatus(
        yourTurn ? 'Your move' : 'Opponent to move',
        yourTurn ? 'Choose a piece to see legal moves.' : 'Waiting for your opponent…'
      );
    } else {
      const human = state.turn === 'w' || settings.mode === 'local';
      setStatus(
        `${colorName(state.turn)} to move`,
        human ? 'Choose a piece to see legal moves.' : 'Computer is thinking…'
      );
    }
  }
  if (gameStarted) {
    $('#whiteDot').classList.toggle('active', state.turn === 'w');
    $('#blackDot').classList.toggle('active', state.turn === 'b');
    $('#moveList').innerHTML = state.history.map((t) => `<li>${t}</li>`).join('');
  }
  paintClocks();
}

/* Finds the legal move (if any) that lands on (r,c). Also recognises the common
   convention of clicking/dropping the king directly on its own rook to castle,
   instead of requiring the exact two-square king hop. */
function findCastleAwareMove(movesList, fromRow, r, c) {
  const direct = movesList.find((m) => m.to[0] === r && m.to[1] === c);
  if (direct) return direct;
  if (r === fromRow) {
    return (
      movesList.find((m) => m.castle && ((m.castle === 'k' && c === 7) || (m.castle === 'q' && c === 0))) || null
    );
  }
  return null;
}

function clickSquare(r, c) {
  if (!gameStarted || state.over || (settings.mode === 'bot' && state.turn === 'b')) return;
  if (settings.mode === 'online' && state.turn !== onlineColor) return;
  const piece = state.board[r][c];
  if (selected) {
    const move = findCastleAwareMove(legalForSelected, selected[0], r, c);
    if (move) {
      if (state.board[selected[0]][selected[1]].t === 'p' && (move.to[0] === 0 || move.to[0] === 7)) {
        choosePromotion(move);
        return;
      }
      playMove(move);
      return;
    }
  }
  if (piece?.c === state.turn) {
    selected = [r, c];
    legalForSelected = legalMoves(state).filter((m) => m.from[0] === r && m.from[1] === c);
    if (window.SFX && legalForSelected.length) SFX.select();
  } else {
    selected = null;
    legalForSelected = [];
  }
  render();
}

function beginDrag(e, r, c, piece) {
  if (!gameStarted || state.over || !piece || piece.c !== state.turn) return;
  if (settings.mode === 'bot' && state.turn === 'b') return;
  if (settings.mode === 'online' && state.turn !== onlineColor) return;
  if (e.button !== undefined && e.button !== 0) return;
  const startX = e.clientX,
    startY = e.clientY;
  const moves = legalMoves(state).filter((m) => m.from[0] === r && m.from[1] === c);
  let dragging = false,
    ghost = null,
    hover = null;
  const onMove = (ev) => {
    if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
      dragging = true;
      draggingFrom = [r, c];
      selected = [r, c];
      legalForSelected = moves;
      render();
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost piece ' + (piece.c === 'w' ? 'white-piece' : 'black-piece');
      ghost.innerHTML = getPieceSvg(piece.t);
      document.body.append(ghost);
    }
    if (!dragging) return;
    ev.preventDefault();
    ghost.style.left = ev.clientX + 'px';
    ghost.style.top = ev.clientY + 'px';
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.square');
    if (el !== hover) {
      hover?.classList.remove('drag-hover');
      hover = el && findCastleAwareMove(moves, r, +el.dataset.r, +el.dataset.c) ? el : null;
      hover?.classList.add('drag-hover');
    }
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!dragging) return;
    suppressNextClick = true;
    ghost.remove();
    hover?.classList.remove('drag-hover');
    draggingFrom = null;
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.square');
    const move = el && findCastleAwareMove(moves, r, +el.dataset.r, +el.dataset.c);
    if (move) {
      if (piece.t === 'p' && (move.to[0] === 0 || move.to[0] === 7)) {
        selected = null;
        legalForSelected = [];
        render();
        choosePromotion(move);
      } else playMove(move);
    } else {
      selected = null;
      legalForSelected = [];
      render();
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function choosePromotion(move) {
  const box = $('#promotionChoices');
  box.innerHTML = '';
  for (const t of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'piece ' + (state.turn === 'w' ? 'white-piece' : 'black-piece');
    btn.innerHTML = getPieceSvg(t);
    btn.onclick = () => {
      $('#promotionModal').classList.add('hidden');
      playMove(move, t);
    };
    box.append(btn);
  }
  $('#promotionModal').classList.remove('hidden');
}

function playMove(move, promotion = 'q') {
  makeMove(move, promotion);
}

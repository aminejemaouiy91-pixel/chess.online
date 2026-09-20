/* game.js — game state, makeMove, start / landing, themes */

const MODE_LABEL = { bot: 'Computer', local: 'Pass & play', puzzle: 'Puzzles', online: 'Online' };
const MODE_LABEL_SHORT = { bot: 'Bot', local: 'Local', puzzle: 'Puzzle', online: 'Online' };
const BOT_SEARCH_DEPTH = 3; // one well-tuned bot strength

let settings = {
  mode: 'bot',
  theme: 'ash',
  time: 0,
  puzzle: 0,
};

let state = null;
let selected = null;
let legalForSelected = [];
let flipped = false;
let botTimer = null;
let clockTimer = null;
let draggingFrom = null;
let suppressNextClick = false;
let seconds = { w: 0, b: 0 };
let gameStarted = false;

/* --- لعب أونلاين --- */
let onlineMatchId = null;
let onlineColor = null; // 'w' أو 'b' — لونك أنت في المباراة
let onlineOpponentUid = null;
let onlineUnsub = null;

function makeMove(move, promotion = 'q') {
  if (state.puzzle) {
    const n = algebra(...move.from) + '-' + algebra(...move.to);
    if (n !== state.expected) {
      state.wrongAttempts = (state.wrongAttempts || 0) + 1;
      if (state.wrongAttempts >= 1) state.showHint = true;
      $('#puzzleHint').textContent = state.showHint
        ? 'Incorrect. Gold square shows the target — try that move.'
        : 'Incorrect. Try a different move.';
      selected = null;
      legalForSelected = [];
      render();
      return;
    }
  }
  const pre = state;
  const movedPiece = pre.board[move.from[0]][move.from[1]];
  const capturedPiece = pre.board[move.to[0]][move.to[1]] || (move.enPassant ? pre.board[move.from[0]][move.to[1]] : null);
  const isPromotion = movedPiece?.t === 'p' && (move.to[0] === 0 || move.to[0] === 7);
  state = applyMove(state, move, promotion);
  const reply = legalMoves(state);
  const inCheck = isInCheck(state, state.turn);
  state.history.push(moveNotation(pre, move, promotion, reply, inCheck));
  selected = null;
  legalForSelected = [];
  render();

  if (window.SFX) {
    if (move.castle) SFX.castle();
    else if (isPromotion) SFX.promote();
    else if (capturedPiece) SFX.capture();
    else SFX.move();
    if (inCheck) SFX.check();
  }

  if (state.puzzle) {
    state.over = true;
    $('#puzzleHint').textContent = 'Correct! Well solved. On to the next when you are ready.';
    $('#nextPuzzle').classList.remove('hidden');
    setStatus('Puzzle solved!', 'Press “Next puzzle” when ready.');
    return;
  }
  if (settings.mode === 'online' && onlineMatchId && window.ChessDB) {
    window.ChessDB.pushMatchMove(onlineMatchId, stateToMatchFields(state)).catch((err) =>
      console.error('Match sync error:', err)
    );
  }
  checkEnd(reply, inCheck);
  if (!state.over && settings.mode === 'bot' && state.turn === 'b') {
    setStatus('Computer is thinking…', 'Calculating strongest reply.');
    botTimer = setTimeout(botMove, 180);
  }
}

/* الانضمام إلى مباراة أونلاين (بعد قبول تحدي أو اكتشافه تلقائيًا) والاستماع لتحديثاتها اللحظية */
function joinOnlineMatch(matchId) {
  if (!window.ChessDB || !matchId) return;
  clearTimeout(botTimer);
  stopClocks();
  if (onlineUnsub) {
    onlineUnsub();
    onlineUnsub = null;
  }
  $('#profileModal')?.classList.add('hidden');
  onlineMatchId = matchId;
  onlineColor = null;
  onlineOpponentUid = null;
  settings.mode = 'online';
  gameStarted = true;
  flipped = false;
  selected = null;
  legalForSelected = [];
  $('#landing').classList.add('hidden');
  $('#gameView').classList.remove('hidden');
  $('#endModal').classList.add('hidden');
  $('#puzzleCard').classList.add('hidden');
  $('#inTimeBlock').style.display = 'none';
  setStatus('Connecting…', 'Loading the match.');

  let initialized = false;
  onlineUnsub = window.ChessDB.listenToMatch(matchId, (m) => {
    if (!m) {
      setStatus('Match unavailable', 'This match no longer exists.');
      return;
    }
    if (!initialized) {
      initialized = true;
      const myUid = window.ChessDB.getCurrentUser()?.uid;
      onlineColor = m.whiteUid === myUid ? 'w' : 'b';
      onlineOpponentUid = onlineColor === 'w' ? m.blackUid : m.whiteUid;
      flipped = onlineColor === 'b';
      $('#whiteName').textContent = m.whiteName || 'White';
      $('#blackName').textContent = m.blackName || 'Black';
      $('#whiteSub').textContent = onlineColor === 'w' ? 'You' : 'Opponent';
      $('#blackSub').textContent = onlineColor === 'b' ? 'You' : 'Opponent';
      state = matchFieldsToState(m);
      state.puzzle = false;
      stopClocks();
      $('#whiteClock').textContent = '—';
      $('#blackClock').textContent = '—';
      render();
      return;
    }
    applyRemoteMatchUpdate(m);
  });
}

/* استقبال تحديث لحظي من Firestore لمباراة أونلاين */
function applyRemoteMatchUpdate(m) {
  if (!m || settings.mode !== 'online') return;
  const currentFen = state ? boardToFen(state.board) : null;
  const positionChanged = m.fen !== currentFen || m.turn !== state?.turn;
  if (positionChanged && !state.over) {
    state = matchFieldsToState(m);
    state.puzzle = false;
    selected = null;
    legalForSelected = [];
    render();
    const reply = legalMoves(state);
    const inCheck = isInCheck(state, state.turn);
    checkEnd(reply, inCheck);
  }
  if (!state.over && m.over) {
    state.over = true;
    stopClocks();
    if (window.SFX) {
      const kind =
        m.reason === 'checkmate'
          ? 'checkmate'
          : m.reason === 'stalemate' || m.reason === 'insufficient material' || m.reason === 'fifty-move rule'
            ? 'draw'
            : 'win';
      SFX.gameEnd(kind);
    }
    const titles = {
      checkmate: 'Checkmate',
      stalemate: 'Stalemate',
      resignation: 'Resignation',
      'fifty-move rule': 'Draw',
      'insufficient material': 'Draw',
    };
    const winnerLabel = m.winner === 'draw' ? null : m.winner === 'white' ? 'White' : 'Black';
    const text = winnerLabel ? `${winnerLabel} wins — ${m.reason}.` : `Draw — ${m.reason}.`;
    $('#endTitle').textContent = titles[m.reason] || 'Game over';
    $('#endText').textContent = text;
    setStatus(titles[m.reason] || 'Game over', text);
    showEndModal(300);
  }
}

function showLanding() {
  clearTimeout(botTimer);
  clearTimeout(showEndModal._t);
  stopClocks();
  if (settings.mode === 'online' && onlineMatchId && state && !state.over && window.ChessDB) {
    const winner = opponentOf(onlineColor) === 'w' ? 'white' : 'black';
    window.ChessDB.endMatch(onlineMatchId, winner, 'resignation').catch(() => {});
  }
  if (onlineUnsub) {
    onlineUnsub();
    onlineUnsub = null;
  }
  onlineMatchId = null;
  onlineColor = null;
  onlineOpponentUid = null;
  if (settings.mode === 'online') settings.mode = 'bot';
  gameStarted = false;
  $('#landing').classList.remove('hidden');
  $('#gameView').classList.add('hidden');
  $('#endModal').classList.add('hidden');
  updateModeUI();
}

function start() {
  if (settings.mode === 'online') return; // المباريات الأونلاين تُدار عبر joinOnlineMatch فقط
  clearTimeout(botTimer);
  stopClocks();
  if (onlineUnsub) {
    onlineUnsub();
    onlineUnsub = null;
  }
  onlineMatchId = null;
  onlineColor = null;
  onlineOpponentUid = null;
  gameStarted = true;
  $('#landing').classList.add('hidden');
  $('#gameView').classList.remove('hidden');
  $('#endModal').classList.add('hidden');

  if (settings.mode === 'puzzle') {
    const pz = PUZZLES[settings.puzzle];
    state = createGameState(pz[2]);
    state.puzzle = true;
    state.expected = pz[3];
    state.stage = settings.puzzle;
    state.showHint = false;
    state.wrongAttempts = 0;
    state.turn = sideToMoveFromExpected(state.board, state.expected);
    $('#puzzleCard').classList.remove('hidden');
    $('#puzzleName').textContent = pz[0];
    $('#puzzleHint').textContent = pz[1];
    $('#puzzleProgress').textContent = `${settings.puzzle + 1} / ${PUZZLES.length}`;
    $('#puzzleProgressBar').style.width = ((settings.puzzle + 1) / PUZZLES.length) * 100 + '%';
    $('#nextPuzzle').classList.add('hidden');
    const youColor = state.turn === 'w' ? 'White' : 'Black';
    $('#blackName').textContent = state.turn === 'b' ? 'You' : 'Puzzle';
    $('#whiteName').textContent = state.turn === 'w' ? 'You' : 'Puzzle';
    $('#blackSub').textContent = state.turn === 'b' ? youColor : 'Side to move';
    $('#whiteSub').textContent = state.turn === 'w' ? youColor : 'Side to move';
    setStatus('Find the best move', 'No hints yet — solve it yourself.');
    $('#inTimeBlock').style.display = 'none';
  } else {
    state = createGameState();
    $('#puzzleCard').classList.add('hidden');
    $('#blackName').textContent = settings.mode === 'bot' ? 'Computer' : 'Player 2';
    $('#whiteName').textContent = settings.mode === 'bot' ? 'You' : 'Player 1';
    $('#blackSub').textContent = 'Black';
    $('#whiteSub').textContent = 'White';
    setStatus('White to move', 'Choose a piece to see legal moves.');
    $('#inTimeBlock').style.display = 'block';
  }

  document.querySelectorAll('#inTime button').forEach((b) =>
    b.classList.toggle('active', +b.dataset.time === settings.time)
  );
  document.querySelectorAll('#inThemes .theme').forEach((b) =>
    b.classList.toggle('active', b.dataset.theme === settings.theme)
  );

  flipped = false;
  selected = null;
  legalForSelected = [];
  startClocks();
  render();
}

function applyTheme(theme) {
  settings.theme = theme;
  document.body.className = 'theme-' + theme + ' piece-classic';
  document.querySelectorAll('.theme').forEach((x) => x.classList.toggle('active', x.dataset.theme === theme));
}

function updateModeUI() {
  const isPuzzle = settings.mode === 'puzzle';
  $('#timeGroup').style.display = isPuzzle ? 'none' : 'block';
  $('#puzzleGroup').classList.toggle('hidden', !isPuzzle);
  syncDropdown('#modeDropdownBtn', '#modeDropdownList', MODE_LABEL);
}

function syncDropdown(btnSel, listSel, labels) {
  const btn = $(btnSel);
  const list = $(listSel);
  if (!btn || !list) return;
  btn.querySelector('.dropdown-value').textContent = labels[settings.mode];
  list.querySelectorAll('li').forEach((li) => li.classList.toggle('active', li.dataset.mode === settings.mode));
}

function rebuildPuzzleSelect() {
  const puzzleSelect = $('#puzzleSelect');
  puzzleSelect.innerHTML = '';
  PUZZLES.forEach((p, i) => {
    const diff = ['Easy', 'Medium', 'Hard', 'Expert'][p[4] - 1] || 'Easy';
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i + 1}. ${p[0]} (${diff})`;
    puzzleSelect.append(opt);
  });
  puzzleSelect.value = settings.puzzle;
}

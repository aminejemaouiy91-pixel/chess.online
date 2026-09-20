/* main.js — wire up UI events and boot the app */

function setupModeDropdown(dropdownSel, btnSel, listSel, onSelect) {
  const dropdown = $(dropdownSel);
  const btn = $(btnSel);
  const list = $(listSel);
  btn.onclick = (e) => {
    e.stopPropagation();
    document.querySelectorAll('.dropdown').forEach((d) => {
      if (d !== dropdown) d.classList.remove('open');
    });
    document.querySelectorAll('.dropdown-list').forEach((l) => {
      if (l !== list) l.classList.add('hidden');
    });
    list.classList.toggle('hidden');
    dropdown.classList.toggle('open');
  };
  list.querySelectorAll('li').forEach((li) => {
    li.onclick = () => {
      settings.mode = li.dataset.mode;
      list.classList.add('hidden');
      dropdown.classList.remove('open');
      onSelect();
    };
  });
}

const optionsToggle = $('#optionsToggle');
const optionsPanel = $('#optionsPanel');
if (optionsToggle && optionsPanel) {
  optionsToggle.onclick = () => {
    optionsPanel.classList.toggle('hidden');
    optionsToggle.classList.toggle('open');
  };
}

setupModeDropdown('#modeDropdown', '#modeDropdownBtn', '#modeDropdownList', updateModeUI);

document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-list').forEach((l) => l.classList.add('hidden'));
  document.querySelectorAll('.dropdown').forEach((d) => d.classList.remove('open'));
});

document.querySelectorAll('#timeChoices button').forEach((btn) => {
  btn.onclick = () => {
    settings.time = +btn.dataset.time;
    document.querySelectorAll('#timeChoices button').forEach((x) => x.classList.toggle('active', x === btn));
  };
});

document.querySelectorAll('#themeChoices .theme').forEach((btn) => {
  btn.onclick = () => applyTheme(btn.dataset.theme);
});

$('#puzzleSelect').onchange = () => {
  settings.puzzle = +$('#puzzleSelect').value;
};

$('#startGame').onclick = start;

document.querySelectorAll('#inTime button').forEach((btn) => {
  btn.onclick = () => {
    settings.time = +btn.dataset.time;
    document.querySelectorAll('#inTime button').forEach((x) => x.classList.toggle('active', x === btn));
    if (gameStarted && !state.puzzle) startClocks();
  };
});

document.querySelectorAll('#inThemes .theme').forEach((btn) => {
  btn.onclick = () => applyTheme(btn.dataset.theme);
});

$('#restartBtn').onclick = start;
$('#menuBtn').onclick = showLanding;
$('#menuFromEnd').onclick = showLanding;
$('#playAgain').onclick = () => {
  clearTimeout(showEndModal._t);
  $('#endModal').classList.add('hidden');
  start();
};
$('#reviewBoard').onclick = () => {
  clearTimeout(showEndModal._t);
  $('#endModal').classList.add('hidden');
  if (state && state.over) {
    const inCheck = isInCheck(state, state.turn);
    setStatus(
      inCheck ? 'Checkmate — review the board' : 'Game over — review the board',
      'Highlighted squares show the last move' + (inCheck ? ' and the mated king.' : '.')
    );
  }
};

$('#resignButton').onclick = () => {
  if (!gameStarted || state.over || state.puzzle) return;
  clearTimeout(botTimer);
  stopClocks();
  const resigner = settings.mode === 'online' ? onlineColor : state.turn;
  const winner = opponentOf(resigner);
  const winnerStr = winner === 'w' ? 'white' : 'black';
  state.over = true;
  $('#endTitle').textContent = 'Resignation';
  $('#endText').textContent = `${colorName(resigner)} resigns. ${colorName(winner)} wins.`;
  setStatus('Resignation', `${colorName(winner)} wins.`);
  showEndModal(300);
  if (window.SFX) SFX.gameEnd('win');
  saveGameToFirebase(winnerStr, 'resignation');
  if (settings.mode === 'online' && onlineMatchId && window.ChessDB) {
    window.ChessDB.endMatch(onlineMatchId, winnerStr, 'resignation').catch(() => {});
  }
};

$('#flipBoard').onclick = () => {
  if (gameStarted) {
    flipped = !flipped;
    render();
  }
};

$('#nextPuzzle').onclick = () => {
  settings.puzzle = Math.min(settings.puzzle + 1, PUZZLES.length - 1);
  $('#puzzleSelect').value = settings.puzzle;
  start();
};

/* Boot */
updateModeUI();
rebuildPuzzleSelect();

/* اكتشاف تلقائي لأي مباراة أونلاين نشطة (مثلًا عندما يقبل صديق تحديك) والدخول إليها مباشرة */
(function watchForOnlineMatches() {
  if (window.ChessDB) {
    window.ChessDB.listenToMyActiveMatch((m) => {
      if (m && m.status === 'active' && !gameStarted && onlineMatchId !== m.id) {
        joinOnlineMatch(m.id);
      }
    });
  } else {
    setTimeout(watchForOnlineMatches, 200);
  }
})();

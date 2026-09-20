/* profile.js — profile modal: name, friends, recent games */

function timeAgo(ts) {
  if (!ts?.seconds) return '';
  const diff = Date.now() / 1000 - ts.seconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

async function refreshProfile() {
  if (!window.ChessDB) return;
  await window.ChessDB.authReady;
  const user = window.ChessDB.getCurrentUser();
  if (!user) return;

  const profile = await window.ChessDB.getUserProfile();
  if (profile) {
    $('#profileNameInput').value = profile.displayName || '';
    $('#profileWins').textContent = (profile.wins || 0) + 'W';
    $('#profileLosses').textContent = (profile.losses || 0) + 'L';
    $('#profileDraws').textContent = (profile.draws || 0) + 'D';
  }
  $('#profileUid').textContent = user.uid;

  const requests = await window.ChessDB.getIncomingRequests();
  const reqList = $('#requestsList');
  reqList.innerHTML = requests.length
    ? requests
        .map(
          (r) =>
            `<li><span>${r.displayName}</span><button class="mini-accept" data-uid="${r.fromUid}">Accept</button></li>`
        )
        .join('')
    : '<li class="profile-empty">None</li>';
  reqList.querySelectorAll('.mini-accept').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await window.ChessDB.acceptFriendRequest(btn.dataset.uid);
      refreshProfile();
    };
  });

  const friends = await window.ChessDB.getFriends();
  const friendsList = $('#friendsList');
  friendsList.innerHTML = friends.length
    ? friends
        .map(
          (f) =>
            `<li><span class="friend-name-row"><span>${f.displayName}</span></span><button class="mini-play" data-uid="${f.uid}">Play</button></li>`
        )
        .join('')
    : '<li class="profile-empty">No friends yet</li>';
  friendsList.querySelectorAll('.mini-play').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Inviting…';
      try {
        await window.ChessDB.sendGameChallenge(btn.dataset.uid);
        btn.textContent = 'Invited!';
      } catch (err) {
        console.error('Challenge error:', err);
        btn.textContent = 'Play';
        btn.disabled = false;
      }
    };
  });

  const games = await window.ChessDB.getRecentGames(user.uid, 10);
  const gamesList = $('#recentGamesList');
  gamesList.innerHTML = games.length
    ? games
        .map((g) => {
          const won = g.result === 'draw' ? 'Draw' : g.whiteUid === user.uid ? (g.result === 'white' ? 'Won' : 'Lost') : g.result === 'black' ? 'Won' : 'Lost';
          return `<li><span>${won} · ${g.mode} · ${g.reason}</span><span>${timeAgo(g.playedAt)}</span></li>`;
        })
        .join('')
    : '<li class="profile-empty">No games yet</li>';
}

/* الاستماع اللحظي لتحديات اللعب الواردة وعرضها في نافذة البروفايل */
function renderGameChallenges(challenges) {
  const list = $('#gameChallengesList');
  if (!list) return;
  list.innerHTML = challenges.length
    ? challenges
        .map(
          (c) =>
            `<li><span>${c.fromName || 'Player'} challenged you</span>
             <span class="mini-btn-group">
               <button class="mini-accept" data-uid="${c.fromUid}">Accept</button>
               <button class="mini-decline" data-uid="${c.fromUid}">Decline</button>
             </span></li>`
        )
        .join('')
    : '<li class="profile-empty">None</li>';
  list.querySelectorAll('.mini-accept').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const matchId = await window.ChessDB.acceptGameChallenge(btn.dataset.uid);
        if (matchId) joinOnlineMatch(matchId);
      } catch (err) {
        console.error('Accept challenge error:', err);
        btn.disabled = false;
        btn.textContent = 'Accept';
      }
    };
  });
  list.querySelectorAll('.mini-decline').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await window.ChessDB.declineGameChallenge(btn.dataset.uid).catch(() => {});
    };
  });
}

(function watchChallenges() {
  if (window.ChessDB) {
    window.ChessDB.listenToChallenges(renderGameChallenges);
  } else {
    setTimeout(watchChallenges, 200);
  }
})();

const profileModal = $('#profileModal');
function openProfileModal() {
  if (!profileModal) return;
  profileModal.classList.remove('hidden');
  refreshProfile();
}
['#profileFab', '#profileFabGame'].forEach((sel) => {
  const btn = $(sel);
  if (btn) btn.onclick = openProfileModal;
});
if (profileModal) {
  $('#closeProfile').onclick = () => profileModal.classList.add('hidden');
  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) profileModal.classList.add('hidden');
  });
}

$('#saveNameBtn').onclick = async () => {
  const name = $('#profileNameInput').value;
  if (window.ChessDB) {
    await window.ChessDB.updateDisplayName(name);
    refreshProfile();
  }
};

$('#copyCodeBtn').onclick = async () => {
  const uid = $('#profileUid').textContent;
  try {
    await navigator.clipboard.writeText(uid);
    $('#copyCodeBtn').textContent = 'Copied!';
    setTimeout(() => ($('#copyCodeBtn').textContent = 'Copy'), 1200);
  } catch {
    /* clipboard not available, user can select the text manually */
  }
};

$('#sendRequestBtn').onclick = async () => {
  const code = $('#friendCodeInput').value.trim();
  if (!code || !window.ChessDB) return;
  await window.ChessDB.sendFriendRequest(code);
  $('#friendCodeInput').value = '';
  $('#sendRequestBtn').textContent = 'Sent!';
  setTimeout(() => ($('#sendRequestBtn').textContent = 'Send'), 1200);
};

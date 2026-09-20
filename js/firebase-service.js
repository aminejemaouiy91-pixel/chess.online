/* firebase-service.js
   هذا الملف من نوع module (لازم <script type="module"> في index.html).
   بما إن باقي ملفاتك (game.js, ui.js, main.js) مو modules، بنعرض الدوال
   على window.ChessDB عشان تقدر تستدعيها منهم بشكل عادي. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  increment,
  serverTimestamp,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let authReadyResolve;
const authReady = new Promise((res) => (authReadyResolve = res));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await ensureUserDoc(user.uid);
  }
  authReadyResolve(user);
});

signInAnonymously(auth).catch((err) => console.error("Auth error:", err));

/* ---------- إنشاء بروفايل مستخدم أول مرة ---------- */
async function ensureUserDoc(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: "لاعب" + uid.slice(0, 5),
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      friends: [],
      createdAt: serverTimestamp(),
    });
  }
}

async function getUserProfile(uid = currentUser?.uid) {
  if (!uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

/* ---------- حفظ نتيجة مباراة (بوت / محلي / أونلاين) ---------- */
/**
 * result: "white" | "black" | "draw"
 * reason: "checkmate" | "resignation" | "timeout" | "stalemate" | "draw"
 * opts: { mode, moves, opponentUid } — opponentUid فقط لو أونلاين ضد لاعب حقيقي
 */
async function recordGameResult(result, reason, opts = {}) {
  await authReady;
  if (!currentUser) return null;

  const gameDoc = {
    whiteUid: opts.mode === "online" && opts.youAreWhite ? currentUser.uid : opts.mode === "online" ? opts.opponentUid : currentUser.uid,
    blackUid: opts.mode === "online" && !opts.youAreWhite ? currentUser.uid : opts.mode === "online" ? opts.opponentUid : null,
    mode: opts.mode || "bot",
    result,
    reason,
    moves: opts.moves || [],
    playedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, "games"), gameDoc);

  // تحديث إحصائيات المستخدم الحالي دائمًا
  const outcome = result === "draw" ? "draws" : result === (opts.youAreWhite ? "white" : "black") ? "wins" : "losses";
  await updateDoc(doc(db, "users", currentUser.uid), {
    gamesPlayed: increment(1),
    [outcome]: increment(1),
  });

  return ref.id;
}

/* ---------- سجل المباريات ---------- */
async function getRecentGames(uid = currentUser?.uid, max = 20) {
  if (!uid) return [];
  const q = query(
    collection(db, "games"),
    where("whiteUid", "==", uid),
    orderBy("playedAt", "desc"),
    limit(max)
  );
  const q2 = query(
    collection(db, "games"),
    where("blackUid", "==", uid),
    orderBy("playedAt", "desc"),
    limit(max)
  );
  const [s1, s2] = await Promise.all([getDocs(q), getDocs(q2)]);
  const games = [...s1.docs, ...s2.docs].map((d) => ({ id: d.id, ...d.data() }));
  games.sort((a, b) => (b.playedAt?.seconds || 0) - (a.playedAt?.seconds || 0));
  return games.slice(0, max);
}

async function updateDisplayName(newName) {
  await authReady;
  if (!currentUser || !newName?.trim()) return;
  await updateDoc(doc(db, "users", currentUser.uid), { displayName: newName.trim().slice(0, 24) });
}

async function getIncomingRequests() {
  await authReady;
  if (!currentUser) return [];
  const snap = await getDocs(
    query(collection(db, "users", currentUser.uid, "friendRequests"), where("status", "==", "pending"))
  );
  const requests = [];
  for (const d of snap.docs) {
    const fromProfile = await getUserProfile(d.id);
    requests.push({ fromUid: d.id, displayName: fromProfile?.displayName || d.id.slice(0, 8) });
  }
  return requests;
}

/* ---------- أصدقاء ---------- */
async function sendFriendRequest(toUid) {
  await authReady;
  if (!currentUser || toUid === currentUser.uid) return;
  await setDoc(doc(db, "users", toUid, "friendRequests", currentUser.uid), {
    status: "pending",
    createdAt: serverTimestamp(),
  });
}

async function acceptFriendRequest(fromUid) {
  await authReady;
  if (!currentUser) return;
  await updateDoc(doc(db, "users", currentUser.uid, "friendRequests", fromUid), {
    status: "accepted",
  });
  await Promise.all([
    updateDoc(doc(db, "users", currentUser.uid), { friends: arrayUnion(fromUid) }),
    updateDoc(doc(db, "users", fromUid), { friends: arrayUnion(currentUser.uid) }),
  ]);
}

async function getFriends() {
  const profile = await getUserProfile();
  if (!profile?.friends?.length) return [];
  const snaps = await Promise.all(profile.friends.map((uid) => getDoc(doc(db, "users", uid))));
  return snaps.filter((s) => s.exists()).map((s) => ({ uid: s.id, ...s.data() }));
}

/* ---------- لعب أونلاين: تحديات ومباريات مباشرة ---------- */

/* إرسال تحدي للعب أونلاين لصديق عبر الـ UID */
async function sendGameChallenge(toUid) {
  await authReady;
  if (!currentUser || !toUid || toUid === currentUser.uid) return null;
  const myProfile = await getUserProfile();
  await setDoc(doc(db, "users", toUid, "gameChallenges", currentUser.uid), {
    status: "pending",
    fromName: myProfile?.displayName || "لاعب",
    createdAt: serverTimestamp(),
  });
  return true;
}

async function cancelGameChallenge(toUid) {
  await authReady;
  if (!currentUser) return;
  await deleteDoc(doc(db, "users", toUid, "gameChallenges", currentUser.uid)).catch(() => {});
}

async function declineGameChallenge(fromUid) {
  await authReady;
  if (!currentUser) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "gameChallenges", fromUid)).catch(() => {});
}

/* الاستماع اللحظي للتحديات الواردة */
function listenToChallenges(callback) {
  let unsub = () => {};
  authReady.then((user) => {
    if (!user) return;
    unsub = onSnapshot(
      query(collection(db, "users", user.uid, "gameChallenges"), where("status", "==", "pending")),
      (snap) => {
        callback(snap.docs.map((d) => ({ fromUid: d.id, ...d.data() })));
      }
    );
  });
  return () => unsub();
}

/* قبول تحدي: ينشئ مباراة مباشرة ويحذف التحدي */
async function acceptGameChallenge(fromUid) {
  await authReady;
  if (!currentUser) return null;
  const [meProfile, oppProfile] = await Promise.all([getUserProfile(), getUserProfile(fromUid)]);
  const whiteFirst = Math.random() < 0.5;
  const matchDoc = {
    whiteUid: whiteFirst ? currentUser.uid : fromUid,
    blackUid: whiteFirst ? fromUid : currentUser.uid,
    whiteName: whiteFirst ? meProfile?.displayName || "لاعب" : oppProfile?.displayName || "لاعب",
    blackName: whiteFirst ? oppProfile?.displayName || "لاعب" : meProfile?.displayName || "لاعب",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
    turn: "w",
    history: [],
    moveCount: 0,
    status: "active",
    over: false,
    winner: null,
    reason: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, "matches"), matchDoc);
  await deleteDoc(doc(db, "users", currentUser.uid, "gameChallenges", fromUid)).catch(() => {});
  return ref.id;
}

/* الاستماع اللحظي لمباراة مباشرة معينة */
function listenToMatch(matchId, callback) {
  const unsub = onSnapshot(doc(db, "matches", matchId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
  return unsub;
}

/* إرسال نقلة (أو أي تحديث لحالة اللوحة) للمباراة المباشرة */
async function pushMatchMove(matchId, fields) {
  await updateDoc(doc(db, "matches", matchId), { ...fields, updatedAt: serverTimestamp() });
}

/* الاستماع اللحظي لأي مباراة نشطة يشارك فيها المستخدم الحالي (تُستخدم لاكتشاف قبول التحدي تلقائيًا) */
function listenToMyActiveMatch(callback) {
  let unsub1 = () => {};
  let unsub2 = () => {};
  authReady.then((user) => {
    if (!user) return;
    const handle = (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added" || change.type === "modified") {
          callback({ id: change.doc.id, ...change.doc.data() });
        }
      });
    };
    unsub1 = onSnapshot(
      query(collection(db, "matches"), where("whiteUid", "==", user.uid), where("status", "==", "active")),
      handle
    );
    unsub2 = onSnapshot(
      query(collection(db, "matches"), where("blackUid", "==", user.uid), where("status", "==", "active")),
      handle
    );
  });
  return () => {
    unsub1();
    unsub2();
  };
}

/* إنهاء المباراة (كش ملك / استسلام / تعادل / وقت) */
async function endMatch(matchId, winner, reason) {
  await updateDoc(doc(db, "matches", matchId), {
    status: "finished",
    over: true,
    winner,
    reason,
    updatedAt: serverTimestamp(),
  });
}

/* آخر مباراة أونلاين غير منتهية للمستخدم الحالي (لاستئنافها لو رجع للصفحة) */
async function getActiveMatchFor(uid = currentUser?.uid) {
  if (!uid) return null;
  const qw = query(collection(db, "matches"), where("whiteUid", "==", uid), where("status", "==", "active"), limit(5));
  const qb = query(collection(db, "matches"), where("blackUid", "==", uid), where("status", "==", "active"), limit(5));
  const [sw, sb] = await Promise.all([getDocs(qw), getDocs(qb)]);
  const docs = [...sw.docs, ...sb.docs];
  return docs.length ? { id: docs[0].id, ...docs[0].data() } : null;
}

/* ---------- تصدير للاستخدام من ملفاتك العادية (غير module) ---------- */
window.ChessDB = {
  authReady,
  getCurrentUser: () => currentUser,
  getUserProfile,
  updateDisplayName,
  recordGameResult,
  getRecentGames,
  sendFriendRequest,
  acceptFriendRequest,
  getIncomingRequests,
  getFriends,
  sendGameChallenge,
  cancelGameChallenge,
  declineGameChallenge,
  listenToChallenges,
  acceptGameChallenge,
  listenToMatch,
  listenToMyActiveMatch,
  pushMatchMove,
  endMatch,
  getActiveMatchFor,
};

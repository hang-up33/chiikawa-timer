const MAX_SECONDS = 24 * 60 * 60;
// 選べる楽曲(いずれもYouTube公式配信の動画を埋め込み再生する)
const TRACKS = [
  {
    id: "LzzW_TBL558",
    title: "パジャマパーティーズのうた",
    appName: "パジャマパーティーズタイマー",
    runningText: "パジャマパーティー中...",
  },
  {
    id: "lI7efayDEeU",
    title: "島のうた (セイレーンver.)",
    appName: "島のうたタイマー",
    runningText: "島でのんびり中...",
  },
];
const TRACK_STORAGE_KEY = "chiikawa-timer:track";
// 終了音: 『映画ちいかわ 人魚の島のひみつ』WEBCMうさぎラップ篇(東宝MOVIEチャンネル公式)の
// うさぎの声の部分だけを、BGMと同じ埋め込みプレーヤーで再生する
const FINISH_CLIP = { id: "sT1A-4zjKqQ", start: 14, end: 17 };
// この時間内に終了音の再生が始まらなければ(バックグラウンド等で再生が
// ブロックされた場合など)、合成音に切り替える
const FINISH_CLIP_START_TIMEOUT_MS = 3000;

const hoursInput = document.getElementById("hoursInput");
const minutesInput = document.getElementById("minutesInput");
const secondsInput = document.getElementById("secondsInput");
const timeDisplay = document.getElementById("timeDisplay");
const statusText = document.getElementById("statusText");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const playMusicBtn = document.getElementById("playMusicBtn");
const trackSelect = document.getElementById("trackSelect");
const playerCaption = document.getElementById("playerCaption");
const appTitle = document.getElementById("appTitle");
const inputs = [hoursInput, minutesInput, secondsInput];

let player = null;
let playerReady = false;
let playerUnavailable = false;
let intervalId = null;
let endTime = 0; // Date.now() + remainingMs のタイムスタンプ
let remainingMs = 0;
let running = false;
let notificationPermissionPromise = null;
// タイマー実行中に「音楽が再生されているべきか」を表す。タブがバックグラウンド
// から復帰した際、ユーザー操作によるpause(pauseTimer/resetTimer/finishTimer/
// プレーヤー自体の一時停止操作)と区別して自動的に再開すべきかどうかの判定に使う。
let shouldBePlaying = false;
// 一度でもStartが押されたか(一時停止中・終了後もtrueのまま維持し、
// Resetで初期状態に戻す)。「まだ一度もStartしていない」場合にのみ
// 自動復旧メッセージでstatusTextを上書きしてよいかどうかの判定に使う。
let hasStarted = false;
let currentTrack = loadSavedTrack();
// プレーヤーに実際に読み込まれている動画ID(onReady前の曲切り替え検出用)
let loadedVideoId = null;

function loadSavedTrack() {
  try {
    const saved = localStorage.getItem(TRACK_STORAGE_KEY);
    const found = TRACKS.find((t) => t.id === saved);
    if (found) return found;
  } catch (err) {
    // ストレージが使えない環境では既定の曲を使う
  }
  return TRACKS[0];
}

function saveTrack(track) {
  try {
    localStorage.setItem(TRACK_STORAGE_KEY, track.id);
  } catch (err) {
    // 保存できなくても曲の切り替え自体は動作する
  }
}

// 曲に合わせてタイトル・キャプションなどの表示を切り替える
function updateTrackTexts() {
  playerCaption.textContent = `再生中:「${currentTrack.title}」(公式配信)`;
  appTitle.textContent = currentTrack.appName;
  document.title = `ちいかわ ${currentTrack.appName}`;
}

function runningStatusText() {
  return playerUnavailable
    ? `${currentTrack.runningText}(楽曲の再生に失敗しました)`
    : currentTrack.runningText;
}

TRACKS.forEach((track) => {
  const option = document.createElement("option");
  option.value = track.id;
  option.textContent = track.title;
  trackSelect.appendChild(option);
});
trackSelect.value = currentTrack.id;
updateTrackTexts();

// 曲を切り替える。タイマー実行中で音楽が流れているべき状態ならすぐ新しい曲を
// 再生し、それ以外(Start前・一時停止中・終了後)は頭出しだけして次の再生に備える。
function switchTrack(trackId) {
  const track = TRACKS.find((t) => t.id === trackId);
  if (!track || track.id === currentTrack.id) return;
  currentTrack = track;
  saveTrack(track);
  updateTrackTexts();

  if (!playerReady) {
    if (running) statusText.textContent = runningStatusText();
    return; // onReadyで現在の曲に合わせる
  }

  // 前の曲が埋め込み不可などでエラーになっていても、別の曲なら再生できる
  // 可能性があるため、利用不可状態を解除して試す(失敗すればonErrorで再設定)
  if (playerUnavailable) {
    playerUnavailable = false;
    if (!running) enableStartControl("最大24時間までセットできます");
  }
  if (running) statusText.textContent = runningStatusText();

  stopFinishClip();
  loadedVideoId = track.id;
  if (running && (shouldBePlaying || !playMusicBtn.hidden)) {
    // selectのchangeはユーザー操作なのでautoplay制限にかからない
    player.loadVideoById(track.id);
    shouldBePlaying = true;
    playMusicBtn.hidden = true;
  } else {
    player.cueVideoById(track.id);
  }
}

function clampInputs() {
  // parseIntは"1e1"のような指数表記を先頭の"1"で打ち切ってしまう
  // (本来は10と解釈すべき)ため、ブラウザ自身の数値解釈である
  // valueAsNumberを使う。
  let h = Math.min(24, Math.max(0, Math.floor(hoursInput.valueAsNumber) || 0));
  let m = Math.min(59, Math.max(0, Math.floor(minutesInput.valueAsNumber) || 0));
  let s = Math.min(59, Math.max(0, Math.floor(secondsInput.valueAsNumber) || 0));

  let total = h * 3600 + m * 60 + s;
  if (total > MAX_SECONDS) {
    total = MAX_SECONDS;
    h = 24;
    m = 0;
    s = 0;
  }

  hoursInput.value = h;
  minutesInput.value = m;
  secondsInput.value = s;
  return total;
}

function formatTime(totalMs) {
  const totalSeconds = Math.max(0, Math.ceil(totalMs / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function updateDisplay(ms) {
  timeDisplay.textContent = formatTime(ms);
}

function setInputsDisabled(disabled) {
  inputs.forEach((input) => (input.disabled = disabled));
}

function tick() {
  const msLeft = endTime - Date.now();
  if (msLeft <= 0) {
    finishTimer();
    return;
  }
  updateDisplay(msLeft);
}

// 終了音はWeb Audio APIで合成する(音源ファイル不要)。ブラウザのautoplay制限で
// ユーザー操作なしにAudioContextを開始できないため、Startクリック時に作成・再開しておく。
let audioCtx = null;

function unlockAudio() {
  try {
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (err) {
    // 効果音は補完的な機能のため、使えない環境では鳴らさない
  }
}

// うさぎの「ヤハッ！」風の声をフォルマント合成で作る(公式音声ではなく雰囲気を寄せた音)。
// のこぎり波(声帯の代わり)を母音ごとの共鳴帯域(フォルマント)のバンドパスに通して
// 「ヤ」(イ→アへの移行)、息の雑音で「ハ」、最後に急に止めて「ッ」を表現する。
const VOWEL_I = [350, 2700, 3400];
const VOWEL_A = [1000, 1500, 3000];
const FORMANT_GAINS = [1, 0.7, 0.35];

function scheduleVoiced(ctx, t, dur, f0From, f0To, vowelFrom, vowelTo, glide) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(f0From, t);
  osc.frequency.linearRampToValueAtTime(f0To, t + dur);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
  env.gain.setValueAtTime(0.5, t + dur - 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur); // 「ッ」で急に止める
  env.connect(ctx.destination);

  vowelFrom.forEach((freq, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.linearRampToValueAtTime(vowelTo[i], t + glide);
    const gain = ctx.createGain();
    gain.gain.value = FORMANT_GAINS[i];
    osc.connect(filter).connect(gain).connect(env);
  });

  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function scheduleBreath(ctx, t, dur) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1600;
  filter.Q.value = 0.8;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  noise.connect(filter).connect(env).connect(ctx.destination);
  noise.start(t);
}

function scheduleYaha(ctx, t) {
  scheduleVoiced(ctx, t, 0.16, 720, 980, VOWEL_I, VOWEL_A, 0.07); // ヤ
  scheduleBreath(ctx, t + 0.15, 0.06); // h
  scheduleVoiced(ctx, t + 0.2, 0.17, 1100, 1350, VOWEL_A, VOWEL_A, 0); // ハッ
}

// 「ヤハッ！ヤハッ！」と2回叫ぶ(公式の終了音が鳴らせないときの代わり)
function playSynthFinishSound() {
  if (!audioCtx) return;
  try {
    const start = audioCtx.currentTime + 0.05;
    scheduleYaha(audioCtx, start);
    scheduleYaha(audioCtx, start + 0.6);
  } catch (err) {
    // 鳴らせなくても画面表示・通知で終了は伝わる
  }
}

// 終了音クリップの再生状態
let playingFinishClip = false;
let finishClipStarted = false;
let finishClipTimer = null;

function stopFinishClip() {
  playingFinishClip = false;
  finishClipStarted = false;
  clearTimeout(finishClipTimer);
}

// 終了音クリップが終わったら、BGMを選択中の曲に戻して次のStartに備える
function endFinishClip() {
  if (!playingFinishClip) return;
  stopFinishClip();
  loadedVideoId = currentTrack.id;
  player.cueVideoById(currentTrack.id);
}

function playFinishSound() {
  if (!playerReady || playerUnavailable) {
    playSynthFinishSound();
    return;
  }

  playingFinishClip = true;
  finishClipStarted = false;
  loadedVideoId = FINISH_CLIP.id;
  player.loadVideoById({
    videoId: FINISH_CLIP.id,
    startSeconds: FINISH_CLIP.start,
    endSeconds: FINISH_CLIP.end,
  });

  finishClipTimer = setTimeout(() => {
    if (!playingFinishClip) return;
    if (!finishClipStarted) {
      endFinishClip();
      playSynthFinishSound();
      return;
    }
    // 再生は始まったが終了イベントが来ない場合の保険
    endFinishClip();
  }, FINISH_CLIP_START_TIMEOUT_MS);
}

function handleFinishClipStateChange(state) {
  if (state === YT.PlayerState.PLAYING) {
    if (!finishClipStarted) {
      finishClipStarted = true;
      // 再生が始まったら、クリップの長さ+余裕を見て必ずBGMに戻す
      clearTimeout(finishClipTimer);
      finishClipTimer = setTimeout(
        endFinishClip,
        (FINISH_CLIP.end - FINISH_CLIP.start + 2) * 1000
      );
    }
    return;
  }
  if (finishClipStarted && (state === YT.PlayerState.ENDED || state === YT.PlayerState.PAUSED)) {
    endFinishClip();
  }
}

function startTimer() {
  hasStarted = true;
  unlockAudio();
  if (!running && remainingMs === 0) {
    const totalSeconds = clampInputs();
    if (totalSeconds <= 0) {
      statusText.textContent = "1秒以上をセットしてください";
      return;
    }
    remainingMs = totalSeconds * 1000;
  }

  endTime = Date.now() + remainingMs;
  running = true;
  setInputsDisabled(true);
  startBtn.disabled = true;
  pauseBtn.disabled = false;
  resetBtn.disabled = false;
  statusText.textContent = runningStatusText();

  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    notificationPermissionPromise = Notification.requestPermission();
  }

  if (playerReady && !playerUnavailable) {
    if (playingFinishClip) {
      // 終了音の再生中に次のStartが押されたら、すぐ選択中の曲に戻して再生する
      stopFinishClip();
      loadedVideoId = currentTrack.id;
      player.loadVideoById(currentTrack.id);
    } else {
      player.playVideo();
    }
    shouldBePlaying = true;
    // 通常の再生手段(このplayVideo呼び出し)で音楽が始まるため、
    // 遅延ready用の「音楽を再生する」ボタンはもう不要
    playMusicBtn.hidden = true;
  }

  intervalId = setInterval(tick, 250);
  tick();
}

function pauseTimer() {
  if (!running) return;
  const msLeft = endTime - Date.now();
  if (msLeft <= 0) {
    clearInterval(intervalId);
    finishTimer();
    return;
  }

  running = false;
  clearInterval(intervalId);
  remainingMs = msLeft;
  startBtn.disabled = false;
  startBtn.textContent = "再開";
  pauseBtn.disabled = true;
  statusText.textContent = "一時停止中";
  // 再開時に上のplayVideo()呼び出しで音楽も再開されるため、
  // 一時停止中はボタン自体を隠して誤操作(running=falseでの再生)を防ぐ
  playMusicBtn.hidden = true;
  shouldBePlaying = false;

  if (playerReady) {
    player.pauseVideo();
  }
}

function resetTimer() {
  running = false;
  hasStarted = false;
  remainingMs = 0;
  clearInterval(intervalId);
  setInputsDisabled(false);
  startBtn.disabled = false;
  startBtn.textContent = "スタート";
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  statusText.textContent = "最大24時間までセットできます";
  updateDisplay(0);
  playMusicBtn.hidden = true;
  shouldBePlaying = false;

  if (playerReady) {
    player.pauseVideo();
    player.seekTo(0, true);
  }
}

async function finishTimer() {
  running = false;
  remainingMs = 0;
  clearInterval(intervalId);
  updateDisplay(0);
  setInputsDisabled(false);
  startBtn.disabled = false;
  startBtn.textContent = "スタート";
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  statusText.textContent = "タイマー終了！";
  playMusicBtn.hidden = true;
  shouldBePlaying = false;

  if (playerReady) {
    player.pauseVideo();
  }

  playFinishSound();
  await notifyTimerFinished();
}

async function notifyTimerFinished() {
  if (typeof Notification === "undefined") return;

  let permission = Notification.permission;
  if (permission === "default" && notificationPermissionPromise) {
    permission = await notificationPermissionPromise;
  }

  if (permission !== "granted") return;

  // Android Chrome等、一部のモバイルブラウザでは `new Notification()` による
  // 直接構築がサポートされずTypeErrorになる(Service Worker経由の
  // showNotification()が必要)。通知は補完的な機能であり、画面表示
  // (タイマー終了！)で完了は伝わるため、失敗時は静かに諦める。
  try {
    new Notification(currentTrack.appName, {
      body: "タイマーが終了しました",
    });
  } catch (err) {
    // 通知に失敗しても画面表示でフィードバックできているため無視する
  }
}

startBtn.addEventListener("click", startTimer);
pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);
inputs.forEach((input) => input.addEventListener("change", clampInputs));
trackSelect.addEventListener("change", () => switchTrack(trackSelect.value));

updateDisplay(0);

function enableStartControl(message) {
  if (running) return;
  startBtn.disabled = false;
  // 一時停止中・終了後(hasStarted=true)は、それぞれの状態を示す
  // メッセージ(一時停止中/タイマー終了！)を上書きしない
  if (!hasStarted) {
    statusText.textContent = message;
  }
}

// 楽曲が利用できない(API読み込み失敗・タイムアウト・埋め込み不可などの
// 動画エラー)場合でも、タイマー自体は音源なしで使えるようにする。
// onReady後(API準備完了後)に発生した動画エラーも拾えるよう、
// playerReadyではなくplayerUnavailableのみをガードに使う。
function handlePlayerUnavailable() {
  if (playerUnavailable) return;
  playerUnavailable = true;

  if (running) {
    statusText.textContent = runningStatusText();
    // 回復ボタンが表示されていた場合、壊れたplayerへの再試行を防ぐため隠す
    playMusicBtn.hidden = true;
    return;
  }
  enableStartControl("最大24時間までセットできます(楽曲の読み込みに失敗しました)");
}

setTimeout(() => {
  if (!playerReady) handlePlayerUnavailable();
}, 6000);

// YouTube IFrame API が読み込まれると呼び出される
function onYouTubeIframeAPIReady() {
  loadedVideoId = currentTrack.id;
  player = new YT.Player("player", {
    videoId: currentTrack.id,
    // ループはplayerVarsのloop/playlistではなくonStateChangeで行う
    // (playlist固定だと曲を切り替えた後に元の曲へ戻ってしまうため)
    playerVars: {
      rel: 0,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        player.setVolume(50); // 初期音量が大きすぎるため、デフォルトを50%に下げる
        playerReady = true;
        // プレーヤー生成後〜onReady前に曲が切り替えられていた場合に合わせる
        if (loadedVideoId !== currentTrack.id) {
          loadedVideoId = currentTrack.id;
          player.cueVideoById(currentTrack.id);
        }
        if (!playerUnavailable) {
          enableStartControl("最大24時間までセットできます");
          return;
        }
        // 6秒のフォールバックで一度「利用不可」扱いにした後、
        // 実際には(単に遅かっただけで)準備が完了したケース。
        playerUnavailable = false;
        if (running) {
          // タイマー実行中なら、ユーザー操作を伴う新しい再生ボタンを
          // 提示し、そこからのクリックでautoplay制限を回避して再生する。
          playMusicBtn.hidden = false;
        } else {
          // まだStart前なら、次のStartで通常通り再生できる状態に戻す
          enableStartControl("最大24時間までセットできます");
        }
      },
      onStateChange: (event) => {
        if (playingFinishClip) {
          handleFinishClipStateChange(event.data);
          return;
        }
        // 曲が終わったら、タイマー実行中は頭から繰り返す
        if (event.data === YT.PlayerState.ENDED && running && shouldBePlaying) {
          player.seekTo(0, true);
          player.playVideo();
        }
      },
      onError: () => {
        // 終了音クリップだけが再生できない場合は、BGMまで利用不可扱いにせず
        // 合成音で代わりに鳴らす
        if (playingFinishClip) {
          endFinishClip();
          playSynthFinishSound();
          return;
        }
        handlePlayerUnavailable();
      },
    },
  });
}

// 非表示になる直前の再生状態を覚えておく。復帰時に「非表示の間にブラウザ/OSが
// 強制停止した」場合(直前はPLAYING/BUFFERINGだった)とプレーヤー自身の操作で
// 元々一時停止されていた場合を区別し、後者では自動再開しないようにするため。
let wasPlayingBeforeHidden = false;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    wasPlayingBeforeHidden =
      playerReady && !playerUnavailable && player.getPlayerState() !== YT.PlayerState.PAUSED;
    return;
  }

  if (document.visibilityState !== "visible" || !running) return;

  // タブがバックグラウンドから復帰した際、setIntervalの間引きで表示が
  // 遅れている可能性があるため即座に再計算する。
  tick();

  if (playerReady && !playerUnavailable && shouldBePlaying && wasPlayingBeforeHidden) {
    const state = player.getPlayerState();
    if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
      player.playVideo();
    }
  }
});

playMusicBtn.addEventListener("click", () => {
  if (!running || playerUnavailable) return;
  player.playVideo();
  shouldBePlaying = true;
  playMusicBtn.hidden = true;
  // Start時点では失敗ステータスだった可能性があるため、
  // 回復した今は通常の実行中メッセージに戻す
  statusText.textContent = runningStatusText();
});

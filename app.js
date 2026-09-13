const MAX_SECONDS = 24 * 60 * 60;
const VIDEO_ID = "LzzW_TBL558"; // パジャマパーティーズのうた(公式配信・Pony Canyon提供)

const hoursInput = document.getElementById("hoursInput");
const minutesInput = document.getElementById("minutesInput");
const secondsInput = document.getElementById("secondsInput");
const timeDisplay = document.getElementById("timeDisplay");
const statusText = document.getElementById("statusText");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const inputs = [hoursInput, minutesInput, secondsInput];

let player = null;
let playerReady = false;
let playerUnavailable = false;
let intervalId = null;
let endTime = 0; // Date.now() + remainingMs のタイムスタンプ
let remainingMs = 0;
let running = false;
let notificationPermissionPromise = null;

function clampInputs() {
  let h = Math.min(24, Math.max(0, parseInt(hoursInput.value, 10) || 0));
  let m = Math.min(59, Math.max(0, parseInt(minutesInput.value, 10) || 0));
  let s = Math.min(59, Math.max(0, parseInt(secondsInput.value, 10) || 0));

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

function startTimer() {
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
  statusText.textContent = "パジャマパーティー中...";

  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    notificationPermissionPromise = Notification.requestPermission();
  }

  if (playerReady) {
    player.playVideo();
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

  if (playerReady) {
    player.pauseVideo();
  }
}

function resetTimer() {
  running = false;
  remainingMs = 0;
  clearInterval(intervalId);
  setInputsDisabled(false);
  startBtn.disabled = false;
  startBtn.textContent = "スタート";
  pauseBtn.disabled = true;
  resetBtn.disabled = true;
  statusText.textContent = "最大24時間までセットできます";
  updateDisplay(0);

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

  if (playerReady) {
    player.pauseVideo();
  }

  await notifyTimerFinished();
}

async function notifyTimerFinished() {
  if (typeof Notification === "undefined") return;

  let permission = Notification.permission;
  if (permission === "default" && notificationPermissionPromise) {
    permission = await notificationPermissionPromise;
  }

  if (permission === "granted") {
    new Notification("パジャマパーティーズタイマー", {
      body: "タイマーが終了しました",
    });
  }
}

startBtn.addEventListener("click", startTimer);
pauseBtn.addEventListener("click", pauseTimer);
resetBtn.addEventListener("click", resetTimer);
inputs.forEach((input) => input.addEventListener("change", clampInputs));

updateDisplay(0);

function enableStartControl(message) {
  if (running) return;
  startBtn.disabled = false;
  statusText.textContent = message;
}

// 楽曲の読み込みに失敗しても、タイマー自体は音源なしで使えるようにする
function handlePlayerUnavailable() {
  if (playerReady || playerUnavailable) return;
  playerUnavailable = true;
  enableStartControl("最大24時間までセットできます(楽曲の読み込みに失敗しました)");
}

setTimeout(handlePlayerUnavailable, 6000);

// YouTube IFrame API が読み込まれると呼び出される
function onYouTubeIframeAPIReady() {
  player = new YT.Player("player", {
    videoId: VIDEO_ID,
    playerVars: {
      loop: 1,
      playlist: VIDEO_ID,
      rel: 0,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        playerReady = true;
        enableStartControl("最大24時間までセットできます");
      },
      onError: handlePlayerUnavailable,
    },
  });
}

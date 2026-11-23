import {
  BATCH_SIZE,
  completeNewBatch,
  createEmptyState,
  drawRandomReview,
  finishPendingReview,
  finishRandomReview,
  getDailyPhase,
  getReviewEligibleCount,
  isPendingReviewDue,
  localDateKey,
  normalizeState,
  selectDailyBatch,
} from './logic.js';

const STORAGE_KEY = 'daily-five-words-state-v1';
const root = document.querySelector('#app');
const toastElement = document.querySelector('#toast');

let words = [];
let wordMap = new Map();
let state = createEmptyState();
let session = null;
let completion = null;
let installPrompt = null;
let toastTimer = null;
let appReady = false;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getWord(word) {
  return wordMap.get(word) ?? null;
}

function getBatchWords(batch) {
  if (!batch) return [];
  return batch.words.map(getWord).filter(Boolean);
}

function readStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Unable to read stored state.', error);
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Unable to save state.', error);
    showToast('学习状态保存失败，请检查浏览器存储空间');
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add('is-visible');
  toastTimer = setTimeout(() => toastElement.classList.remove('is-visible'), 2400);
}

function formatToday() {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

function installButtonMarkup() {
  return `<button class="install-button" data-action="install" type="button" ${installPrompt ? '' : 'hidden'}>安装到手机</button>`;
}

function headerMarkup() {
  return `
    <header class="app-header">
      <div class="brand" aria-label="每日五词">
        <span class="brand-mark">5</span>
        <span class="brand-copy">
          <strong>每日五词</strong>
          <small>DAILY FIVE</small>
        </span>
      </div>
      ${installButtonMarkup()}
    </header>
  `;
}

function hasNewWordsLeft() {
  const learned = new Set(state.learnedWords);
  return words.some((item) => !learned.has(item.word));
}

function renderLoading() {
  root.innerHTML = `
    <section class="loading-screen">
      <div class="loading-mark">5</div>
      <p>正在准备今天的五个词…</p>
    </section>
  `;
}

function renderError(message) {
  root.innerHTML = `
    <section class="error-screen">
      <div class="error-mark">!</div>
      <h1>词库没有加载成功</h1>
      <p>${escapeHtml(message)}</p>
      <button class="button button-primary" data-action="reload" type="button">重新加载</button>
    </section>
  `;
}

function homeCopy(phase) {
  if (phase === 'review-due') {
    return {
      label: '先复习',
      title: '昨天的词，先见一面。',
      description: '复习最近学过的 5 个词，完成后再开始今天的新词。',
      action: '开始复习',
    };
  }
  if (phase === 'new-in-progress') {
    return {
      label: '进行中',
      title: '今天的五个词还在等你。',
      description: '',
      action: '继续学习',
    };
  }
  if (phase === 'done') {
    return {
      label: '已完成',
      title: '今天的五个词已完成。',
      description: '如果还想多练一会儿，可以从学过的词里随机复习。',
      action: '今日已完成',
    };
  }
  return {
    label: '未开始',
    title: '今天，从五个词开始。',
    description: '系统会从当前常用度区段随机抽取 5 个词，学完前不会重新抽取。',
    action: '开始学习',
  };
}

function renderHome() {
  completion = null;
  const today = localDateKey();
  const phase = getDailyPhase(state, today);
  const copy = homeCopy(phase);
  const reviewCount = getReviewEligibleCount(state, words);
  const canStartNew = hasNewWordsLeft() || phase === 'review-due' || phase === 'new-in-progress';
  const dailyDisabled = phase === 'done' || (!canStartNew && phase === 'ready');
  const randomDisabled = reviewCount === 0;
  const finalTitle = !hasNewWordsLeft() && phase === 'ready' ? '词库已经全部学完。' : copy.title;
  const finalDescription = !hasNewWordsLeft() && phase === 'ready'
    ? '没有新的单词可以抽取了，你仍然可以继续随机复习。'
    : copy.description;
  const panelClass = finalDescription ? '' : 'has-no-description';

  root.innerHTML = `
    <div class="page page-home">
      ${headerMarkup()}
      <main class="home-main">
        <div class="date-line">
          <span>${escapeHtml(formatToday())}</span>
          <span class="date-dot" aria-hidden="true"></span>
          <span>每天 5 个</span>
        </div>

        <section class="daily-panel ${panelClass}">
          <div class="panel-heading">
            <span class="eyebrow">今日学习</span>
            <span class="status-pill status-${phase}">${escapeHtml(copy.label)}</span>
          </div>
          <h1>${escapeHtml(finalTitle)}</h1>
          ${finalDescription ? `<p>${escapeHtml(finalDescription)}</p>` : ''}
          <button
            class="button button-primary button-wide"
            data-action="start-daily"
            type="button"
            ${dailyDisabled ? 'disabled' : ''}
          >
            ${escapeHtml(dailyDisabled ? '今日已完成' : copy.action)}
          </button>
        </section>

        <button
          class="review-entry"
          data-action="random-review"
          type="button"
          ${randomDisabled ? 'disabled' : ''}
        >
          <span class="review-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M21 16v5h-5M14 14l7 7M3 8V3h5M3 3l7 7" />
            </svg>
          </span>
          <span class="review-copy">
            <strong>随机复习</strong>
            <small>${randomDisabled ? '学完第一批词后开放' : '从学过的词中随机抽取 5 个'}</small>
          </span>
          <span class="chevron" aria-hidden="true">›</span>
        </button>

        <p class="rule-note">复习时选择“不认识”的词，会重新回到待学习词库。</p>
      </main>
    </div>
  `;
}

function startDaily() {
  const today = localDateKey();
  const phase = getDailyPhase(state, today);
  if (phase === 'done') {
    showToast('今天的新词已经完成');
    renderHome();
    return;
  }

  if (!state.currentBatch && state.dailyCompletedDate !== today) {
    state = selectDailyBatch(state, words, today);
    saveState();
  }

  if (isPendingReviewDue(state, today)) {
    startPendingReviewSession();
    return;
  }

  if (state.currentBatch) {
    startNewWordSession();
    return;
  }

  if (!hasNewWordsLeft()) {
    showToast('词库里没有新的单词了');
    renderHome();
  }
}

function startPendingReviewSession() {
  const queue = getBatchWords(state.pendingReview);
  if (queue.length === 0) {
    state.pendingReview = null;
    saveState();
    renderHome();
    return;
  }

  session = {
    mode: 'pending',
    queue,
    index: 0,
    revealed: false,
    results: [],
    repeatQueue: [],
    repeatAdded: new Set(),
    inRepeat: false,
  };
  renderSession();
}

function startNewWordSession() {
  const queue = getBatchWords(state.currentBatch);
  if (queue.length === 0) {
    state.currentBatch = null;
    saveState();
    renderHome();
    return;
  }

  session = {
    mode: 'new',
    queue,
    index: 0,
    revealed: false,
    results: [],
    repeatQueue: [],
    repeatAdded: new Set(),
    inRepeat: false,
  };
  renderSession();
}

function startRandomReview() {
  const drawn = drawRandomReview(state, words, BATCH_SIZE);
  if (drawn.words.length === 0) {
    showToast('还没有可以随机复习的词');
    return;
  }

  session = {
    mode: 'random',
    queue: drawn.words.map(getWord).filter(Boolean),
    index: 0,
    revealed: false,
    results: [],
    repeatQueue: [],
    repeatAdded: new Set(),
    inRepeat: false,
    pendingState: drawn.state,
  };
  renderSession();
}

function sessionMeta(mode) {
  if (mode === 'pending') {
    return {
      label: '上一次复习',
      kicker: '先复习，再学习',
      hint: '不认识的词会重新回到待学习词库',
    };
  }
  if (mode === 'random') {
    return {
      label: '随机复习',
      kicker: '从学过的词里随机抽取',
      hint: '不认识的词会重新回到待学习词库',
    };
  }
  return {
    label: '今日新词',
    kicker: '轻触卡片，再回忆一次',
    hint: '不认识的词会在本组末尾再出现一次',
  };
}

function renderSession() {
  if (!session) {
    renderHome();
    return;
  }

  const current = session.queue[session.index];
  if (!current) {
    finishSession();
    return;
  }

  const meta = sessionMeta(session.mode);
  const progressNumber = session.index + 1;
  const progressTotal = session.queue.length;
  const progressPercent = Math.max(4, Math.round((progressNumber / progressTotal) * 100));
  const pos = current.partOfSpeech ? escapeHtml(current.partOfSpeech) : 'word';
  const wordAction = session.revealed ? '' : 'data-action="reveal"';
  const repeatBadge = session.inRepeat ? '<span class="retry-badge">再记一次</span>' : '';

  root.innerHTML = `
    <div class="page page-study">
      <header class="study-header">
        <button class="icon-button" data-action="exit-session" type="button" aria-label="退出本次学习">←</button>
        <div class="study-progress-wrap">
          <div class="study-progress-copy">
            <span>${escapeHtml(meta.label)}</span>
            <strong>${progressNumber} / ${progressTotal}</strong>
          </div>
          <div class="progress-track" aria-hidden="true">
            <span style="width: ${progressPercent}%"></span>
          </div>
        </div>
        ${installButtonMarkup()}
      </header>

      <main class="study-main">
        <div class="session-kicker">
          <span>${escapeHtml(meta.kicker)}</span>
          ${repeatBadge}
        </div>

        <article
          class="word-card ${session.revealed ? 'is-revealed' : ''}"
          ${wordAction}
          role="${session.revealed ? 'group' : 'button'}"
          tabindex="${session.revealed ? '-1' : '0'}"
          aria-label="${session.revealed ? '单词释义' : '点击显示中文释义'}"
        >
          <span class="pos-pill">${pos}</span>
          <h1 lang="en">${escapeHtml(current.word)}</h1>
          <div class="reveal-line" aria-hidden="true"></div>
          ${session.revealed
            ? `<p class="meaning">${escapeHtml(current.meaning)}</p>`
            : `<span class="reveal-hint"><span class="eye-icon">◉</span> 轻触查看中文释义</span>`}
        </article>

        <div class="study-actions">
          ${session.revealed
            ? `
              <button class="button button-unknown" data-action="answer-unknown" type="button">不认识</button>
              <button class="button button-known" data-action="answer-known" type="button">认识</button>
            `
            : `<button class="button button-primary button-wide" data-action="reveal" type="button">显示释义</button>`}
        </div>
        <p class="study-hint">${escapeHtml(meta.hint)}</p>
      </main>
    </div>
  `;
}

function revealAnswer() {
  if (!session || session.revealed) return;
  session.revealed = true;
  renderSession();
}

function answerWord(known) {
  if (!session || !session.revealed) return;
  const current = session.queue[session.index];
  if (!current) return;

  session.results.push({ word: current.word, known });

  if (
    session.mode === 'new'
    && !known
    && !session.inRepeat
    && !session.repeatAdded.has(current.word)
  ) {
    session.repeatQueue.push(current.word);
    session.repeatAdded.add(current.word);
  }

  session.index += 1;
  session.revealed = false;

  if (session.index < session.queue.length) {
    renderSession();
    return;
  }

  if (session.mode === 'new' && !session.inRepeat && session.repeatQueue.length > 0) {
    session.queue = session.repeatQueue.map(getWord).filter(Boolean);
    session.repeatQueue = [];
    session.index = 0;
    session.inRepeat = true;
    renderSession();
    return;
  }

  finishSession();
}

function finishSession() {
  if (!session) return;

  const unknownCount = new Set(
    session.results.filter((result) => !result.known).map((result) => result.word),
  ).size;
  const finishedMode = session.mode;

  if (finishedMode === 'pending') {
    state = finishPendingReview(state, session.results);
  } else if (finishedMode === 'random') {
    state = finishRandomReview(session.pendingState ?? state, session.results);
  } else {
    state = completeNewBatch(state, localDateKey());
  }

  saveState();
  session = null;
  completion = { mode: finishedMode, unknownCount };
  renderCompletion();
}

function completionCopy(mode, unknownCount) {
  if (mode === 'pending') {
    return {
      eyebrow: '复习完成',
      title: unknownCount > 0 ? '已经重新安排好。' : '这一组都记住了。',
      description: unknownCount > 0
        ? `${unknownCount} 个不认识的词已经回到待学习词库。`
        : '刚才复习的 5 个词都保留在已学习词库中。',
    };
  }
  if (mode === 'random') {
    return {
      eyebrow: '随机复习完成',
      title: unknownCount > 0 ? '薄弱词已经回炉。' : '这次全部认识。',
      description: unknownCount > 0
        ? `${unknownCount} 个词已经回到待学习词库，之后会重新抽到。`
        : '这 5 个词仍然保留在已学习词库中。',
    };
  }
  return {
    eyebrow: '今日完成',
    title: '五个词，已经收好。',
    description: '这一组已经加入已学习词库，下一次打开时会先复习它们。',
  };
}

function renderCompletion() {
  if (!completion) {
    renderHome();
    return;
  }

  const copy = completionCopy(completion.mode, completion.unknownCount);
  const reviewCount = getReviewEligibleCount(state, words);
  let primaryAction = 'home';
  let primaryLabel = '回到首页';
  let secondaryMarkup = '';

  if (completion.mode === 'pending' && state.currentBatch) {
    primaryAction = 'start-new-after-review';
    primaryLabel = '开始今日新词';
    secondaryMarkup = '<button class="button button-quiet" data-action="home" type="button">稍后再说</button>';
  } else if (completion.mode === 'new' && reviewCount > 0) {
    primaryAction = 'random-review';
    primaryLabel = '随机复习';
    secondaryMarkup = '<button class="button button-quiet" data-action="home" type="button">回到首页</button>';
  } else if (completion.mode === 'random' && reviewCount > 0) {
    primaryAction = 'random-review';
    primaryLabel = '再来一组';
    secondaryMarkup = '<button class="button button-quiet" data-action="home" type="button">回到首页</button>';
  }

  root.innerHTML = `
    <div class="page page-complete">
      ${headerMarkup()}
      <main class="complete-main">
        <div class="complete-mark" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="img">
            <path d="M14 33.5 26 45l24-27" />
          </svg>
        </div>
        <span class="eyebrow">${escapeHtml(copy.eyebrow)}</span>
        <h1>${escapeHtml(copy.title)}</h1>
        <p>${escapeHtml(copy.description)}</p>
        <div class="complete-actions">
          <button class="button button-primary button-wide" data-action="${primaryAction}" type="button">${escapeHtml(primaryLabel)}</button>
          ${secondaryMarkup}
        </div>
      </main>
    </div>
  `;
}

async function promptInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  if (choice.outcome === 'accepted') showToast('已添加到手机应用');
  installPrompt = null;
  refreshInstallButtons();
}

function refreshInstallButtons() {
  root.querySelectorAll('[data-action="install"]').forEach((button) => {
    button.hidden = !installPrompt;
  });
}

function handleAction(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger || trigger.disabled) return;
  const action = trigger.dataset.action;

  if (action === 'reload') {
    window.location.reload();
    return;
  }
  if (action === 'install') {
    promptInstall();
    return;
  }
  if (action === 'start-daily') {
    startDaily();
    return;
  }
  if (action === 'random-review') {
    startRandomReview();
    return;
  }
  if (action === 'exit-session') {
    session = null;
    renderHome();
    return;
  }
  if (action === 'reveal') {
    revealAnswer();
    return;
  }
  if (action === 'answer-known') {
    answerWord(true);
    return;
  }
  if (action === 'answer-unknown') {
    answerWord(false);
    return;
  }
  if (action === 'start-new-after-review') {
    completion = null;
    startNewWordSession();
    return;
  }
  if (action === 'home') {
    session = null;
    completion = null;
    renderHome();
  }
}

function handleKeyboard(event) {
  if (!session || session.revealed) return;
  const target = event.target.closest('.word-card');
  if (!target) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    revealAnswer();
  }
}

async function loadWords() {
  const response = await fetch('./data/words.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`词库请求失败（${response.status}）`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('词库格式不正确');
  return data.filter((item) =>
    item
    && typeof item.word === 'string'
    && item.word.length > 0
    && typeof item.meaning === 'string'
    && item.meaning.length > 0
  );
}

async function init() {
  root.addEventListener('click', handleAction);
  root.addEventListener('keydown', handleKeyboard);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    refreshInstallButtons();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    refreshInstallButtons();
    showToast('每日五词已安装到手机');
  });

  document.addEventListener('visibilitychange', () => {
    if (appReady && document.visibilityState === 'visible' && !session && !completion) renderHome();
  });

  renderLoading();
  try {
    words = await loadWords();
    wordMap = new Map(words.map((item) => [item.word, item]));
    state = normalizeState(readStoredState(), words);
    saveState();
    appReady = true;
    renderHome();
  } catch (error) {
    console.error(error);
    renderError(error instanceof Error ? error.message : '未知错误');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service worker registration failed.', error);
    });
  }
}

init();






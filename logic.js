export const STORAGE_VERSION = 1;
export const BATCH_SIZE = 5;
export const BAND_SIZE = 300;
export const MAX_PRIORITY_PER_BATCH = 2;

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createEmptyState() {
  return {
    version: STORAGE_VERSION,
    learnedWords: [],
    currentBatch: null,
    pendingReview: null,
    dailyCompletedDate: null,
    priorityRelearn: [],
    reviewCycleRemaining: [],
  };
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function randomSample(items, count, random = Math.random) {
  return shuffle(items, random).slice(0, Math.max(0, Math.min(count, items.length)));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function normalizeDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeBatch(batch, validWords) {
  if (!batch || typeof batch !== 'object') return null;
  const date = normalizeDate(batch.date);
  const words = uniqueStrings(Array.isArray(batch.words) ? batch.words : []).filter((word) => validWords.has(word));
  if (!date || words.length === 0) return null;
  return { date, words: words.slice(0, BATCH_SIZE) };
}

export function normalizeState(rawState, allWords) {
  const state = createEmptyState();
  if (!rawState || typeof rawState !== 'object') return state;

  const validWordSet = new Set(allWords.map((item) => item.word));
  const wordOrder = new Map(allWords.map((item, index) => [item.word, index]));

  state.learnedWords = uniqueStrings(Array.isArray(rawState.learnedWords) ? rawState.learnedWords : [])
    .filter((word) => validWordSet.has(word))
    .sort((left, right) => wordOrder.get(left) - wordOrder.get(right));

  state.currentBatch = normalizeBatch(rawState.currentBatch, validWordSet);
  state.pendingReview = normalizeBatch(rawState.pendingReview, validWordSet);
  state.dailyCompletedDate = normalizeDate(rawState.dailyCompletedDate);
  state.priorityRelearn = uniqueStrings(Array.isArray(rawState.priorityRelearn) ? rawState.priorityRelearn : [])
    .filter((word) => validWordSet.has(word));
  state.reviewCycleRemaining = uniqueStrings(
    Array.isArray(rawState.reviewCycleRemaining) ? rawState.reviewCycleRemaining : [],
  ).filter((word) => validWordSet.has(word));

  const currentWords = new Set(state.currentBatch?.words ?? []);
  const pendingWords = new Set(state.pendingReview?.words ?? []);

  // A current batch is still unlearned. Pending-review words are already learned.
  state.learnedWords = uniqueStrings([
    ...state.learnedWords.filter((word) => !currentWords.has(word)),
    ...(state.pendingReview?.words ?? []),
  ]).sort((left, right) => wordOrder.get(left) - wordOrder.get(right));

  const learnedSet = new Set(state.learnedWords);
  state.priorityRelearn = uniqueStrings(state.priorityRelearn)
    .filter((word) => !learnedSet.has(word) && !currentWords.has(word) && !pendingWords.has(word))
    .sort((left, right) => wordOrder.get(left) - wordOrder.get(right));

  state.reviewCycleRemaining = uniqueStrings(state.reviewCycleRemaining)
    .filter((word) => learnedSet.has(word) && !currentWords.has(word) && !pendingWords.has(word));

  return state;
}

export function isPendingReviewDue(state, today = localDateKey()) {
  return Boolean(state.pendingReview && state.pendingReview.date < today);
}

export function getDailyPhase(state, today = localDateKey()) {
  if (isPendingReviewDue(state, today)) return 'review-due';
  if (state.currentBatch) return 'new-in-progress';
  if (state.dailyCompletedDate === today) return 'done';
  return 'ready';
}

export function getReviewEligibleCount(state, allWords) {
  const valid = new Set(allWords.map((item) => item.word));
  const learned = new Set(state.learnedWords.filter((word) => valid.has(word)));
  const excluded = new Set([...(state.currentBatch?.words ?? []), ...(state.pendingReview?.words ?? [])]);
  return [...learned].filter((word) => !excluded.has(word)).length;
}

export function selectDailyBatch(state, allWords, today = localDateKey(), random = Math.random) {
  if (state.currentBatch || state.dailyCompletedDate === today) return state;

  const learnedSet = new Set(state.learnedWords);
  const available = allWords.map((item) => item.word).filter((word) => !learnedSet.has(word));
  if (available.length === 0) return { ...state, currentBatch: null };

  const availableSet = new Set(available);
  const priority = state.priorityRelearn.filter((word) => availableSet.has(word));
  const prioritySet = new Set(priority);
  const normal = available.filter((word) => !prioritySet.has(word));

  const priorityCount = Math.min(priority.length, MAX_PRIORITY_PER_BATCH, BATCH_SIZE);
  const selectedPriority = randomSample(priority, priorityCount, random);
  const selectedSet = new Set(selectedPriority);

  const band = normal.slice(0, BAND_SIZE).filter((word) => !selectedSet.has(word));
  const selectedFromBand = randomSample(band, Math.min(BATCH_SIZE - selectedPriority.length, band.length), random);
  selectedFromBand.forEach((word) => selectedSet.add(word));

  if (selectedSet.size < BATCH_SIZE) {
    const fallback = shuffle(
      available.filter((word) => !selectedSet.has(word)),
      random,
    ).slice(0, BATCH_SIZE - selectedSet.size);
    fallback.forEach((word) => selectedSet.add(word));
  }

  const words = shuffle([...selectedSet], random);
  return {
    ...state,
    currentBatch: words.length > 0 ? { date: today, words } : null,
    priorityRelearn: state.priorityRelearn.filter((word) => !selectedSet.has(word)),
  };
}

export function completeNewBatch(state, today = localDateKey()) {
  if (!state.currentBatch) return state;

  const learnedSet = new Set(state.learnedWords);
  state.currentBatch.words.forEach((word) => learnedSet.add(word));
  const learnedWords = [...learnedSet];
  const batchWords = new Set(state.currentBatch.words);

  return {
    ...state,
    learnedWords,
    currentBatch: null,
    pendingReview: { date: today, words: [...state.currentBatch.words] },
    dailyCompletedDate: today,
    priorityRelearn: state.priorityRelearn.filter((word) => !batchWords.has(word)),
    reviewCycleRemaining: state.reviewCycleRemaining.filter((word) => learnedSet.has(word)),
  };
}

export function applyReviewResults(state, results, { clearPendingReview = false } = {}) {
  const unknownWords = results
    .filter((result) => !result.known)
    .map((result) => result.word);

  if (unknownWords.length === 0 && !clearPendingReview) return state;

  const unknownSet = new Set(unknownWords);
  const learnedWords = state.learnedWords.filter((word) => !unknownSet.has(word));
  const learnedSet = new Set(learnedWords);
  const priorityRelearn = uniqueStrings([...state.priorityRelearn, ...unknownWords])
    .filter((word) => !learnedSet.has(word));

  return {
    ...state,
    learnedWords,
    pendingReview: clearPendingReview ? null : state.pendingReview,
    priorityRelearn,
    reviewCycleRemaining: state.reviewCycleRemaining.filter(
      (word) => learnedSet.has(word) || !unknownSet.has(word),
    ).filter((word) => learnedSet.has(word)),
  };
}

export function finishPendingReview(state, results) {
  return applyReviewResults(state, results, { clearPendingReview: true });
}

export function finishRandomReview(state, results) {
  return applyReviewResults(state, results);
}

export function drawRandomReview(state, allWords, count = BATCH_SIZE, random = Math.random) {
  const valid = new Set(allWords.map((item) => item.word));
  const excluded = new Set([...(state.currentBatch?.words ?? []), ...(state.pendingReview?.words ?? [])]);
  const eligible = state.learnedWords.filter((word) => valid.has(word) && !excluded.has(word));
  if (eligible.length === 0) return { state, words: [] };

  const eligibleSet = new Set(eligible);
  let pool = uniqueStrings(state.reviewCycleRemaining).filter((word) => eligibleSet.has(word));
  const target = Math.min(count, eligible.length);

  if (pool.length < target) {
    const remainingSet = new Set(pool);
    const fresh = shuffle(eligible.filter((word) => !remainingSet.has(word)), random);
    pool = [...pool, ...fresh];
  }

  const words = pool.slice(0, target);
  return {
    state: { ...state, reviewCycleRemaining: pool.slice(target) },
    words,
  };
}

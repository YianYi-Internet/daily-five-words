import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewResults,
  completeNewBatch,
  createEmptyState,
  drawRandomReview,
  finishPendingReview,
  getDailyPhase,
  isPendingReviewDue,
  normalizeState,
  selectDailyBatch,
} from '../logic.js';

const words = Array.from({ length: 20 }, (_, index) => ({
  word: `word-${String(index + 1).padStart(2, '0')}`,
  partOfSpeech: 'n.',
  meaning: `释义 ${index + 1}`,
}));

const sequenceRandom = () => {
  let value = 0.42;
  return () => {
    value = (value + 0.137) % 1;
    return value;
  };
};

test('selects and locks exactly five unlearned words', () => {
  let state = createEmptyState();
  state = selectDailyBatch(state, words, '2026-11-23', sequenceRandom());
  assert.equal(state.currentBatch.words.length, 5);
  const locked = [...state.currentBatch.words];
  state = selectDailyBatch(state, words, '2026-11-23', () => 0);
  assert.deepEqual(state.currentBatch.words, locked);
});

test('completes a batch into learned and pending review', () => {
  let state = createEmptyState();
  state = selectDailyBatch(state, words, '2026-11-23', () => 0.25);
  const batch = [...state.currentBatch.words];
  state = completeNewBatch(state, '2026-11-23');
  assert.equal(state.currentBatch, null);
  assert.deepEqual(state.pendingReview, { date: '2026-11-23', words: batch });
  assert.deepEqual(state.learnedWords, batch);
  assert.equal(getDailyPhase(state, '2026-11-23'), 'done');
  assert.equal(getDailyPhase(state, '2026-11-24'), 'review-due');
});

test('unknown words in pending review return to the unlearned pool', () => {
  let state = createEmptyState();
  state = selectDailyBatch(state, words, '2026-11-23', () => 0.2);
  const batch = [...state.currentBatch.words];
  state = completeNewBatch(state, '2026-11-23');
  assert.equal(isPendingReviewDue(state, '2026-11-24'), true);

  const results = batch.map((word, index) => ({ word, known: index !== 0 }));
  const failedWord = batch[0];
  state = finishPendingReview(state, results);

  assert.equal(state.pendingReview, null);
  assert.equal(state.learnedWords.includes(failedWord), false);
  assert.equal(state.priorityRelearn.includes(failedWord), true);
  assert.equal(state.learnedWords.length, 4);
});

test('random review removes failed words from learned without changing pending review', () => {
  let state = createEmptyState();
  state.learnedWords = words.slice(0, 8).map((item) => item.word);
  state.pendingReview = { date: '2026-11-22', words: [words[0].word] };
  const drawn = drawRandomReview(state, words, 5, () => 0.33);
  assert.equal(drawn.words.length, 5);
  assert.equal(drawn.words.includes(words[0].word), false);

  const failed = drawn.words[0];
  const results = drawn.words.map((word) => ({ word, known: word !== failed }));
  state = applyReviewResults(drawn.state, results);
  assert.equal(state.learnedWords.includes(failed), false);
  assert.equal(state.priorityRelearn.includes(failed), true);
  assert.deepEqual(state.pendingReview, { date: '2026-11-22', words: [words[0].word] });
});

test('normalization repairs overlapping state lists', () => {
  const state = normalizeState({
    learnedWords: ['word-01', 'word-02', 'missing'],
    currentBatch: { date: '2026-11-23', words: ['word-02', 'word-03'] },
    pendingReview: { date: '2026-11-22', words: ['word-04'] },
    priorityRelearn: ['word-02', 'word-05', 'word-04'],
    reviewCycleRemaining: ['word-01', 'word-02', 'missing'],
  }, words);

  assert.equal(state.learnedWords.includes('word-02'), false);
  assert.equal(state.learnedWords.includes('word-04'), true);
  assert.equal(state.priorityRelearn.includes('word-02'), false);
  assert.equal(state.priorityRelearn.includes('word-05'), true);
  assert.deepEqual(state.reviewCycleRemaining, ['word-01']);
});

test('new words stay within the current commonness band', () => {
  const manyWords = Array.from({ length: 1000 }, (_, index) => ({
    word: `band-${String(index).padStart(4, '0')}`,
    partOfSpeech: 'n.',
    meaning: `释义 ${index}`,
  }));
  const state = selectDailyBatch(createEmptyState(), manyWords, '2026-11-23', () => 0.61);
  for (const word of state.currentBatch.words) {
    const index = Number(word.split('-')[1]);
    assert.ok(index < 300, `${word} should be inside the first 300-word band`);
  }
});

test('up to two failed review words return to a new batch', () => {
  const state = createEmptyState();
  state.priorityRelearn = words.slice(0, 6).map((item) => item.word);
  const next = selectDailyBatch(state, words, '2026-11-23', () => 0.4);
  const returned = next.currentBatch.words.filter((word) => state.priorityRelearn.includes(word));
  assert.ok(returned.length >= 1);
  assert.ok(returned.length <= 2);
});

test('a random review draw never contains duplicate words', () => {
  const state = createEmptyState();
  state.learnedWords = words.slice(0, 12).map((item) => item.word);
  const first = drawRandomReview(state, words, 5, () => 0.23);
  const second = drawRandomReview(first.state, words, 5, () => 0.71);
  assert.equal(new Set(first.words).size, first.words.length);
  assert.equal(new Set(second.words).size, second.words.length);
});

// Quiz-wheel game logic. The wheel is trivia CATEGORIES plus a few special slices:
// EXTRA POINTS (+150, advance) and LOSE POINTS (-75). Points, not cash — so it reads
// as a game show, not gambling.
//   category     -> host asks a quiz question; score_answer awards +100 if correct.
//   EXTRA POINTS -> +150 immediately.
//   LOSE POINTS  -> -75 immediately (floored at 0).
//
// Segments (order matters — the browser wheel must use the SAME array/order):
const SEGMENTS = ["SCIENCE","EXTRA POINTS","HISTORY","SPORTS","LOSE POINTS","GEOGRAPHY","MUSIC","EXTRA POINTS","MOVIES","NATURE","FOOD","TECH"];
const START = Number(process.env.QUIZ_START_SCORE || 0);
const CORRECT_POINTS = Number(process.env.QUIZ_CORRECT_POINTS || 100);
const EXTRA = Number(process.env.QUIZ_EXTRA_POINTS || 150);
const LOSE = Number(process.env.QUIZ_LOSE_POINTS || 75);

function segType(label) {
  if (label === "EXTRA POINTS") return "extra";
  if (label === "LOSE POINTS") return "lose";
  return "category";
}

function pickSegment(categoryOnly) {
  let idx;
  do { idx = Math.floor(Math.random() * SEGMENTS.length); }
  while (categoryOnly && segType(SEGMENTS[idx]) !== "category");
  return idx;
}

// Apply the wheel outcome. For a CATEGORY no points change yet — they're awarded on
// the answer (scoreAnswer). Specials adjust the score immediately. firstSpin lands a
// category (so the player always gets a question first — good onboarding).
function spinWheel(state, { categoryOnly } = {}) {
  const seg = pickSegment(!!categoryOnly);
  const label = SEGMENTS[seg];
  const type = segType(label);
  const prevScore = state.score;
  let delta = 0;
  if (type === "extra") delta = EXTRA;
  else if (type === "lose") delta = -Math.min(LOSE, prevScore);   // never below 0
  state.score = prevScore + delta;
  return { seg, label, type, category: type === "category" ? label : null, delta, prevScore, score: state.score };
}

// Award a category question once the player has answered (+100 if correct, else 0).
function scoreAnswer(state, correct) {
  const prevScore = state.score;
  const delta = correct ? CORRECT_POINTS : 0;
  state.score = prevScore + delta;
  return { correct: !!correct, delta, prevScore, score: state.score };
}

module.exports = { SEGMENTS, spinWheel, scoreAnswer, START, CORRECT_POINTS, EXTRA, LOSE };

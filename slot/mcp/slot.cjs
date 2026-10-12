// Slot-machine game logic for the voice-avatar slot demo. The OUTCOME is decided
// server-side (source of truth) with a demo-friendly hit rate, then a 5x3 reel
// grid is synthesised to match it. The payline is the centre row of the 5 reels.
//
// playSpin(state, {stake}) mutates state.balance and returns the ground-truth
// result; the MCP tool publishes it to the browser over RTM and hands it back to
// the LLM to narrate.

const SYMBOLS = [
  "apple", "apricot", "banana", "cherry", "grapes", "lemon",
  "orange", "pear", "strawberry", "watermelon", "lucky_seven", "big_win",
];
const LOW = new Set([
  "apple", "apricot", "banana", "cherry", "grapes",
  "lemon", "orange", "pear", "strawberry", "watermelon",
]);

// Multiplier on the stake for N-of-a-kind, left-aligned from reel 1. Flattened so
// the player reliably climbs (65% win rate) without the balance exploding, while
// sevens / BIG WIN symbols still pay satisfying jackpots ($200-$500 on a $10 spin).
const PAYTABLE = {
  low:         { 3: 2, 4: 4,  5: 8 },
  lucky_seven: { 3: 3, 4: 8,  5: 20 },
  big_win:     { 3: 5, 4: 15, 5: 50 },
};
function tierOf(sym) {
  return sym === "big_win" ? "big_win" : sym === "lucky_seven" ? "lucky_seven" : "low";
}

const rnd = (n) => Math.floor(Math.random() * n);
const randomSymbol = () => SYMBOLS[rnd(SYMBOLS.length)];
function randomSymbolExcept(excl) {
  let s;
  do { s = randomSymbol(); } while (s === excl);
  return s;
}

// longest run of the reel-1 symbol, left-aligned across the payline
function leftRun(mids) {
  const first = mids[0];
  let k = 1;
  for (let i = 1; i < mids.length; i++) {
    if (mids[i] === first) k++; else break;
  }
  return k;
}
function maxCount(mids) {
  const c = {};
  let m = 0;
  for (const s of mids) { c[s] = (c[s] || 0) + 1; m = Math.max(m, c[s]); }
  return m;
}

// ~50/50 win/lose for real tension and fun, but wins pay well above the stake so
// the player still trends ahead over a session (positive expected value).
const WIN_P = Number(process.env.SLOT_WIN_PROB || 0.50);

function playSpin(state, { stake, forceWin }) {
  let mids = new Array(5);
  let win = false, payout = 0, symbol = null, count = 0;

  if (forceWin || Math.random() < WIN_P) {
    // how many matching reels (mostly 3 for frequent modest wins, 4/5 rarer)
    const r = Math.random();
    count = r < 0.70 ? 3 : r < 0.92 ? 4 : 5;
    // which symbol tier (mostly low fruit, sevens + BIG WINs for the big moments)
    const t = Math.random();
    symbol = t < 0.70 ? [...LOW][rnd(LOW.size)] : t < 0.92 ? "lucky_seven" : "big_win";
    for (let i = 0; i < count; i++) mids[i] = symbol;
    // the reel after the run must NOT extend it, and fill the rest randomly
    for (let i = count; i < 5; i++) mids[i] = randomSymbolExcept(symbol);
    win = true;
    payout = stake * PAYTABLE[tierOf(symbol)][count];
  } else {
    // a clean loss: no 3+ of any symbol on the payline (so it visibly lost)
    do { for (let i = 0; i < 5; i++) mids[i] = randomSymbol(); }
    while (leftRun(mids) >= 3 || maxCount(mids) >= 3);
  }

  const net = payout - stake;
  state.balance += net;

  // Full 5x3 grid; top/bottom rows are decorative, the centre row is the payline.
  const reels = mids.map((m) => [randomSymbol(), m, randomSymbol()]);

  return {
    reels, payline: mids,
    win, symbol, count, stake, payout, net,
    balance: state.balance,
  };
}

module.exports = { playSpin, SYMBOLS };

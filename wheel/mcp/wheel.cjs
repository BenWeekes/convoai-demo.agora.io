// Wheel-of-fortune game logic. Bet-based: the player stakes a bet (default $10, or any
// amount they name up to their balance). The server picks a segment (outcome = source
// of truth); the browser lands the wheel on it and shows the new balance.
//   multiplier Mx -> win bet*M (net +bet*(M-1));  LOSE ALL -> lose the bet;  NEW GAME -> reset.
//
// Segments (order matters — the client wheel must use the SAME array/order):
const SEGMENTS = ["2×", "3×", "4×", "LOSE ALL", "2×", "5×", "2×", "10×", "3×", "NEW GAME", "2×", "4×", "LOSE ALL", "2×", "5×", "2×"];
const START = Number(process.env.WHEEL_START_BALANCE || 100);

function segEffect(label) {
  if (label === "LOSE ALL") return { effect: "lose_all", mult: 0 };
  if (label === "NEW GAME") return { effect: "new_game", mult: null };
  return { effect: "mult", mult: parseInt(label, 10) };   // "2×" -> 2
}

function pickSegment(avoidLoseAll) {
  let idx;
  do { idx = Math.floor(Math.random() * SEGMENTS.length); }
  while (avoidLoseAll && SEGMENTS[idx] === "LOSE ALL");
  return idx;
}

// state: { balance }. bet = the stake. firstSpin -> never land LOSE ALL (good onboarding).
function spinWheel(state, { bet, firstSpin } = {}) {
  const seg = pickSegment(!!firstSpin);
  const label = SEGMENTS[seg];
  const { effect, mult } = segEffect(label);
  const prevBalance = state.balance;
  let balance, payout = 0, net;
  if (effect === "lose_all") { net = -bet; balance = prevBalance - bet; }          // lose the bet
  else if (effect === "new_game") { balance = START; net = START - prevBalance; }   // reset
  else { payout = bet * mult; net = bet * (mult - 1); balance = prevBalance + net; } // win bet*M
  state.balance = balance;
  return { seg, label, effect, mult, bet, payout, net, prevBalance, balance };
}

module.exports = { SEGMENTS, spinWheel, START };

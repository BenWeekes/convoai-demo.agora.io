// Baccarat dealer logic — standalone prototype to sanity-check the game maths
// before wiring into an MCP tool. Deterministic: deals, applies third-card rules,
// settles the bet, updates balance. Emits the 6 card codes in the avatar's slot
// order: param = "P1,P2,B1,B2,P3,B3"  (Player = left, Banker = right).
//
// Run:  node play_round.js            (real third-card rules)
//       node play_round.js always6    (always deal 3 each — fixed 6-card clip)

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['H','D','C','S'];
const val = (code) => { const r = code.slice(0, -1); return r === 'A' ? 1 : ['10','J','Q','K'].includes(r) ? 0 : Number(r); };
const total = (cards) => cards.reduce((s, c) => s + val(c), 0) % 10;

function freshShoe(decks = 8) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const r of RANKS) for (const s of SUITS) shoe.push(r + s);
  for (let i = shoe.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
  return shoe;
}

// Deal a hand. Returns { player:[..], banker:[..], p3, b3, playerTotal, bankerTotal, winner }
function deal(shoe, { always6 = false } = {}) {
  const draw = () => shoe.pop();
  const player = [draw(), draw()];   // slots P1, P2
  const banker = [draw(), draw()];   // slots B1, B2
  let p3 = null, b3 = null;
  let pt = total(player), bt = total(banker);

  if (always6) {
    p3 = draw(); b3 = draw(); player.push(p3); banker.push(b3);
    pt = total(player); bt = total(banker);
  } else if (pt >= 8 || bt >= 8) {
    // natural — no third cards
  } else {
    // Player rule
    if (pt <= 5) { p3 = draw(); player.push(p3); pt = total(player); }
    // Banker rule
    const drawBanker = () => { b3 = draw(); banker.push(b3); bt = total(banker); };
    if (p3 === null) {
      if (bt <= 5) drawBanker();               // player stood
    } else {
      const p = val(p3);
      if (bt <= 2) drawBanker();
      else if (bt === 3 && p !== 8) drawBanker();
      else if (bt === 4 && p >= 2 && p <= 7) drawBanker();
      else if (bt === 5 && p >= 4 && p <= 7) drawBanker();
      else if (bt === 6 && (p === 6 || p === 7)) drawBanker();
      // bt === 7 stands
    }
  }
  const winner = pt > bt ? 'player' : bt > pt ? 'banker' : 'tie';
  return { player, banker, p3, b3, playerTotal: pt, bankerTotal: bt, winner };
}

// param string in avatar slot order P1,P2,B1,B2,P3,B3 (empty for undrawn thirds)
function paramString(hand) {
  return [hand.player[0], hand.player[1], hand.banker[0], hand.banker[1],
          hand.p3 || '', hand.b3 || ''].join(',');
}

// Settle a bet. Payouts: player/banker 1:1, tie 8:1; ties push player/banker bets.
function settle({ side, amount, winner }, { commission = 0, tiePayout = 8 } = {}) {
  if (winner === 'tie') {
    if (side === 'tie') return amount * tiePayout;
    return 0; // push
  }
  if (side === 'tie') return -amount;
  if (side === winner) return side === 'banker' ? Math.round(amount * (1 - commission)) : amount;
  return -amount;
}

// One full round against a session state { balance, shoe }.
// always6 defaults TRUE: the dealer clip always shows six cards, so we deal 3 to
// each hand and count all three (a house variant — not casino third-card rules).
function playRound(state, { side, amount }, opts = {}) {
  opts = { always6: true, ...opts };
  if (amount > state.balance) throw new Error('bet exceeds balance');
  if (!state.shoe || state.shoe.length < 12) state.shoe = freshShoe();
  const hand = deal(state.shoe, opts);
  const net = settle({ side, amount, winner: hand.winner }, opts);
  state.balance += net;
  const userWon = net > 0;
  return {
    cards: paramString(hand),
    player: hand.player, banker: hand.banker,
    playerTotal: hand.playerTotal, bankerTotal: hand.bankerTotal,
    winner: hand.winner, bet: side, amount, userWon, net, balance: state.balance,
  };
}

module.exports = { playRound, deal, paramString, settle, freshShoe, total };

// ── demo ────────────────────────────────────────────────────────────────
if (require.main === module) {
  const always6 = process.argv[2] === 'always6';
  const state = { balance: 100, shoe: freshShoe() };
  const sides = ['player', 'banker', 'tie'];
  console.log(`Baccarat prototype — mode: ${always6 ? 'always-6' : 'real third-card rules'} | start balance $100\n`);
  for (let i = 1; i <= 8 && state.balance > 0; i++) {
    const side = sides[(Math.random() * 3) | 0];
    const amount = Math.min(10, state.balance);
    const r = playRound(state, { side, amount }, { always6 });
    console.log(`Round ${i}: bet $${amount} on ${side.toUpperCase()}`);
    console.log(`  param  = "${r.cards}"   (P1,P2,B1,B2,P3,B3)`);
    console.log(`  Player(left)  ${r.player.join(' ')}  = ${r.playerTotal}`);
    console.log(`  Banker(right) ${r.banker.join(' ')}  = ${r.bankerTotal}`);
    console.log(`  winner: ${r.winner.toUpperCase()}  ->  you ${r.userWon ? 'WON' : (r.net === 0 ? 'PUSH' : 'lost')} (${r.net >= 0 ? '+' : ''}${r.net})  balance $${r.balance}\n`);
  }
}

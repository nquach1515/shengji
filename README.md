# Tractor 升级

Shengji / Tractor for 4 players (2 decks), playable online with friends. No database; a tiny relay server forwards messages.

## How it works

- It's a static site (Vite + React + TypeScript). Any free static host works.
- Multiplayer goes through a small WebSocket relay (`relay/`, a Cloudflare Worker with one Durable Object per
  room code). Everyone, host included, connects to it over `wss://`, which gets through VPNs and work networks
  that block browser-to-browser connections. The relay only forwards messages and stores nothing.
- The **host's browser runs the game**: it shuffles, deals, enforces the rules, and sends each player only
  their own hand. The host should keep their tab open. If the host refreshes, choose **Resume your table**
  and everyone reconnects automatically.
- Empty seats can be filled with bots. If a friend drops out, the host can let a bot take over their seat
  until they rejoin with the same link.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run sim        # headless rules checks + bot-vs-bot games
npm run build      # production build in dist/
```

## Deploy the relay (free Cloudflare account)

```sh
cd relay && npm install
npx wrangler login
npx wrangler deploy   # prints https://shengji-relay.<subdomain>.workers.dev
```

Put that address (as `wss://…`) in `RELAY_URL` in `src/net/relay.ts`.

## Deploy to GitHub Pages (free)

1. Create a GitHub repo and push this folder to its `main` branch.
2. In the repo, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push.
   Your game is then at `https://<username>.github.io/<repo>/`.

Netlify, Vercel or Cloudflare Pages also work. Use build command `npm run build` and publish directory `dist`.

## Rules implemented

- Trump: jokers, then the trump-suit rank card, then off-suit rank cards, then the trump suit.
- Declaring during the deal: one rank card declares; a pair of rank cards beats a single; a pair of
  small jokers and then big jokers declare no-trump. If nobody declares, the kitty is flipped.
- The dealer takes the 8-card kitty and buries 8.
- Singles, pairs and tractors (consecutive pairs, skipping the trump rank). You must follow suit,
  pairs and tractors when you can.
- Throws (multi-combo leads) only stand if no one can beat any part, in suit or (house rule) by trumping: a player
  out of the suit with trumps matching a part's shape blocks it. Otherwise the leader plays the beatable part and
  the cards they take back are revealed to everyone.
- Points: 5s = 5, 10s and Ks = 10. If attackers win the last trick, kitty points × 2^(cards in that lead):
  ×2 single, ×4 pair, ×16 two-pair tractor, capped at ×64.

Rules follow the standard game as described in [ShengJi+ (Berkeley EECS-2023-127)](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2023/Archive/EECS-2023-127.pdf);
the optional bidding phase (炒底) is not included.
- Levels: attackers need 80 to take the deal (+1 level per 40 over 80); defenders gain 3 / 2 / 1 for
  0 / under 40 / under 80. Win by defending as dealers on Ace.

## Bots and fairness testing

`npm run eval <mode>` runs the evaluation harness in `scripts/eval.ts`:

- `random`: statistical tests of the shuffle and deal. Every card's position over 200,000 shuffles, points and
  joker odds per seat versus the exact hypergeometric distribution, and the random first-round dealer. The
  shuffle is Fisher–Yates driven by `crypto.getRandomValues`, with no modulo bias.
- `tourney [games]`: full-game tournaments with seats swapped every other game, scored by level rate (the
  share of levels won, as in the ShengJi+ paper).
- `audit [decisions] [deals]`: at random real positions, plays every sensible option out on many guesses of
  the hidden cards, consistent with what the bot can know, and measures how many points the bot's move loses.
- `dup [deals] [samples] [leads|all]`: duplicate match. Each deal is played twice with teams swapped, so card
  luck cancels and only the decisions differ.

Bots never look at hidden hands: every bot decision gets a redacted copy of the game, and `npm run leaktest`
checks that decisions are identical however the hidden cards are dealt.

How a bot (and the Hint button) picks a move:
1. A small neural network (`src/game/policy.ts`) proposes a move. It was trained by search distillation
   (`scripts/ml/`): 30,000 self-play positions, with every option scored by Monte Carlo search, and a network
   trained to rank options the same way.
2. A time-budgeted determinized Monte Carlo search (`src/game/search.ts`, in a Web Worker) plays every option
   out over many deals of the hidden cards that are consistent with what the bot knows. It overrides the
   network only when an alternative wins by a clear margin.

Duplicate-match results (same deals played twice with the teams swapped, so card luck cancels):

| Matchup | Points per round |
|---|---|
| learned network vs card-counting heuristic (1,000 deals) | +2.9 ± 1.2 |
| network + search vs network alone (240 deals) | +8.8 ± 1.8 |

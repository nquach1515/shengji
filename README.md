# Tractor 升级

Shengji / Tractor for 4 players (2 decks), playable online with friends. No server and no database.

## How it works

- It's a static site (Vite + React + TypeScript). Any free static host works.
- Multiplayer is peer-to-peer over WebRTC via [PeerJS](https://peerjs.com). PeerJS's free public server
  only introduces browsers to each other. Game traffic goes directly between players.
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
- Throws (multi-combo leads) only stand if no one can beat any part; otherwise the leader plays the beatable part
  and the cards they take back are revealed to everyone.
- Points: 5s = 5, 10s and Ks = 10. If attackers win the last trick, kitty points × 2^(cards in that lead):
  ×2 single, ×4 pair, ×16 two-pair tractor, capped at ×64.

Rules follow the standard game as described in [ShengJi+ (Berkeley EECS-2023-127)](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2023/Archive/EECS-2023-127.pdf);
the optional bidding phase (炒底) is not included.
- Levels: attackers need 80 to take the deal (+1 level per 40 over 80); defenders gain 3 / 2 / 1 for
  0 / under 40 / under 80. Win by defending as dealers on Ace.

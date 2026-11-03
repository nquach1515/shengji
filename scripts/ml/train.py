"""
Train a move-scoring network on search-labeled decisions (search distillation / expert iteration).

  python3 scripts/ml/train.py <data-dir> <out-weights.json>

Each decision has several candidate moves with features and a Monte Carlo value q (points from the mover's team's
view). The network scores every candidate; it's trained with a listwise loss so that, per decision, its softmax
over candidates matches the search's preference softmax(q / T). Weights are exported as JSON for the TypeScript bot.
"""
import glob
import json
import math
import random
import sys

import numpy as np
import torch
import torch.nn as nn

FEATURES = [
    "is_lead", "position_in_trick", "partner_winning", "trick_points", "attacking", "attacker_points", "hand_size",
    "lead_size", "lead_is_trump", "lead_has_pair", "my_cards_in_lead_suit", "my_trumps", "unseen_trumps",
    "later_opponent_can_ruff", "players_after_me", "is_dealer", "last_trick", "move_size", "move_trump_fraction",
    "move_avg_rank", "move_max_rank", "move_points", "wins_trick_now", "secure_win", "pairs_broken",
    "boss_card_fraction", "is_ruff", "off_suit_discard_fraction", "move_has_pair", "move_has_tractor",
    "move_is_throw", "my_length_in_move_suit", "opponent_void_in_move_suit", "partner_void_in_move_suit",
    "unseen_higher_in_move_suit", "heuristic_choice", "points_given_to_opponents", "points_fed_to_partner",
    "unseen_points", "dealer_kitty_points", "attacker_points_to_next_threshold", "attacker_points_vs_80",
    "unseen_in_move_suit", "unseen_points_in_move_suit", "unseen_in_lead_suit",
]
TEMP = 4.0  # points; how sharply the target prefers better moves
SEED = 7

random.seed(SEED)
np.random.seed(SEED)
torch.manual_seed(SEED)


def load(data_dir):
    rows = []
    for path in sorted(glob.glob(f"{data_dir}/part*.jsonl")):
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        d = json.loads(line)
                    except json.JSONDecodeError:
                        continue  # a line still being written
                    if len(d["q"]) > 1:
                        rows.append(d)
    return rows


def analyze(rows):
    print(f"\n=== Data: {len(rows):,} decisions, {sum(len(r['q']) for r in rows):,} candidate moves ===")

    def regret(r):
        return max(r["q"]) - r["q"][0]

    def cat(r):
        f0 = r["f"][0]
        F = dict(zip(FEATURES, f0))
        if r["lead"]:
            return "lead"
        can_win = any(dict(zip(FEATURES, f))["wins_trick_now"] for f in r["f"])
        if F["partner_winning"]:
            return "follow: partner winning"
        if any(dict(zip(FEATURES, f))["is_ruff"] for f in r["f"]):
            return "follow: can trump in (ruff)"
        if can_win:
            return "follow: can win in suit"
        return "follow: can't win"

    cats = {}
    for r in rows:
        cats.setdefault(cat(r), []).append(r)
    print(f"{'situation':<30}{'decisions':>10}{'heuristic = best':>18}{'avg pts lost':>14}")
    for name in sorted(cats, key=lambda k: -len(cats[k])):
        rs = cats[name]
        best = sum(1 for r in rs if int(np.argmax(r["q"])) == 0) / len(rs)
        print(f"{name:<30}{len(rs):>10}{best * 100:>17.1f}%{np.mean([regret(r) for r in rs]):>14.2f}")

    # When the search disagrees clearly with the heuristic, how do its preferred moves differ?
    diffs = []
    for r in rows:
        b = int(np.argmax(r["q"]))
        if b != 0 and r["q"][b] - r["q"][0] >= 8:
            diffs.append(np.array(r["f"][b]) - np.array(r["f"][0]))
    if diffs:
        d = np.mean(diffs, axis=0)
        order = np.argsort(-np.abs(d))[:10]
        print(f"\nWhere the search clearly beats the heuristic ({len(diffs):,} decisions, ≥8 pts), its moves differ by:")
        for i in order:
            if FEATURES[i] == "heuristic_choice":
                continue
            print(f"  {FEATURES[i]:<30}{d[i]:+.3f}")


class Scorer(nn.Module):
    def __init__(self, n):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n, 128), nn.ReLU(), nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, 1))

    def forward(self, x):
        return self.net(x).squeeze(-1)


def batchify(rows, mean, std):
    k = max(len(r["q"]) for r in rows)
    n = len(FEATURES)
    X = np.zeros((len(rows), k, n), dtype=np.float32)
    Q = np.zeros((len(rows), k), dtype=np.float32)
    M = np.zeros((len(rows), k), dtype=bool)
    for i, r in enumerate(rows):
        m = len(r["q"])
        X[i, :m] = (np.array(r["f"], dtype=np.float32) - mean) / std
        Q[i, :m] = r["q"]
        M[i, :m] = True
    return torch.tensor(X), torch.tensor(Q), torch.tensor(M)


def evaluate(model, rows, mean, std):
    X, Q, M = batchify(rows, mean, std)
    with torch.no_grad():
        s = model(X).masked_fill(~M, -1e9)
    pick = s.argmax(1)
    qmax = Q.masked_fill(~M, -1e9).max(1).values
    model_q = Q.gather(1, pick[:, None]).squeeze(1)
    model_regret = (qmax - model_q).mean().item()
    heur_regret = (qmax - Q[:, 0]).mean().item()
    agree = (pick == Q.masked_fill(~M, -1e9).argmax(1)).float().mean().item()
    gain = (model_q - Q[:, 0]).mean().item()
    return model_regret, heur_regret, agree, gain


def main():
    data_dir, out = sys.argv[1], sys.argv[2]
    rows = load(data_dir)
    analyze(rows)
    random.shuffle(rows)
    cut = int(len(rows) * 0.85)
    train, val = rows[:cut], rows[cut:]
    allf = np.concatenate([np.array(r["f"], dtype=np.float32) for r in train])
    mean = allf.mean(0)
    std = allf.std(0) + 1e-6

    model = Scorer(len(FEATURES))
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    Xt, Qt, Mt = batchify(train, mean, std)
    best = (math.inf, None)
    print(f"\n=== Training on {len(train):,} decisions, validating on {len(val):,} held-out decisions ===")
    for epoch in range(40):
        perm = torch.randperm(len(train))
        model.train()
        for i in range(0, len(train), 256):
            idx = perm[i : i + 256]
            x, q, m = Xt[idx], Qt[idx], Mt[idx]
            target = torch.softmax((q / TEMP).masked_fill(~m, -1e9), dim=1)
            logp = torch.log_softmax(model(x).masked_fill(~m, -1e9), dim=1)
            loss = -(target * logp.masked_fill(~m, 0)).sum(1).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
        model.eval()
        mr, hr, agree, gain = evaluate(model, val, mean, std)
        if epoch % 5 == 4 or epoch == 0:
            print(f"  epoch {epoch + 1:>2}: held-out pts lost — model {mr:.2f} vs heuristic {hr:.2f}; "
                  f"matches search's best {agree * 100:.1f}%; avg gain over heuristic {gain:+.2f} pts/decision")
        if mr < best[0]:
            best = (mr, {k: v.clone() for k, v in model.state_dict().items()})
    model.load_state_dict(best[1])
    mr, hr, agree, gain = evaluate(model, val, mean, std)
    print(f"\nBest held-out: model loses {mr:.2f} pts/decision vs heuristic {hr:.2f} "
          f"(gain {gain:+.2f}), picks the search's best move {agree * 100:.1f}% of the time")

    layers = [m for m in model.net if isinstance(m, nn.Linear)]
    weights = {
        "features": FEATURES,
        "mean": mean.round(6).tolist(),
        "std": std.round(6).tolist(),
        "layers": [{"W": l.weight.detach().numpy().round(5).tolist(), "b": l.bias.detach().numpy().round(5).tolist()} for l in layers],
    }
    with open(out, "w") as fh:
        json.dump(weights, fh)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

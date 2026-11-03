"""
The same trainer as train.py (network, listwise loss, AdamW, early stopping on held-out regret), in plain numpy for
machines without PyTorch. Optionally warm-starts from an existing model, e.g. the 2-deck one for a 3-deck model;
features the old model didn't have start with zero weight.

  python3 scripts/ml/train_np.py <data-dir> <out-weights.json> [--init old-weights.json] [--epochs 40]
"""
import argparse
import glob
import json
import math
import random

import numpy as np

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
    "lead_has_triple", "move_has_triple", "triples_broken",
]
TEMP = 4.0  # points; how sharply the target prefers better moves
SEED = 7
SIZES = [128, 64, 1]


def load(data_dir):
    rows = []
    for path in sorted(glob.glob(f"{data_dir}/part*.jsonl")):
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue  # a line still being written
                if len(d["q"]) > 1:
                    rows.append(d)
    return rows


def batchify(rows, mean, std):
    k = max(len(r["q"]) for r in rows)
    n = len(FEATURES)
    X = np.zeros((len(rows), k, n), dtype=np.float32)
    Q = np.zeros((len(rows), k), dtype=np.float32)
    M = np.zeros((len(rows), k), dtype=bool)
    for i, r in enumerate(rows):
        m = len(r["q"])
        X[i, :m] = (np.array(r["f"], dtype=np.float32)[:, :n] - mean) / std
        Q[i, :m] = r["q"]
        M[i, :m] = True
    return X, Q, M


def init_params(n, rng):
    params, fan_in = [], n
    for out in SIZES:
        bound = 1 / math.sqrt(fan_in)  # torch.nn.Linear's default
        params.append([rng.uniform(-bound, bound, (out, fan_in)).astype(np.float32), rng.uniform(-bound, bound, out).astype(np.float32)])
        fan_in = out
    return params


def from_weights(path, mean, std):
    """Loads a trained model, re-expressed for this data's input normalization; new features get zero weight."""
    w = json.load(open(path))
    assert w["features"] == FEATURES[: len(w["features"])], "old model's features must be a prefix of these"
    k = len(w["features"])
    params = [[np.array(l["W"], dtype=np.float32), np.array(l["b"], dtype=np.float32)] for l in w["layers"]]
    W1, b1 = params[0]
    m_old, s_old = np.array(w["mean"], dtype=np.float32), np.array(w["std"], dtype=np.float32)
    # W1 (x - m_old) / s_old == W1' (x - mean) / std + b1 - b1'
    scaled = W1 * (std[:k] / s_old)
    b1 = b1 + W1 @ ((mean[:k] - m_old) / s_old)
    W1 = np.zeros((W1.shape[0], len(FEATURES)), dtype=np.float32)
    W1[:, :k] = scaled
    params[0] = [W1, b1.astype(np.float32)]
    return params


def forward(params, X):
    """Scores (B, K) plus the activations backprop needs."""
    h = X.reshape(-1, X.shape[-1])
    acts = [h]
    for i, (W, b) in enumerate(params):
        h = h @ W.T + b
        if i < len(params) - 1:
            h = np.maximum(h, 0)
        acts.append(h)
    return h.reshape(X.shape[0], X.shape[1]), acts


def masked_softmax(z, M):
    z = np.where(M, z, -1e9)
    z = z - z.max(1, keepdims=True)
    e = np.exp(z) * M
    return e / e.sum(1, keepdims=True)


def grads(params, X, Q, M):
    s, acts = forward(params, X)
    target = masked_softmax(Q / TEMP, M)
    p = masked_softmax(s, M)
    logp = np.log(np.where(M, p, 1) + 1e-12)
    loss = -(target * logp * M).sum(1).mean()
    d = ((p - target) * M / X.shape[0]).reshape(-1, 1)  # d loss / d score
    gs = [None] * len(params)
    for i in range(len(params) - 1, -1, -1):
        W, _ = params[i]
        gs[i] = [d.T @ acts[i], d.sum(0)]
        if i > 0:
            d = (d @ W) * (acts[i] > 0)
    return loss, gs


def evaluate(params, X, Q, M):
    s, _ = forward(params, X)
    pick = np.where(M, s, -1e9).argmax(1)
    qm = np.where(M, Q, -1e9)
    qmax = qm.max(1)
    model_q = Q[np.arange(len(Q)), pick]
    return (qmax - model_q).mean(), (qmax - Q[:, 0]).mean(), (pick == qm.argmax(1)).mean(), (model_q - Q[:, 0]).mean()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir")
    ap.add_argument("out")
    ap.add_argument("--init")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--lr", type=float, default=2e-3)
    args = ap.parse_args()
    random.seed(SEED)
    rng = np.random.default_rng(SEED)

    rows = load(args.data_dir)
    random.shuffle(rows)
    cut = int(len(rows) * 0.85)
    train, val = rows[:cut], rows[cut:]
    allf = np.concatenate([np.array(r["f"], dtype=np.float32)[:, : len(FEATURES)] for r in train])
    mean = allf.mean(0)
    std = allf.std(0) + 1e-6
    Xt, Qt, Mt = batchify(train, mean, std)
    Xv, Qv, Mv = batchify(val, mean, std)

    params = from_weights(args.init, mean, std) if args.init else init_params(len(FEATURES), rng)
    mr, hr, agree, gain = evaluate(params, Xv, Qv, Mv)
    print(f"{len(train):,} training / {len(val):,} held-out decisions; start: model loses {mr:.2f} vs heuristic {hr:.2f}")
    # AdamW, as torch.optim.AdamW(lr, weight_decay=1e-4)
    b1, b2, eps, wd = 0.9, 0.999, 1e-8, 1e-4
    m = [[np.zeros_like(p) for p in layer] for layer in params]
    v = [[np.zeros_like(p) for p in layer] for layer in params]
    t = 0
    best = (mr, [[p.copy() for p in layer] for layer in params])
    for epoch in range(args.epochs):
        perm = rng.permutation(len(train))
        for i in range(0, len(train), 256):
            idx = perm[i : i + 256]
            _, gs = grads(params, Xt[idx], Qt[idx], Mt[idx])
            t += 1
            for li, layer in enumerate(params):
                for pi, p in enumerate(layer):
                    g = gs[li][pi]
                    p *= 1 - args.lr * wd
                    m[li][pi] = b1 * m[li][pi] + (1 - b1) * g
                    v[li][pi] = b2 * v[li][pi] + (1 - b2) * g * g
                    p -= args.lr * (m[li][pi] / (1 - b1**t)) / (np.sqrt(v[li][pi] / (1 - b2**t)) + eps)
        mr, hr, agree, gain = evaluate(params, Xv, Qv, Mv)
        if epoch % 5 == 4 or epoch == 0:
            print(f"  epoch {epoch + 1:>2}: held-out pts lost — model {mr:.2f} vs heuristic {hr:.2f}; "
                  f"matches search's best {agree * 100:.1f}%; avg gain over heuristic {gain:+.2f} pts/decision")
        if mr < best[0]:
            best = (mr, [[p.copy() for p in layer] for layer in params])
    params = best[1]
    mr, hr, agree, gain = evaluate(params, Xv, Qv, Mv)
    print(f"Best held-out: model loses {mr:.2f} pts/decision vs heuristic {hr:.2f} "
          f"(gain {gain:+.2f}), picks the search's best move {agree * 100:.1f}% of the time")
    weights = {
        "features": FEATURES,
        "mean": mean.round(6).tolist(),
        "std": std.round(6).tolist(),
        "layers": [{"W": W.round(5).tolist(), "b": b.round(5).tolist()} for W, b in params],
    }
    with open(args.out, "w") as fh:
        json.dump(weights, fh)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()

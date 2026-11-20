"""Independent reference for the Bollinger + RSI reversal rule.

Written separately from the TypeScript engine, with plain loops, so the two
can be compared on recorded OKX candles. Run:
    python3 tests/reference/reference.py tests/fixtures/okx-btc-usdt-swap-5m.json > tests/fixtures/okx-btc-usdt-swap-5m.expected.json
"""
import json
import math
import sys


def load(path):
    f = json.load(open(path))
    rows = [[int(x) / 10 for x in c.split(",")] for c in f["d"].split(";")]
    return f, rows


def reference(rows, bb_len, mult, rsi_len, ob, os_):
    close = [r[3] for r in rows]
    n = len(rows)
    basis, upper, lower = [None] * n, [None] * n, [None] * n
    for i in range(bb_len - 1, n):
        w = close[i - bb_len + 1 : i + 1]
        m = sum(w) / bb_len
        sd = math.sqrt(sum((x - m) ** 2 for x in w) / bb_len)
        basis[i], upper[i], lower[i] = m, m + mult * sd, m - mult * sd
    rsi = [None] * n
    gains = [max(close[i] - close[i - 1], 0) for i in range(1, n)]
    losses = [max(close[i - 1] - close[i], 0) for i in range(1, n)]
    ag = sum(gains[:rsi_len]) / rsi_len
    al = sum(losses[:rsi_len]) / rsi_len
    for i in range(rsi_len, n):
        if i > rsi_len:
            ag = (ag * (rsi_len - 1) + gains[i - 1]) / rsi_len
            al = (al * (rsi_len - 1) + losses[i - 1]) / rsi_len
        rsi[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    signals = []
    for i in range(1, n):
        if None in (upper[i], upper[i - 1], rsi[i - 1]):
            continue
        o, h, l, c = rows[i]
        ph, pl = rows[i - 1][1], rows[i - 1][2]
        inside = lower[i] < c < upper[i]
        if ph >= upper[i - 1] and rsi[i - 1] > ob and inside:
            signals.append({"index": i, "side": "short", "stop": max(h, ph), "target": basis[i]})
        if pl <= lower[i - 1] and rsi[i - 1] < os_ and inside:
            signals.append({"index": i, "side": "long", "stop": min(l, pl), "target": basis[i]})
    return {"basis": basis, "upper": upper, "lower": lower, "rsi": rsi, "signals": signals}


if __name__ == "__main__":
    _, rows = load(sys.argv[1])
    out = {
        "default": reference(rows, 20, 2.0, 14, 70, 30),
        "loose": reference(rows, 20, 2.0, 14, 60, 40),
    }
    for k in out:
        for s in ("basis", "upper", "lower", "rsi"):
            out[k][s] = [None if v is None else round(v, 6) for v in out[k][s]]
    json.dump(out, sys.stdout)

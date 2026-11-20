# Murphy Signal Lab: notes for coding sessions

Study tool for technical-analysis indicators (Murphy, 1999) on OKX's USDT
perpetuals (BTC and ETH; the list is `SYMBOLS` in `src/feed/okx.ts`). Browser-only: TypeScript, Vite, React, Lightweight Charts v5, Vitest.
Interface text is Spanish; code and comments are English.

## Commands

- `npm run dev`: dev server on localhost:5173
- `npm test`: unit tests
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: type-check plus production build

Run `npm run typecheck && npm test` before finishing any change.

## Rules of the codebase

- `src/core` is pure: no DOM, no network, no imports from `src/ui` or `src/feed`.
- A rule is data (`src/core/rule/types.ts`). Never hard-code rule logic in the
  UI or the backtest; one rule definition drives chart, backtest and alerts.
- Rules are chosen from `BUILTIN_STRATEGIES`, each tagged with a kind (reversal,
  pullback, momentum, breakout) and built from one trigger plus confirmations of
  the same kind; a test enforces that. The UI does not let the user add entry
  blocks to a rule freely. Free study lives in the Explorar mode, which has its
  own config (`settings.explore`); while it is open the chart draws that config
  and no signals, and it is computed apart from the rule.
- The UI edits a `StrategyConfig` (blocks, stop, target); `makeStrategyRule` in
  `src/core/rules/strategy.ts` turns it into a rule. To add a block: add its
  config and conditions there, its controls in `src/ui/StrategyPanel.tsx`, its
  chart lines in `App.tsx` (`lines`), and labels under `cond.*` in `es.ts`.
  The default strategy must stay equal to `makeBbRsiRule()` (tested).
- Orders go only to OKX **demo trading**, only when the user clicks and confirms.
  All private requests live in `src/feed/okxTrade.ts`, where the header
  `x-simulated-trading: 1` is a constant. Do not add a way to switch it off, and
  do not send orders automatically on a signal. Keys are stored in the browser,
  so only demo keys are acceptable; never commit or log them.
- Three modes (`MODES` in `App.tsx`): Operar, Explorar, Practicar. New study
  tools go into one of them, not into new tabs. Every panel opens with one
  sentence of conclusion (`.lead`) before its numbers.
- Everything that detects structure (swing levels, Fibonacci, divergences,
  trendlines, double tops) must be causal: a swing point exists only from its
  `confirmedAt` candle. Each has a test that a prefix of the candles gives the
  same answer as the full series; keep that test when changing them.
- Practice mode (`src/core/replay.ts`) must stay equivalent to the backtest when
  it plays the rule's own signals (tested), and must never read past the cursor.
- The parameter map runs only on the tuning part of the history (before the
  out-of-sample split). Do not let any search for parameters see the rest.
- Reading order outcomes (`fetchOrderStatus`, `fetchClosedPositions`) is
  read-only and goes through the same demo-only `request`. It has been tested
  only with simulated answers.
- `tests/real.ts` loads 999 real 15-minute candles with volume; use it for
  anything that needs more history than the 171-candle reference fixture.
- Market and timeframe come from the URL (`?symbol=ETH&tf=15m`) and the
  selectors keep the URL in step. One tab watches one market.
- An indicator may declare a `timeframe` to be computed on a higher timeframe;
  `alignHigher` brings it down without look-ahead (closed higher candles only).
  The mapping of chart timeframe to trend timeframe is `TREND_TIMEFRAME`.
- Only closed candles are evaluated. A forming candle never signals.
- All user-facing text goes through `t()` and lives in `src/i18n/es.ts`.
- Backtest assumptions are deliberate and conservative (next-open entry,
  stop-first when both levels fall in one candle). Do not relax them silently.
- New indicators: pure function + registry entry + hand-computed tests.

## Verification

`tests/fixture.test.ts` checks the engine against an independent Python
reference on recorded OKX candles. If the rule or an indicator changes on
purpose, regenerate the expected file:

    python3 tests/reference/reference.py tests/fixtures/okx-btc-usdt-swap-5m.json > tests/fixtures/okx-btc-usdt-swap-5m.expected.json

## OKX feed

- REST: `/api/v5/market/candles` (recent, includes the forming candle) and
  `/api/v5/market/history-candles` (older, paged with `after`).
- WebSocket: `wss://ws.okx.com/ws/v5/business`, channel `candle<bar>`.
- The last field of each candle row is `"1"` when the candle is closed.

## Open items

See "Pendientes conocidos" in README.md.

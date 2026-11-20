import { describe, expect, it } from 'vitest';
import { historyMarkdown, type OrderRecord } from '../src/ui/history';

const base: OrderRecord = {
  id: 'a', time: Date.UTC(2026, 10, 16, 13, 5), status: 'sent', ordId: '998877', market: 'BTC-USDT', asset: 'BTC', timeframe: '5m', side: 'short', type: 'market',
  entry: 65689.4, stop: 66100, target: 64600, size: 0.03, contracts: 3, marginMode: 'cross', leverage: 3, rewardRisk: 2.15, netLoss: 14.3, marginOnCapital: 0.131, verdict: 'below',
  rule: 'Giro: Bandas de Bollinger + RSI', origin: 'signal', originLabel: 'señal del 16/11/26, 13:00 (UTC)', edited: false,
  explanation: ['Venta en BTC-USDT, 5m.', '1. La vela anterior tocó la banda superior.'], notes: 'Tocó el objetivo.',
};

describe('order history export', () => {
  it('writes each order with its status, levels, risk, rule, explanation and notes, oldest first', () => {
    const later: OrderRecord = { ...base, id: 'b', time: base.time + 3_600_000, status: 'refused', ordId: undefined, error: '51008: Insufficient margin', side: 'long', origin: 'manual', originLabel: 'niveles cargados a mano', explanation: [], notes: '' };
    const md = historyMarkdown([later, base]);
    expect(md.indexOf('## 1. Venta BTC-USDT 5m')).toBeGreaterThan(0);
    expect(md.indexOf('## 2. Compra BTC-USDT 5m')).toBeGreaterThan(md.indexOf('## 1.'));
    expect(md).toContain('orden n.º 998877');
    expect(md).toContain('Rechazada por OKX: 51008: Insufficient margin');
    expect(md).toContain('3 contratos');
    expect(md).toContain('2,15 a 1');
    expect(md).toContain('Regla: Giro: Bandas de Bollinger + RSI');
    expect(md).toContain('1. La vela anterior tocó la banda superior.');
    expect(md).toContain('Tocó el objetivo.');
    expect(md).not.toMatch(/\n{3,}/);
  });
  it('gives just a title when there is nothing to export', () => {
    expect(historyMarkdown([]).trim()).toBe('# Historial de órdenes · Murphy Signal Lab');
  });
});

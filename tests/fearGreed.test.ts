import { describe, expect, it } from 'vitest';
import { parseFearGreed } from '../src/feed/fearGreed';

describe('fear and greed index', () => {
  it('reads the value, the mood and yesterday from the service answer', () => {
    const body = { name: 'Fear and Greed Index', data: [{ value: '10', value_classification: 'Extreme Fear', timestamp: '1794787200' }, { value: '14', value_classification: 'Extreme Fear', timestamp: '1794700800' }] };
    expect(parseFearGreed(body)).toEqual({ value: 10, mood: 'extremeFear', previous: 14, time: 1794787200000 });
  });
  it('falls back to the value when the label is unknown, and rejects answers without a usable value', () => {
    expect(parseFearGreed({ data: [{ value: '60', value_classification: 'Something new', timestamp: '1' }] })).toMatchObject({ value: 60, mood: 'greed', previous: null });
    expect(parseFearGreed({ data: [] })).toBeNull();
    expect(parseFearGreed({ data: [{ value: 'abc' }] })).toBeNull();
    expect(parseFearGreed({ data: [{ value: '140' }] })).toBeNull();
    expect(parseFearGreed(null)).toBeNull();
  });
});

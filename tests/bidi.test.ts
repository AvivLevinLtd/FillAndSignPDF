import { describe, expect, it } from 'vitest';
import { visualLine } from '../src/text/bidi';

describe('visualLine', () => {
  it('leaves Latin text alone', () => {
    expect(visualLine('Hello, world')).toEqual({ text: 'Hello, world', rtl: false });
  });

  it('reverses Hebrew', () => {
    expect(visualLine('שלום')).toEqual({ text: 'םולש', rtl: true });
  });

  it('keeps numbers left-to-right inside Hebrew', () => {
    expect(visualLine('סכום 1,250 ₪')).toEqual({ text: '₪ 1,250 םוכס', rtl: true });
  });

  it('keeps a Hebrew word in place inside Latin text', () => {
    expect(visualLine('Hello שלום world')).toEqual({ text: 'Hello םולש world', rtl: false });
  });

  it('keeps Latin words in order inside Hebrew text', () => {
    expect(visualLine('שם: Aviv Levin')).toEqual({ text: 'Aviv Levin :םש', rtl: true });
  });

  it('mirrors brackets in RTL runs', () => {
    expect(visualLine('(שלום)')).toEqual({ text: '(םולש)', rtl: true });
  });

  it('keeps combining marks after their base letter', () => {
    // שָׁ = ש + qamats + shin dot
    expect(visualLine('שָׁב').text).toBe('בשָׁ');
  });

  it('handles empty lines', () => {
    expect(visualLine('')).toEqual({ text: '', rtl: false });
  });
});

import { normalizeCsvList, parseCsvList } from './csv';

describe('parseCsvList', () => {
  it('splits a well-formed list', () => {
    expect(parseCsvList('Standard_D2as_v5,Standard_D4as_v5')).toEqual([
      'Standard_D2as_v5',
      'Standard_D4as_v5',
    ]);
  });

  // The cloud-api-adaptor reads the value verbatim, so " Standard_D4as_v5" never matches.
  it('trims the spaces a user naturally types after a comma', () => {
    expect(parseCsvList('Standard_D2as_v5, Standard_D4as_v5 , Standard_D8as_v5')).toEqual([
      'Standard_D2as_v5',
      'Standard_D4as_v5',
      'Standard_D8as_v5',
    ]);
  });

  it('drops empty entries from stray or trailing commas', () => {
    expect(parseCsvList('a,,b,')).toEqual(['a', 'b']);
    expect(parseCsvList(',')).toEqual([]);
  });

  it('returns an empty list for absent or blank input', () => {
    expect(parseCsvList(undefined)).toEqual([]);
    expect(parseCsvList('')).toEqual([]);
    expect(parseCsvList('   ')).toEqual([]);
  });

  it('keeps a single entry with no commas', () => {
    expect(parseCsvList('  Standard_D2as_v5  ')).toEqual(['Standard_D2as_v5']);
  });
});

describe('normalizeCsvList', () => {
  it('rewrites a spaced list into the form the cloud-api-adaptor can match', () => {
    expect(normalizeCsvList('Standard_D2as_v5, Standard_D4as_v5')).toBe(
      'Standard_D2as_v5,Standard_D4as_v5',
    );
  });

  it('leaves an already-normalized list untouched', () => {
    expect(normalizeCsvList('sg-1,sg-2')).toBe('sg-1,sg-2');
  });

  it('collapses a blank or comma-only value to empty, so the key is not written', () => {
    expect(normalizeCsvList('  ')).toBe('');
    expect(normalizeCsvList(',,')).toBe('');
    expect(normalizeCsvList(undefined)).toBe('');
  });
});

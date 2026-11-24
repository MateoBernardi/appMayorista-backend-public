import { hasMaxDecimals } from '../../domain/validations/numberValidations';

describe('hasMaxDecimals', () => {
  it('accepts values that are floating-point-imprecise but genuinely have up to 3 decimals', () => {
    expect(hasMaxDecimals(1.005, 3)).toBe(true);
    expect(hasMaxDecimals(2.345, 3)).toBe(true);
    expect(hasMaxDecimals(76.415, 3)).toBe(true);
  });

  it('accepts integers and values with fewer than 3 decimals', () => {
    expect(hasMaxDecimals(50, 3)).toBe(true);
    expect(hasMaxDecimals(0.29, 3)).toBe(true);
  });

  it('rejects values with more than 3 decimals', () => {
    expect(hasMaxDecimals(1.0055, 3)).toBe(false);
    expect(hasMaxDecimals(1.23456, 3)).toBe(false);
  });
});

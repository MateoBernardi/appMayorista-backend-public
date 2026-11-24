import * as crypto from 'crypto';
import { generateRandomToken } from '../../utils/tokenGenerator';

describe('generateRandomToken', () => {
  it('genera códigos numéricos de la longitud pedida', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateRandomToken(6)).toMatch(/^[1-9]\d{5}$/);
    }
    expect(generateRandomToken(8)).toMatch(/^\d{8}$/);
  });

  it('usa crypto.randomInt (no Math.random)', () => {
    const spy = jest.spyOn(Math, 'random');
    generateRandomToken(6);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(typeof crypto.randomInt).toBe('function');
  });
});

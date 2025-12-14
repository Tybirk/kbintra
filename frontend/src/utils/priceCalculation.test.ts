import { describe, it, expect } from 'vitest';
import {
  calculateDefaultTicketPrice,
  PRICE_ADULT_MEAT,
  PRICE_ADULT_VEG,
  PRICE_CHILD,
} from './priceCalculation';

describe('priceCalculation', () => {
  describe('calculateDefaultTicketPrice', () => {
    it('should calculate correct price for meat meal with 1 adult', () => {
      const price = calculateDefaultTicketPrice('meat', 1, 0);
      expect(price).toBe(37);
    });

    it('should calculate correct price for vegetarian meal with 1 adult', () => {
      const price = calculateDefaultTicketPrice('vegetarian', 1, 0);
      expect(price).toBe(26);
    });

    it('should calculate correct price for meat meal with 2 adults and 1 child', () => {
      // 2 adults @ 37 + 1 child @ 18 = 92
      const price = calculateDefaultTicketPrice('meat', 2, 1);
      expect(price).toBe(92);
    });

    it('should calculate correct price for vegetarian meal with 2 adults and 1 child', () => {
      // 2 adults @ 26 + 1 child @ 18 = 70
      const price = calculateDefaultTicketPrice('vegetarian', 2, 1);
      expect(price).toBe(70);
    });

    it('should calculate correct price for meal with only children', () => {
      const price = calculateDefaultTicketPrice('meat', 0, 3);
      expect(price).toBe(54); // 3 * 18
    });

    it('should return 0 for no portions', () => {
      const price = calculateDefaultTicketPrice('meat', 0, 0);
      expect(price).toBe(0);
    });
  });

  describe('price constants', () => {
    it('should have correct adult meat price', () => {
      expect(PRICE_ADULT_MEAT).toBe(37);
    });

    it('should have correct adult vegetarian price', () => {
      expect(PRICE_ADULT_VEG).toBe(26);
    });

    it('should have correct child price', () => {
      expect(PRICE_CHILD).toBe(18);
    });
  });
});

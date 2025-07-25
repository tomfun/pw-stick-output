import { toSnakeCase } from './log.helper.js';

describe('log.helper', () => {
  describe('toSnakeCase', () => {
    it('should convert camelCase to snake_case', () => {
      expect(toSnakeCase('camelCase')).toBe('camel_case');
      expect(toSnakeCase('someVariableName')).toBe('some_variable_name');
    });

    it('should handle already snake_case strings', () => {
      expect(toSnakeCase('snake_case')).toBe('snake_case');
      expect(toSnakeCase('already_snake')).toBe('already_snake');
    });

    it('should handle single words', () => {
      expect(toSnakeCase('word')).toBe('word');
      expect(toSnakeCase('Word')).toBe('word');
    });

    it('should handle empty string', () => {
      expect(toSnakeCase('')).toBe('');
    });
  });
});

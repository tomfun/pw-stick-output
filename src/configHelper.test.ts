import { configHelper } from './configHelper.js';

describe('configHelper', () => {
  it('should create config items with default channels', () => {
    const result = configHelper('source1', 'sink1');

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty('findByid');
    expect(result[0]).toHaveProperty('stickTo');
    expect(result[1]).toHaveProperty('findByid');
    expect(result[1]).toHaveProperty('stickTo');
  });

  it('should create config items with custom channels', () => {
    const channels = ['L', 'R', 'C'];
    const result = configHelper('source2', 'sink2', channels);

    expect(result).toHaveLength(3);
    result.forEach((item) => {
      expect(item).toHaveProperty('findByid');
      expect(item).toHaveProperty('stickTo');
    });
  });

  it('should handle empty channels array', () => {
    const result = configHelper('source3', 'sink3', []);

    expect(result).toHaveLength(0);
  });
});

import { filterBlocksBy } from './findModuleByName.js';

interface BaseBlock {
  [key: string]: any;
}

describe('findModuleByName', () => {
  describe('filterBlocksBy', () => {
    it('should filter blocks by field matching regex', () => {
      const blocks: BaseBlock[] = [
        { id: 1, name: 'audio-sink', type: 'sink' },
        { id: 2, name: 'video-source', type: 'source' },
        { id: 3, name: 'audio-source', type: 'source' },
      ];

      const result = filterBlocksBy(blocks, 'name', /audio/);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('audio-sink');
      expect(result[1].name).toBe('audio-source');
    });

    it('should return empty array when no matches', () => {
      const blocks: BaseBlock[] = [
        { id: 1, name: 'video-sink', type: 'sink' },
        { id: 2, name: 'video-source', type: 'source' },
      ];

      const result = filterBlocksBy(blocks, 'name', /audio/);

      expect(result).toHaveLength(0);
    });

    it('should handle missing field gracefully', () => {
      const blocks: BaseBlock[] = [
        { id: 1, name: 'audio-sink', type: 'sink' },
        { id: 2, type: 'source' }, // missing name property
      ];

      const result = filterBlocksBy(blocks, 'missing', /test/);

      expect(result).toHaveLength(0);
    });
  });
});

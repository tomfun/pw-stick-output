import type { BaseBlock } from './findModuleByName.js';
import {
  extractInfoProperties,
  filterBlocksBy,
  mergeClientProps,
  mergeDiffs,
  resolveEndpoint,
} from './findModuleByName.js';

describe('findModuleByName', () => {
  describe('filterBlocksBy', () => {
    it('should filter blocks by field matching regex', () => {
      const blocks = [
        { id: '1', name: 'audio-sink', type: 'sink' },
        { id: '2', name: 'video-source', type: 'source' },
        { id: '3', name: 'audio-source', type: 'source' },
      ];

      const result = filterBlocksBy(blocks, 'name', /audio/);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('audio-sink');
      expect(result[1].name).toBe('audio-source');
    });

    it('should return empty array when no matches', () => {
      const blocks = [
        { id: '1', name: 'video-sink', type: 'sink' },
        { id: '2', name: 'video-source', type: 'source' },
      ];

      const result = filterBlocksBy(blocks, 'name', /audio/);

      expect(result).toHaveLength(0);
    });

    it('should handle missing field gracefully', () => {
      const blocks = [
        { id: '1', name: 'audio-sink', type: 'sink' },
        { id: '2', type: 'source' }, // missing name property
      ];

      const result = filterBlocksBy(blocks, 'missing', /test/);

      expect(result).toHaveLength(0);
    });
  });

  describe('extractInfoProperties', () => {
    const sample = `\tid: 121
\tpermissions: rwxm-
\ttype: PipeWire:Interface:Node/3
*\tinput ports: 2/129
*\toutput ports: 2/0
*\tstate: "running"
*\tproperties:
*\t\tclient.api = "pipewire-pulse"
*\t\tapplication.name = "parec"
*\t\tapplication.process.id = "120497"
*\t\tapplication.process.binary = "pacat"
*\t\tnode.name = "parec"
*\t\tmedia.class = "Stream/Input/Audio"
*\tparams: (9)
*\t  3 (Spa:Enum:ParamId:EnumFormat) r-
`;

    it('parses property block from pw-cli info output', () => {
      const props = extractInfoProperties(sample);
      expect(props['application.name']).toBe('parec');
      expect(props['application.process.id']).toBe('120497');
      expect(props['application.process.binary']).toBe('pacat');
      expect(props['node.name']).toBe('parec');
      expect(props['media.class']).toBe('Stream/Input/Audio');
    });

    it('stops at next section header', () => {
      const props = extractInfoProperties(sample);
      expect(props['3']).toBeUndefined();
      expect(props['params']).toBeUndefined();
    });

    it('returns empty object when no properties section', () => {
      expect(extractInfoProperties('\tid: 1\n\tpermissions: rwxm-\n')).toEqual({});
    });
  });

  describe('resolveEndpoint', () => {
    function buildWatched(opts: {
      nodeProps: Record<string, string>;
      portSuffix: string;
    }) {
      const node = { id: '100', type: 'Node', ...opts.nodeProps };
      const port = { id: '200', type: 'Port', 'node.id': '100' };
      const simple = {
        id: '200',
        type: opts.portSuffix,
        name: opts.nodeProps['node.name'] || 'app',
        prefix: undefined,
        isPlayback: opts.portSuffix.startsWith('playback'),
        isOutput: false,
        isMonitor: false,
      };
      return {
        '100': { _changedType: null, node },
        '200': { _changedType: null, port, simple },
      } as any;
    }

    it('returns findByid string for EndpointById', () => {
      const watched = buildWatched({ nodeProps: {}, portSuffix: 'input_FL' });
      expect(resolveEndpoint({ findByid: 'foo:bar_FL' }, watched)).toBe('foo:bar_FL');
    });

    it('matches app by binary and resolves port suffix', () => {
      const watched = buildWatched({
        nodeProps: {
          'node.name': 'parec',
          'application.name': 'parec',
          'application.process.binary': 'pacat',
          'application.process.id': '12354',
        },
        portSuffix: 'input_FL',
      });
      expect(
        resolveEndpoint(
          { findByApp: { binName: 'pacat' }, portKind: 'input', channel: 'FL' },
          watched,
        ),
      ).toBe('parec:input_FL');
    });

    it('falls back to node.name when binary not present', () => {
      const watched = buildWatched({
        nodeProps: {
          'node.name': 'parec',
          'application.name': 'parec',
          'application.process.id': '12354',
        },
        portSuffix: 'input_FL',
      });
      expect(
        resolveEndpoint(
          { findByApp: { binName: 'parec' }, portKind: 'input', channel: 'FL' },
          watched,
        ),
      ).toBe('parec:input_FL');
    });

    it('matches by pid', () => {
      const watched = buildWatched({
        nodeProps: {
          'node.name': 'parec',
          'application.process.binary': 'pacat',
          'application.process.id': '12354',
        },
        portSuffix: 'input_FL',
      });
      expect(
        resolveEndpoint(
          { findByApp: { pid: 12354 }, portKind: 'input', channel: 'FL' },
          watched,
        ),
      ).toBe('parec:input_FL');
    });

    it('returns undefined when ambiguous (multiple nodes match)', () => {
      const node1 = { id: '100', type: 'Node', 'node.name': 'parec', 'application.process.binary': 'pacat' };
      const node2 = { id: '101', type: 'Node', 'node.name': 'parec', 'application.process.binary': 'pacat' };
      const watched = {
        '100': { _changedType: null, node: node1 },
        '101': { _changedType: null, node: node2 },
      } as any;
      expect(
        resolveEndpoint(
          { findByApp: { binName: 'pacat' }, portKind: 'input', channel: 'FL' },
          watched,
        ),
      ).toBeUndefined();
    });

    it('picks the node that has the wanted port when one binary owns a player and a recorder', () => {
      const watched = {
        '100': { _changedType: null, node: { id: '100', type: 'Node', 'node.name': 'paplay', 'application.process.binary': 'pacat' } },
        '101': { _changedType: null, node: { id: '101', type: 'Node', 'node.name': 'parec', 'application.process.binary': 'pacat' } },
        '200': {
          _changedType: null,
          port: { id: '200', type: 'Port', 'node.id': '100' },
          simple: { id: '200', type: 'output_FL', name: 'paplay' },
        },
        '201': {
          _changedType: null,
          port: { id: '201', type: 'Port', 'node.id': '101' },
          simple: { id: '201', type: 'input_FL', name: 'parec' },
        },
      } as any;
      expect(
        resolveEndpoint({ findByApp: { binName: 'pacat' }, portKind: 'output', channel: 'FL' }, watched),
      ).toBe('paplay:output_FL');
      expect(
        resolveEndpoint({ findByApp: { binName: 'pacat' }, portKind: 'input', channel: 'FL' }, watched),
      ).toBe('parec:input_FL');
    });

    it('is still ambiguous when two matched nodes both expose the wanted port', () => {
      const mk = (nodeId: string, portId: string) => ({
        [nodeId]: { _changedType: null, node: { id: nodeId, type: 'Node', 'node.name': 'pw-play' } },
        [portId]: {
          _changedType: null,
          port: { id: portId, type: 'Port', 'node.id': nodeId },
          simple: { id: portId, type: 'output_FL', name: 'pw-play' },
        },
      });
      const watched = { ...mk('100', '200'), ...mk('101', '201') } as any;
      expect(
        resolveEndpoint({ findByApp: { binName: 'pw-play' }, portKind: 'output', channel: 'FL' }, watched),
      ).toBeUndefined();
    });

    it('returns undefined when no app match', () => {
      const watched = buildWatched({
        nodeProps: { 'node.name': 'mpv', 'application.process.binary': 'mpv' },
        portSuffix: 'playback_FL',
      });
      expect(
        resolveEndpoint(
          { findByApp: { binName: 'parec' }, portKind: 'input', channel: 'FL' },
          watched,
        ),
      ).toBeUndefined();
    });

    it('resolves output_<CH> port of a player stream (pw-play has no process props on the node)', () => {
      const watched = buildWatched({
        nodeProps: { 'node.name': 'pw-play', 'application.name': 'pw-play' },
        portSuffix: 'output_FR',
      });
      expect(
        resolveEndpoint(
          { findByApp: { binName: 'pw-play' }, portKind: 'output', channel: 'FR' },
          watched,
        ),
      ).toBe('pw-play:output_FR');
    });

    it('does not resolve a sink-style playback_<CH> suffix on a stream node', () => {
      const watched = buildWatched({
        nodeProps: { 'node.name': 'pw-play', 'application.name': 'pw-play' },
        portSuffix: 'output_FL',
      });
      expect(
        resolveEndpoint(
          { findByApp: { binName: 'pw-play' }, portKind: 'playback' as any, channel: 'FL' },
          watched,
        ),
      ).toBeUndefined();
    });

    it('returns undefined when port suffix missing on matched node', () => {
      const watched = buildWatched({
        nodeProps: { 'node.name': 'parec', 'application.process.binary': 'pacat' },
        portSuffix: 'input_FR',
      });
      expect(
        resolveEndpoint(
          { findByApp: { binName: 'pacat' }, portKind: 'input', channel: 'FL' },
          watched,
        ),
      ).toBeUndefined();
    });
  });

  describe('mergeClientProps', () => {
    const nativeClient = {
      'pipewire.sec.pid': '1301298',
      'application.name': 'pw-cat',
      'application.process.binary': 'pw-cat',
      'application.process.id': '1301298',
      'pipewire.access': 'unrestricted',
    };

    it('fills application.* gaps from the client without overriding node values', () => {
      const node: BaseBlock = { id: '346', type: 'Node', 'node.name': 'pw-play', 'application.name': 'pw-play' };
      mergeClientProps(node, nativeClient);
      expect(node['application.name']).toBe('pw-play');
      expect(node['application.process.binary']).toBe('pw-cat');
      expect(node['application.process.id']).toBe('1301298');
      expect(node['pipewire.access']).toBeUndefined();
    });

    it('falls back to pipewire.sec.pid when no application.process.id anywhere', () => {
      const node: BaseBlock = { id: '1', type: 'Node' };
      mergeClientProps(node, { 'pipewire.sec.pid': '42' });
      expect(node['application.process.id']).toBe('42');
    });

    it('keeps pulse node pid over pipewire-pulse daemon pid', () => {
      const node: BaseBlock = { id: '1', type: 'Node', 'application.process.id': '1301300' };
      mergeClientProps(node, { 'pipewire.sec.pid': '2413', 'application.process.id': '1301300' });
      expect(node['application.process.id']).toBe('1301300');
    });
  });

  describe('mergeDiffs', () => {
    it('dedupes add for two entries on the same source port', () => {
      const merged = mergeDiffs([
        { from: '1:paplay:output_FL', add: ['70:null:playback_FL'], rm: ['128:alsa:playback_FL'] },
        { from: '1:paplay:output_FL', add: ['70:null:playback_FL'], rm: ['128:alsa:playback_FL'] },
      ]);
      expect(merged).toEqual([{ from: '1:paplay:output_FL', add: ['70:null:playback_FL'], rm: ['128:alsa:playback_FL'] }]);
    });

    it('keeps a link wanted by any entry (rm is intersection)', () => {
      const merged = mergeDiffs([
        { from: '1:a:out_FL', add: [], rm: ['10:x:in_FL', '11:y:in_FL'] },
        { from: '1:a:out_FL', add: [], rm: ['10:x:in_FL'] },
      ]);
      expect(merged[0].rm).toEqual(['10:x:in_FL']);
    });

    it('an entry with refused removals blocks removals for that port', () => {
      const merged = mergeDiffs([
        { from: '1:a:out_FL', add: ['5:b:in_FL'], rm: ['10:x:in_FL'] },
        { from: '1:a:out_FL', add: [], rm: [] },
      ]);
      expect(merged[0]).toEqual({ from: '1:a:out_FL', add: ['5:b:in_FL'], rm: [] });
    });

    it('leaves different ports untouched', () => {
      const merged = mergeDiffs([
        { from: '1:a:out_FL', add: ['5:b:in_FL'], rm: [] },
        { from: '2:a:out_FR', add: ['6:b:in_FR'], rm: ['7:c:in_FR'] },
      ]);
      expect(merged).toHaveLength(2);
    });
  });
});

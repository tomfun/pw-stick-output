import {
  configHelper,
  configHelperAppPlay,
  configHelperRecordForApp,
  hasAppEndpoints,
  isEndpointByApp,
} from './configHelper.js';

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

describe('configHelperRecordForApp', () => {
  it('routes a hardware source into an app input port per channel', () => {
    const result = configHelperRecordForApp('alsa_input.x:capture', { binName: 'parec', pid: 12354 });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      findByid: 'alsa_input.x:capture_FL',
      stickTo: [{ findByApp: { binName: 'parec', pid: 12354 }, portKind: 'input', channel: 'FL' }],
      ignoreMonitors: true,
    });
    expect(result[1]).toMatchObject({
      findByid: 'alsa_input.x:capture_FR',
      stickTo: [{ findByApp: { binName: 'parec', pid: 12354 }, portKind: 'input', channel: 'FR' }],
    });
  });
});

describe('configHelperAppPlay', () => {
  it('routes app playback ports to a sink per channel', () => {
    const result = configHelperAppPlay({ binName: 'mpv' }, 'input.hcl_compressor:playback');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      findByApp: { binName: 'mpv' },
      portKind: 'output',
      channel: 'FL',
      stickTo: [{ findByid: 'input.hcl_compressor:playback_FL' }],
    });
    expect(isEndpointByApp(result[0])).toBe(true);
    expect(isEndpointByApp(result[0].stickTo[0])).toBe(false);
  });
});

describe('hasAppEndpoints', () => {
  it('is false for id-only configs', () => {
    expect(hasAppEndpoints(configHelper('a:output', 'b:playback'))).toBe(false);
  });
  it('detects app endpoint on the from side', () => {
    expect(hasAppEndpoints(configHelperAppPlay({ binName: 'mpv' }, 'b:playback'))).toBe(true);
  });
  it('detects app endpoint on the stickTo side', () => {
    expect(hasAppEndpoints(configHelperRecordForApp('a:capture', { pid: 1 }))).toBe(true);
  });
});

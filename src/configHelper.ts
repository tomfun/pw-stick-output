export type AppRef = { binName?: string; pid?: number };

export type EndpointById = { findByid: string };
/**
 * Port side of an application stream node.
 * PipeWire names stream ports `input_<CH>` (Stream/Input, e.g. recorders) and
 * `output_<CH>` (Stream/Output, e.g. players) — there is no `playback_*` on streams,
 * that naming belongs to sinks.
 */
export type AppPortKind = 'input' | 'output';
export type EndpointByApp = {
  findByApp: AppRef;
  portKind: AppPortKind;
  channel: string;
};
export type Endpoint = EndpointById | EndpointByApp;

export function isEndpointByApp(ep: Endpoint): ep is EndpointByApp {
  return 'findByApp' in ep;
}

/** true when at least one `from` or `stickTo` endpoint needs application lookup */
export function hasAppEndpoints(config: MinimalAlphaConfigItem[]): boolean {
  return config.some((item) => isEndpointByApp(item) || item.stickTo.some(isEndpointByApp));
}

export type MinimalAlphaConfigItem = Endpoint & {
  stickTo: Endpoint[];
  ignoreMonitors: true;
  ignore: {
    'object.path': {
      match: RegExp;
    };
  };
};

const defaultIgnore = {
  ignoreMonitors: true as const,
  ignore: {
    'object.path': {
      match: /^PulseAudio Volume Control:/,
    },
  },
};

export function configHelper(from: string, to: string, channels = ['FL', 'FR']): MinimalAlphaConfigItem[] {
  return channels.map((ch) => ({
    findByid: `${from}_${ch}`,
    stickTo: [{ findByid: `${to}_${ch}` }],
    ...defaultIgnore,
  }));
}

export function configHelperRecordForApp(
  from: string,
  app: AppRef,
  channels = ['FL', 'FR'],
): MinimalAlphaConfigItem[] {
  return channels.map((ch) => ({
    findByid: `${from}_${ch}`,
    stickTo: [{ findByApp: app, portKind: 'input', channel: ch }],
    ...defaultIgnore,
  }));
}

export function configHelperAppPlay(
  app: AppRef,
  to: string,
  channels = ['FL', 'FR'],
): MinimalAlphaConfigItem[] {
  return channels.map((ch) => ({
    findByApp: app,
    portKind: 'output',
    channel: ch,
    stickTo: [{ findByid: `${to}_${ch}` }],
    ...defaultIgnore,
  }));
}

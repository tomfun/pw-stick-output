export interface MinimalAlphaConfigItem {
  findByid: string;
  stickTo: { findByid: string }[];
  ignoreMonitors: true;
  ignore: {
    'object.path': {
      match: RegExp;
    };
  };
}

export function configHelper(from: string, to: string, channels = ['FL', 'FR']): MinimalAlphaConfigItem[] {
  return channels.map((ch) => ({
    findByid: `${from}_${ch}`,
    stickTo: [{ findByid: `${to}_${ch}` }],
    ignoreMonitors: true,
    ignore: {
      'object.path': {
        match: /^PulseAudio Volume Control:/,
      },
    },
  }));
}

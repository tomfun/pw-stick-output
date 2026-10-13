import { configHelper } from './dist/configHelper.js';
// const {configHelper} = require('./dist/configHelper')
// configHelper is global @<@()

export default [
  // ...configHelper('output.eq_before_comp:output', 'input.hcl_compressor:playback'),
  // ...configHelper('rtp_session.slimBook:receive', 'input.eq_from_fly_plate:playback'),

  ...configHelper('output.eq_before_comp:output', 'input.eq_sven:playback'),
  ...configHelper('output.lg_low_pass:output', 'input.eq_sven:playback'),
  ...configHelper('output.eq_sven:output', 'alsa_output.pci-0000_00_1f.3.analog-stereo:playback'),
];

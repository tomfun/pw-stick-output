// const {configHelper} = require('./src/configHelper.js')
// configHelper is global @<@()

module.exports = [
  ...configHelper('output.eq_before_comp:output', 'input.hcl_compressor:playback'),
  ...configHelper('rtp_session.slimBook:receive', 'input.eq_from_fly_plate:playback'),
  ...configHelper('output.eq_sven:output', 'alsa_output.pci-0000_01_00.1.hdmi-stereo:playback'),

  ...configHelper('output.eq_from_fly_plate:output', 'input.eq_sven:playback'),
  ...configHelper('output.eq_after_comp:output', 'input.eq_sven:playback'),
  ...configHelper('output.hcl_compressor:output', 'input.eq_after_comp:playback'),
];

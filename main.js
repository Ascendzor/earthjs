var interactiveEarth = require('interactive-earth');
var graticuleLayer = require('interactive-earth-graticule');
interactiveEarth.drawEarth('earthContainer');

setTimeout(function() {
  interactiveEarth.addLayer(graticuleLayer);
}, 2000);

setTimeout(function() {
  interactiveEarth.removeLayer(graticuleLayer);
}, 4000);

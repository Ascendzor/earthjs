var interactiveEarth = require('interactive-earth');
var graticuleLayer = require('interactive-earth-graticule');
var pointsLayer = require('interactive-earth-points');

var lightningOptions = {
  get: '',
  color: 'red',
  pointDuration: 10
}
var lightningPointsLayer = pointsLayer(lightningOptions)
interactiveEarth.drawEarth('earthContainer');

setTimeout(function() {
  interactiveEarth.addLayer(graticuleLayer);
}, 2000);

setTimeout(function() {
  interactiveEarth.removeLayer(graticuleLayer);
}, 4000);

setTimeout(function() {
  interactiveEarth.addLayer(lightningPointsLayer);
}, 1000);

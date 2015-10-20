var earth = require('./earth.js');

var earthHandle;
module.exports = {
  drawEarth: function(containerId) {
    earthHandle = earth(containerId);
  },
  addLayer: function(layer) {
    console.log('only adds graticule for now, needs to be made extendable');
    earthHandle.addLayer(layer);
  },
  removeLayer: function(layer) {
    console.log('only removes graticule for now, needs to be made extendable');
    earthHandle.removeLayer(layer);
  }
}

var graticuleLayer = require('interactive-earth-graticule');
var earthHandle = earth('earthContainer2')
setTimeout(function() {
  earthHandle
    //.setProjection('equirectangular')
    .addLayer(graticuleLayer);
}, 2000);

setTimeout(function() {
  earthHandle
    .removeLayer(graticuleLayer);
}, 4000);

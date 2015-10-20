var earth = require('./earth.js');
var graticuleLayer = require('./graticule-layer.js');

var earthHandle;
module.exports = {
  drawEarth: function(containerId) {
    earthHandle = earth(containerId);
  },
  addLayer: function(layer) {
    console.log('only adds graticule for now, needs to be made extendable');
    earthHandle.addLayer(graticuleLayer);
  },
  removeLayer: function(layer) {
    console.log('only removes graticule for now, needs to be made extendable');
    earthHandle.removeLayer(graticuleLayer);
  }
}

var earthHandle = earth('earthContainer2')
setTimeout(function() {
  earthHandle
    //.setProjection('equirectangular')
    .addLayer(graticuleLayer);
}, 3000);

setTimeout(function() {
  earthHandle
    .removeLayer(graticuleLayer);
}, 5000);

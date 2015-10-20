var earth = require('./earth.js');
var graticuleLayer = require('./graticule-layer.js');
module.exports = function(containerId) {
  return earth(containerId);
}

var earthHandle = earth('earthContainer2')
setTimeout(function() {
  earthHandle
    //.setProjection('equirectangular')
    .addLayer(graticuleLayer)
    .removeLayer('removing a layer');
}, 3000);

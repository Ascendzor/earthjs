var earth = require('./earth.js');
module.exports = function(containerId) {
  return earth(containerId);
}

// var earthHandle = earth('earthContainer2')
//
// setTimeout(function() {
//   earthHandle.setProjection('equirectangular')
//   .addLayer('adding a layer')
//   .removeLayer('removing a layer');
// }, 1000);
//
// setTimeout(function() {
//   earthHandle.setProjection('orthographic')
//   .addLayer('adding a layer')
//   .removeLayer('removing a layer');
// }, 5000);

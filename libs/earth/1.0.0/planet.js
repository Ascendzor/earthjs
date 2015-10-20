var earth = require('./earth.js');
module.exports = function(containerId) {
  return earth(containerId);
}

// var earthHandle = earth('earthContainer2')
//
// setTimeout(function() {
//   earthHandle
//     //.setProjection('equirectangular')
//     .addLayer('gratitudes')
//     .removeLayer('removing a layer');
// }, 3000);

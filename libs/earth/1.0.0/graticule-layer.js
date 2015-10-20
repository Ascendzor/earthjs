var d3 = require('d3');
var µ = require('./micro.js')();

var drawOverlay = function(hostElement, randomString) {
  d3.select(hostElement)
    .append('canvas')
    .attr('class', 'fill-screen')
    .attr('id', 'overlay');
  var ctx = d3.select("#overlay").node().getContext("2d");
  µ.clearCanvas(d3.select("#overlay").node());
  ctx.putImageData(field.overlay, 0, 0);
  console.log(randomString);
}

module.exports = function(hostElement) {
  var graticuleAgent = µ.newAgent();
  graticuleAgent.submit(drawOverlay, hostElement, 'test');
  console.log('trying to render the graticule');
}

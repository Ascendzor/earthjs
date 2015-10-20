var d3 = require('d3');

module.exports = {
  addLayer: function(globe, hostElement) {
    var path = d3.geo.path().projection(globe.projection);
    d3.select("#map").append("path")
      .attr("class", "graticule")
      .datum(d3.geo.graticule())
      .attr("d", path);
  },
  removeLayer: function() {
    d3.select("#map").selectAll(".graticule").remove()
    console.log('trying to remove graticule');
  }
}

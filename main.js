var interactiveEarth = require('interactive-earth');
var graticuleLayer = require('interactive-earth-graticule');
var pointsLayer = require('interactive-earth-points');
var moment = require('moment');

var lightningOptions = {
  get: '',
  color: 'red',
  pointDuration: 10,
  getData: function(cb) {
    var coord0 = {
      long: 178.79835810890188,
      lat: 2.7444937212815645,
      dateTime: moment().toDate()
    };
    var coord1 = {
      long: 170,
      lat: 10,
      dateTime: moment().toDate()
    }
    cb([coord0, coord1]);
    setInterval(function() {
      if(Math.random() > 0.5) {
        var coord = {
          long: 160 + Math.random() * 20,
          lat: 2 + Math.random() * 20,
          dateTime: moment().toDate()
        }
        cb(coord);
      }
    }, 500);
  }
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

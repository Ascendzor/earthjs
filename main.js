var interactiveEarth = require('interactive-earth');
var graticuleLayer = require('interactive-earth-graticule');
var pointsLayer = require('interactive-earth-points');
var moment = require('moment');

var lightningOptions = {
  get: '',
  color: 'red',
  pointDuration: 10000,
  getData: function(cb) {
    var coord0 = {
      long: 103,
      lat: -40,
      dateTime: moment().toDate()
    };
    var coord1 = {
      long: 170,
      lat: -11,
      dateTime: moment().toDate()
    }
    cb([coord0, coord1]);
    setInterval(function() {
      if(Math.random() > 0.5) {
        var coord = {
          long: 100 + Math.random() * 70,
          lat: -40 + Math.random() * 30,
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

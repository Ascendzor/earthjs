var interactiveEarth = require('interactive-earth');
var graticuleLayer = require('interactive-earth-graticule');
var pointsLayer = require('interactive-earth-points');
var moment = require('moment');

var intervalHandle;
var lightningOptions = {
  get: '',
  color: 'red',
  pointDuration: 5000,
  getData: function(cb) {
    intervalHandle = setInterval(function() {
      if(Math.random() > 0.5) {
        var coord = {
          long: 100 + Math.random() * 70,
          lat: -40 + Math.random() * 30,
          dateTime: moment().toDate()
        }
        cb(coord);
      }
    }, 500);
  },
  stopGettingData: function() {
    clearInterval(intervalHandle);
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

setTimeout(function() {
  interactiveEarth.removeLayer(lightningPointsLayer);
}, 8000);

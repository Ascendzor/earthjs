(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * earth - a project to visualize global air data.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
(function() {
    var µ = require('./micro.js')();
    var globes = require('./globes.js')();
    var products = require('./products.js');
    console.log(µ);
    var SECOND = 1000;
    var MINUTE = 60 * SECOND;
    var HOUR = 60 * MINUTE;
    var MAX_TASK_TIME = 100;                  // amount of time before a task yields control (millis)
    var MIN_SLEEP_TIME = 25;                  // amount of time a task waits before resuming (millis)
    var MIN_MOVE = 4;                         // slack before a drag operation beings (pixels)
    var MOVE_END_WAIT = 1000;                 // time to wait for a move operation to be considered done (millis)

    var OVERLAY_ALPHA = Math.floor(0.4*255);  // overlay transparency (on scale [0, 255])
    var INTENSITY_SCALE_STEP = 10;            // step size of particle intensity color scale
    var MAX_PARTICLE_AGE = 100;               // max number of frames a particle is drawn before regeneration
    var PARTICLE_LINE_WIDTH = 1.0;            // line width of a drawn particle
    var PARTICLE_MULTIPLIER = 7;              // particle count scalar (completely arbitrary--this values looks nice)
    var PARTICLE_REDUCTION = 0.75;            // reduce particle count to this much of normal for mobile devices
    var FRAME_RATE = 40;                      // desired milliseconds per frame

    var NULL_WIND_VECTOR = [NaN, NaN, null];  // singleton for undefined location outside the vector field [u, v, mag]
    var HOLE_VECTOR = [NaN, NaN, null];       // singleton that signifies a hole in the vector field
    var TRANSPARENT_BLACK = [0, 0, 0, 0];     // singleton 0 rgba
    var REMAINING = "▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫";   // glyphs for remaining progress bar
    var COMPLETED = "▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪";   // glyphs for completed progress bar

    var hostElement = document.getElementById('earthContainer');
    var view = {
		    width: hostElement.offsetWidth,
        height: hostElement.offsetHeight
    };
    var log = µ.log();

    /**
     * An object to display various types of messages to the user.
     */
    var report = function() {
        var s = d3.select("#status"), p = d3.select("#progress"), total = REMAINING.length;
        return {
            status: function(msg) {
                return s.classed("bad") ? s : s.text(msg);  // errors are sticky until reset
            },
            error: function(err) {
                var msg = err.status ? err.status + " " + err.message : err;
                switch (err.status) {
                    case -1: msg = "Server Down"; break;
                    case 404: msg = "No Data"; break;
                }

                log.error(err);
                return s.classed("bad", true).text(msg);
            },
            reset: function() {
                return s.classed("bad", false).text("");
            },
            progress: function(amount) {  // amount of progress to report in the range [0, 1]
                if (0 <= amount && amount < 1) {
                    var i = Math.ceil(amount * total);
                    var bar = COMPLETED.substr(0, i) + REMAINING.substr(0, total - i);
                    return p.classed("invisible", false).text(bar);
                }
                return p.classed("invisible", true).text("");  // progress complete
            }
        };
    }();

    function newAgent() {
        return µ.newAgent().on({"reject": report.error, "fail": report.error});
    }

    // Construct the page's main internal components:

      console.log('globes not defined here?');
    var configuration =
        µ.buildConfiguration(globes, products.overlayTypes);  // holds the page's current configuration settings
    var inputController = buildInputController();             // interprets drag/zoom operations
    var meshAgent = newAgent();      // map data for the earth
    var globeAgent = newAgent();     // the model of the globe
    var gridAgent = newAgent();      // the grid of weather data
    var rendererAgent = newAgent();  // the globe SVG renderer
    var fieldAgent = newAgent();     // the interpolated wind vector field
    var animatorAgent = newAgent();  // the wind animator
    var overlayAgent = newAgent();   // color overlay over the animation

    /**
     * The input controller is an object that translates move operations (drag and/or zoom) into mutations of the
     * current globe's projection, and emits events so other page components can react to these move operations.
     *
     * D3's built-in Zoom behavior is used to bind to the document's drag/zoom events, and the input controller
     * interprets D3's events as move operations on the globe. This method is complicated due to the complex
     * event behavior that occurs during drag and zoom.
     *
     * D3 move operations usually occur as "zoomstart" -> ("zoom")* -> "zoomend" event chain. During "zoom" events
     * the scale and mouse may change, implying a zoom or drag operation accordingly. These operations are quite
     * noisy. What should otherwise be one smooth continuous zoom is usually comprised of several "zoomstart" ->
     * "zoom" -> "zoomend" event chains. A debouncer is used to eliminate the noise by waiting a short period of
     * time to ensure the user has finished the move operation.
     *
     * The "zoom" events may not occur; a simple click operation occurs as: "zoomstart" -> "zoomend". There is
     * additional logic for other corner cases, such as spurious drags which move the globe just a few pixels
     * (most likely unintentional), and the tendency for some touch devices to issue events out of order:
     * "zoom" -> "zoomstart" -> "zoomend".
     *
     * This object emits clean "moveStart" -> ("move")* -> "moveEnd" events for move operations, and "click" events
     * for normal clicks. Spurious moves emit no events.
     */
    function buildInputController() {
        var globe, op = null;

        /**
         * @returns {Object} an object to represent the state for one move operation.
         */
        function newOp(startMouse, startScale) {
            return {
                type: "click",  // initially assumed to be a click operation
                startMouse: startMouse,
                startScale: startScale,
                manipulator: globe.manipulator(startMouse, startScale)
            };
        }

        var zoom = d3.behavior.zoom()
            .on("zoomstart", function() {
                op = op || newOp(d3.mouse(this), zoom.scale());  // a new operation begins
            })
            .on("zoom", function() {
                var currentMouse = d3.mouse(this), currentScale = d3.event.scale;
                op = op || newOp(currentMouse, 1);  // Fix bug on some browsers where zoomstart fires out of order.
                if (op.type === "click" || op.type === "spurious") {
                    var distanceMoved = µ.distance(currentMouse, op.startMouse);
                    if (currentScale === op.startScale && distanceMoved < MIN_MOVE) {
                        // to reduce annoyance, ignore op if mouse has barely moved and no zoom is occurring
                        op.type = distanceMoved > 0 ? "click" : "spurious";
                        return;
                    }
                    dispatch.trigger("moveStart");
                    op.type = "drag";
                }
                if (currentScale != op.startScale) {
                    op.type = "zoom";  // whenever a scale change is detected, (stickily) switch to a zoom operation
                }

                // when zooming, ignore whatever the mouse is doing--really cleans up behavior on touch devices
                op.manipulator.move(op.type === "zoom" ? null : currentMouse, currentScale);
                dispatch.trigger("move");
            })
            .on("zoomend", function() {
                op.manipulator.end();
                if (op.type === "click") {
                    dispatch.trigger("click", op.startMouse, globe.projection.invert(op.startMouse) || []);
                }
                else if (op.type !== "spurious") {
                    signalEnd();
                }
                op = null;  // the drag/zoom/click operation is over
            });

        var signalEnd = _.debounce(function() {
            if (!op || op.type !== "drag" && op.type !== "zoom") {
                configuration.save({orientation: globe.orientation()}, {source: "moveEnd"});
                dispatch.trigger("moveEnd");
            }
        }, MOVE_END_WAIT);  // wait for a bit to decide if user has stopped moving the globe

        d3.select("#display").call(zoom);

        function reorient() {
            var options = arguments[3] || {};
            if (!globe || options.source === "moveEnd") {
                // reorientation occurred because the user just finished a move operation, so globe is already
                // oriented correctly.
                return;
            }
            dispatch.trigger("moveStart");
            globe.orientation(configuration.get("orientation"), view);
            zoom.scale(globe.projection.scale());
            dispatch.trigger("moveEnd");
        }

        var dispatch = _.extend({
            globe: function(_) {
                if (_) {
                    globe = _;
                    zoom.scaleExtent(globe.scaleExtent());
                    reorient();
                }
                return _ ? this : globe;
            }
        }, Backbone.Events);
        return dispatch.listenTo(configuration, "change:orientation", reorient);
    }

    /**
     * @param resource the GeoJSON resource's URL
     * @returns {Object} a promise for GeoJSON topology features: {boundaryLo:, boundaryHi:}
     */
    function buildMesh(resource) {
        var cancel = this.cancel;
        report.status("Downloading...");
        return µ.loadJson(resource).then(function(topo) {
            if (cancel.requested) return null;
            log.time("building meshes");
            var o = topo.objects;
            var coastLo = topojson.feature(topo, µ.isMobile() ? o.coastline_tiny : o.coastline_110m);
            var coastHi = topojson.feature(topo, µ.isMobile() ? o.coastline_110m : o.coastline_50m);
            var lakesLo = topojson.feature(topo, µ.isMobile() ? o.lakes_tiny : o.lakes_110m);
            var lakesHi = topojson.feature(topo, µ.isMobile() ? o.lakes_110m : o.lakes_50m);
            log.timeEnd("building meshes");
            return {
                coastLo: coastLo,
                coastHi: coastHi,
                lakesLo: lakesLo,
                lakesHi: lakesHi
            };
        });
    }

    /**
     * @param {String} projectionName the desired projection's name.
     * @returns {Object} a promise for a globe object.
     */
    function buildGlobe(projectionName) {
        var builder = globes.get(projectionName);
        if (!builder) {
            return when.reject("Unknown projection: " + projectionName);
        }
        return when(builder(view));
    }

    // Some hacky stuff to ensure only one download can be in progress at a time.
    var downloadsInProgress = 0;

    function buildGrids() {
        report.status("Downloading...");
        log.time("build grids");
        // UNDONE: upon failure to load a product, the unloaded product should still be stored in the agent.
        //         this allows us to use the product for navigation and other state.
        var cancel = this.cancel;
        downloadsInProgress++;
        var loaded = when.map(products.productsFor(configuration.attributes), function(product) {
            return product.load(cancel);
        });
        return when.all(loaded).then(function(products) {
            log.time("build grids");
            return {primaryGrid: products[0], overlayGrid: products[1] || products[0]};
        }).ensure(function() {
            downloadsInProgress--;
        });
    }

    /**
     * Modifies the configuration to navigate to the chronologically next or previous data layer.
     */
    function navigate(step) {
        if (downloadsInProgress > 0) {
            log.debug("Download in progress--ignoring nav request.");
            return;
        }
        var next = gridAgent.value().primaryGrid.navigate(step);
        if (next) {
            configuration.save(µ.dateToConfig(next));
        }
    }

    function buildRenderer(mesh, globe) {
        if (!mesh || !globe) return null;

        report.status("Rendering Globe...");
        log.time("rendering map");

        // UNDONE: better way to do the following?
        var dispatch = _.clone(Backbone.Events);
        if (rendererAgent._previous) {
            rendererAgent._previous.stopListening();
        }
        rendererAgent._previous = dispatch;

        // First clear map and foreground svg contents.
        µ.removeChildren(d3.select("#map").node());
        µ.removeChildren(d3.select("#foreground").node());
        // Create new map svg elements.
        globe.defineMap(d3.select("#map"), d3.select("#foreground"));

        var path = d3.geo.path().projection(globe.projection).pointRadius(7);
        var coastline = d3.select(".coastline");
        var lakes = d3.select(".lakes");
        d3.selectAll("path").attr("d", path);  // do an initial draw -- fixes issue with safari

        function drawLocationMark(point, coord) {
            // show the location on the map if defined
            if (fieldAgent.value() && !fieldAgent.value().isInsideBoundary(point[0], point[1])) {
                // UNDONE: Sometimes this is invoked on an old, released field, because new one has not been
                //         built yet, causing the mark to not get drawn.
                return;  // outside the field boundary, so ignore.
            }
            if (coord && _.isFinite(coord[0]) && _.isFinite(coord[1])) {
                var mark = d3.select(".location-mark");
                if (!mark.node()) {
                    mark = d3.select("#foreground").append("path").attr("class", "location-mark");
                }
                mark.datum({type: "Point", coordinates: coord}).attr("d", path);
            }
        }

        // Draw the location mark if one is currently visible.
        if (activeLocation.point && activeLocation.coord) {
            drawLocationMark(activeLocation.point, activeLocation.coord);
        }

        // Throttled draw method helps with slow devices that would get overwhelmed by too many redraw events.
        var REDRAW_WAIT = 5;  // milliseconds
        var doDraw_throttled = _.throttle(doDraw, REDRAW_WAIT, {leading: false});

        function doDraw() {
            d3.selectAll("path").attr("d", path);
            rendererAgent.trigger("redraw");
            doDraw_throttled = _.throttle(doDraw, REDRAW_WAIT, {leading: false});
        }

        // Attach to map rendering events on input controller.
        dispatch.listenTo(
            inputController, {
                moveStart: function() {
                    coastline.datum(mesh.coastLo);
                    lakes.datum(mesh.lakesLo);
                    rendererAgent.trigger("start");
                },
                move: function() {
                    doDraw_throttled();
                },
                moveEnd: function() {
                    coastline.datum(mesh.coastHi);
                    lakes.datum(mesh.lakesHi);
                    d3.selectAll("path").attr("d", path);
                    rendererAgent.trigger("render");
                },
                click: drawLocationMark
            });

        // Finally, inject the globe model into the input controller. Do it on the next event turn to ensure
        // renderer is fully set up before events start flowing.
        when(true).then(function() {
            inputController.globe(globe);
        });

        log.timeEnd("rendering map");
        return "ready";
    }

    function createMask(globe) {
        if (!globe) return null;

        log.time("render mask");

        // Create a detached canvas, ask the model to define the mask polygon, then fill with an opaque color.
        var width = view.width, height = view.height;
        var canvas = d3.select(document.createElement("canvas")).attr("width", width).attr("height", height).node();
        var context = globe.defineMask(canvas.getContext("2d"));
        context.fillStyle = "rgba(255, 0, 0, 1)";
        context.fill();

        var imageData = context.getImageData(0, 0, width, height);
        var data = imageData.data;  // layout: [r, g, b, a, r, g, b, a, ...]
        log.timeEnd("render mask");
        return {
            imageData: imageData,
            isVisible: function(x, y) {
                var i = (y * width + x) * 4;
                return data[i + 3] > 0;  // non-zero alpha means pixel is visible
            },
            set: function(x, y, rgba) {
                var i = (y * width + x) * 4;
                data[i    ] = rgba[0];
                data[i + 1] = rgba[1];
                data[i + 2] = rgba[2];
                data[i + 3] = rgba[3];
                return this;
            }
        };
    }

    function createField(columns, bounds, mask) {

        /**
         * @returns {Array} wind vector [u, v, magnitude] at the point (x, y), or [NaN, NaN, null] if wind
         *          is undefined at that point.
         */
        function field(x, y) {
            var column = columns[Math.round(x)];
            return column && column[Math.round(y)] || NULL_WIND_VECTOR;
        }

        /**
         * @returns {boolean} true if the field is valid at the point (x, y)
         */
        field.isDefined = function(x, y) {
            return field(x, y)[2] !== null;
        };

        /**
         * @returns {boolean} true if the point (x, y) lies inside the outer boundary of the vector field, even if
         *          the vector field has a hole (is undefined) at that point, such as at an island in a field of
         *          ocean currents.
         */
        field.isInsideBoundary = function(x, y) {
            return field(x, y) !== NULL_WIND_VECTOR;
        };

        // Frees the massive "columns" array for GC. Without this, the array is leaked (in Chrome) each time a new
        // field is interpolated because the field closure's context is leaked, for reasons that defy explanation.
        field.release = function() {
            columns = [];
        };

        field.randomize = function(o) {  // UNDONE: this method is terrible
            var x, y;
            var safetyNet = 0;
            do {
                x = Math.round(_.random(bounds.x, bounds.xMax));
                y = Math.round(_.random(bounds.y, bounds.yMax));
            } while (!field.isDefined(x, y) && safetyNet++ < 30);
            o.x = x;
            o.y = y;
            return o;
        };

        field.overlay = mask.imageData;

        return field;
    }

    /**
     * Calculate distortion of the wind vector caused by the shape of the projection at point (x, y). The wind
     * vector is modified in place and returned by this function.
     */
    function distort(projection, λ, φ, x, y, scale, wind) {
        var u = wind[0] * scale;
        var v = wind[1] * scale;
        var d = µ.distortion(projection, λ, φ, x, y);

        // Scale distortion vectors by u and v, then add.
        wind[0] = d[0] * u + d[2] * v;
        wind[1] = d[1] * u + d[3] * v;
        return wind;
    }

    function interpolateField(globe, grids) {
        if (!globe || !grids) return null;

        var mask = createMask(globe);
        var primaryGrid = grids.primaryGrid;
        var overlayGrid = grids.overlayGrid;

        log.time("interpolating field");
        var d = when.defer(), cancel = this.cancel;

        var projection = globe.projection;
        var bounds = globe.bounds(view);
        // How fast particles move on the screen (arbitrary value chosen for aesthetics).
        var velocityScale = bounds.height * primaryGrid.particles.velocityScale;

        var columns = [];
        var point = [];
        var x = bounds.x;
        var interpolate = primaryGrid.interpolate;
        var overlayInterpolate = overlayGrid.interpolate;
        var hasDistinctOverlay = primaryGrid !== overlayGrid;
        var scale = overlayGrid.scale;

        function interpolateColumn(x) {
            var column = [];
            for (var y = bounds.y; y <= bounds.yMax; y += 2) {
                if (mask.isVisible(x, y)) {
                    point[0] = x; point[1] = y;
                    var coord = projection.invert(point);
                    var color = TRANSPARENT_BLACK;
                    var wind = null;
                    if (coord) {
                        var λ = coord[0], φ = coord[1];
                        if (isFinite(λ)) {
                            wind = interpolate(λ, φ);
                            var scalar = null;
                            if (wind) {
                                wind = distort(projection, λ, φ, x, y, velocityScale, wind);
                                scalar = wind[2];
                            }
                            if (hasDistinctOverlay) {
                                scalar = overlayInterpolate(λ, φ);
                            }
                            if (µ.isValue(scalar)) {
                                color = scale.gradient(scalar, OVERLAY_ALPHA);
                            }
                        }
                    }
                    column[y+1] = column[y] = wind || HOLE_VECTOR;
                    mask.set(x, y, color).set(x+1, y, color).set(x, y+1, color).set(x+1, y+1, color);
                }
            }
            columns[x+1] = columns[x] = column;
        }

        report.status("");

        (function batchInterpolate() {
            try {
                if (!cancel.requested) {
                    var start = Date.now();
                    while (x < bounds.xMax) {
                        interpolateColumn(x);
                        x += 2;
                        if ((Date.now() - start) > MAX_TASK_TIME) {
                            // Interpolation is taking too long. Schedule the next batch for later and yield.
                            report.progress((x - bounds.x) / (bounds.xMax - bounds.x));
                            setTimeout(batchInterpolate, MIN_SLEEP_TIME);
                            return;
                        }
                    }
                }
                d.resolve(createField(columns, bounds, mask));
            }
            catch (e) {
                d.reject(e);
            }
            report.progress(1);  // 100% complete
            log.timeEnd("interpolating field");
        })();

        return d.promise;
    }

    function animate(globe, field, grids) {
        if (!globe || !field || !grids) return;

        var cancel = this.cancel;
        var bounds = globe.bounds(view);
        // maxIntensity is the velocity at which particle color intensity is maximum
        var colorStyles = µ.windIntensityColorScale(INTENSITY_SCALE_STEP, grids.primaryGrid.particles.maxIntensity);
        var buckets = colorStyles.map(function() { return []; });
        var particleCount = Math.round(bounds.width * PARTICLE_MULTIPLIER);
        if (µ.isMobile()) {
            particleCount *= PARTICLE_REDUCTION;
        }
        var fadeFillStyle = µ.isFF() ? "rgba(0, 0, 0, 0.95)" : "rgba(0, 0, 0, 0.97)";  // FF Mac alpha behaves oddly

        log.debug("particle count: " + particleCount);
        var particles = [];
        for (var i = 0; i < particleCount; i++) {
            particles.push(field.randomize({age: _.random(0, MAX_PARTICLE_AGE)}));
        }

        function evolve() {
            buckets.forEach(function(bucket) { bucket.length = 0; });
            particles.forEach(function(particle) {
                if (particle.age > MAX_PARTICLE_AGE) {
                    field.randomize(particle).age = 0;
                }
                var x = particle.x;
                var y = particle.y;
                var v = field(x, y);  // vector at current position
                var m = v[2];
                if (m === null) {
                    particle.age = MAX_PARTICLE_AGE;  // particle has escaped the grid, never to return...
                }
                else {
                    var xt = x + v[0];
                    var yt = y + v[1];
                    if (field.isDefined(xt, yt)) {
                        // Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
                        particle.xt = xt;
                        particle.yt = yt;
                        buckets[colorStyles.indexFor(m)].push(particle);
                    }
                    else {
                        // Particle isn't visible, but it still moves through the field.
                        particle.x = xt;
                        particle.y = yt;
                    }
                }
                particle.age += 1;
            });
        }

        var g = d3.select("#animation").node().getContext("2d");
        g.lineWidth = PARTICLE_LINE_WIDTH;
        g.fillStyle = fadeFillStyle;

        function draw() {
            // Fade existing particle trails.
            var prev = g.globalCompositeOperation;
            g.globalCompositeOperation = "destination-in";
            g.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
            g.globalCompositeOperation = prev;

            // Draw new particle trails.
            buckets.forEach(function(bucket, i) {
                if (bucket.length > 0) {
                    g.beginPath();
                    g.strokeStyle = colorStyles[i];
                    bucket.forEach(function(particle) {
                        g.moveTo(particle.x, particle.y);
                        g.lineTo(particle.xt, particle.yt);
                        particle.x = particle.xt;
                        particle.y = particle.yt;
                    });
                    g.stroke();
                }
            });
        }

        (function frame() {
            try {
                if (cancel.requested) {
                    field.release();
                    return;
                }
                evolve();
                draw();
                setTimeout(frame, FRAME_RATE);
            }
            catch (e) {
                report.error(e);
            }
        })();
    }

    function drawGridPoints(ctx, grid, globe) {
        if (!grid || !globe || !configuration.get("showGridPoints")) return;

        ctx.fillStyle = "rgba(255, 255, 255, 1)";
        // Use the clipping behavior of a projection stream to quickly draw visible points.
        var stream = globe.projection.stream({
            point: function(x, y) {
                ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
            }
        });
        grid.forEachPoint(function(λ, φ, d) {
            if (µ.isValue(d)) {
                stream.point(λ, φ);
            }
        });
    }

    function drawOverlay(field, overlayType) {
        if (!field) return;

        var ctx = d3.select("#overlay").node().getContext("2d"), grid = (gridAgent.value() || {}).overlayGrid;

        µ.clearCanvas(d3.select("#overlay").node());
        if (overlayType) {
            if (overlayType !== "off") {
                ctx.putImageData(field.overlay, 0, 0);
            }
            drawGridPoints(ctx, grid, globeAgent.value());
        }
    }

    /**
     * Extract the date the grids are valid, or the current date if no grid is available.
     * UNDONE: if the grids hold unloaded products, then the date can be extracted from them.
     *         This function would simplify nicely.
     */
    function validityDate(grids) {
        // When the active layer is considered "current", use its time as now, otherwise use current time as
        // now (but rounded down to the nearest three-hour block).
        var THREE_HOURS = 3 * HOUR;
        var now = grids ? grids.primaryGrid.date.getTime() : Math.floor(Date.now() / THREE_HOURS) * THREE_HOURS;
        var parts = configuration.get("date").split("/");  // yyyy/mm/dd or "current"
        var hhmm = configuration.get("hour");
        return parts.length > 1 ?
            Date.UTC(+parts[0], parts[1] - 1, +parts[2], +hhmm.substring(0, 2)) :
            parts[0] === "current" ? now : null;
    }

    /**
     * Display the grids' types in the menu.
     */
    function showGridDetails(grids) {
        var description = "", center = "";
        if (grids) {
            var langCode = d3.select("body").attr("data-lang") || "en";
            var pd = grids.primaryGrid.description(langCode), od = grids.overlayGrid.description(langCode);
            description = od.name + od.qualifier;
            if (grids.primaryGrid !== grids.overlayGrid) {
                // Combine both grid descriptions together with a " + " if their qualifiers are the same.
                description = (pd.qualifier === od.qualifier ? pd.name : pd.name + pd.qualifier) + " + " + description;
            }
            center = grids.overlayGrid.source;
        }
    }

    /**
     * Constructs a toggler for the specified product's units, storing the toggle state on the element having
     * the specified id. For example, given a product having units ["m/s", "mph"], the object returned by this
     * method sets the element's "data-index" attribute to 0 for m/s and 1 for mph. Calling value() returns the
     * currently active units object. Calling next() increments the index.
     */
    function createUnitToggle(id, product) {
        var units = product.units, size = units.length;
        var index = +(d3.select(id).attr("data-index") || 0) % size;
        return {
            value: function() {
                return units[index];
            },
            next: function() {
                d3.select(id).attr("data-index", index = ((index + 1) % size));
            }
        };
    }

    /**
     * Display the specified overlay value. Allow toggling between the different types of supported units.
     */
    function showOverlayValueAtLocation(value, product) {
        var unitToggle = createUnitToggle("#location-value-units", product), units = unitToggle.value();
        d3.select("#location-value").text(µ.formatScalar(value, units));
        d3.select("#location-value-units").text(units.label).on("click", function() {
            unitToggle.next();
            showOverlayValueAtLocation(value, product);
        });
    }

    // Stores the point and coordinate of the currently visible location. This is used to update the location
    // details when the field changes.
    var activeLocation = {};

    /**
     * Display a local data callout at the given [x, y] point and its corresponding [lon, lat] coordinates.
     * The location may not be valid, in which case no callout is displayed. Display location data for both
     * the primary grid and overlay grid, performing interpolation when necessary.
     */
    function showLocationDetails(point, coord) {
        point = point || [];
        coord = coord || [];
        var grids = gridAgent.value(), field = fieldAgent.value(), λ = coord[0], φ = coord[1];
        if (!field || !field.isInsideBoundary(point[0], point[1])) {
            return;
        }

        clearLocationDetails(false);  // clean the slate
        activeLocation = {point: point, coord: coord};  // remember where the current location is

        if (_.isFinite(λ) && _.isFinite(φ)) {
            d3.select("#location-coord").text(µ.formatCoordinates(λ, φ));
            d3.select("#location-close").classed("invisible", false);
        }
    }

    function updateLocationDetails() {
        showLocationDetails(activeLocation.point, activeLocation.coord);
    }

    function clearLocationDetails(clearEverything) {
        d3.select("#location-coord").text("");
        d3.select("#location-close").classed("invisible", true);
        if (clearEverything) {
            activeLocation = {};
            d3.select(".location-mark").remove();
        }
    }

    function stopCurrentAnimation(alsoClearCanvas) {
        animatorAgent.cancel();
        if (alsoClearCanvas) {
            µ.clearCanvas(d3.select("#animation").node());
        }
    }

    /**
     * Registers a click event handler for the specified DOM element which modifies the configuration to have
     * the attributes represented by newAttr. An event listener is also registered for configuration change events,
     * so when a change occurs the button becomes highlighted (i.e., class ".highlighted" is assigned or removed) if
     * the configuration matches the attributes for this button. The set of attributes used for the matching is taken
     * from newAttr, unless a custom set of keys is provided.
     */
    function bindButtonToConfiguration(elementId, newAttr, keys) {
        keys = keys || _.keys(newAttr);
        d3.select(elementId).on("click", function() {
            if (d3.select(elementId).classed("disabled")) return;
            configuration.save(newAttr);
        });
        configuration.on("change", function(model) {
            var attr = model.attributes;
            d3.select(elementId).classed("highlighted", _.isEqual(_.pick(attr, keys), _.pick(newAttr, keys)));
        });
    }

    function reportSponsorClick(type) {
        if (ga) {
            ga("send", "event", "sponsor", type);
        }
    }

    /**
     * Registers all event handlers to bind components and page elements together. There must be a cleaner
     * way to accomplish this...
     */
    function init() {
        report.status("Initializing...");
		d3.select('#earthContainer').append('svg')
			.attr('class', 'fill-screen')
			.attr('id', 'map');
		d3.select('#earthContainer').append('canvas')
			.attr('id', 'animation')
			.attr('class', 'fill-screen');
		d3.select('#earthContainer').append('canvas')
			.attr('id', 'overlay')
			.attr('class', 'fill-screen');
		d3.select('#earthContainer').append('svg')
			.attr('id', 'foreground')
			.attr('class', 'fill-screen');
        d3.selectAll(".fill-screen").attr("width", view.width).attr("height", view.height);

        if (µ.isFF()) {
            // Workaround FF performance issue of slow click behavior on map having thick coastlines.
            d3.select("#display").classed("firefox", true);
        }

        // Tweak document to distinguish CSS styling between touch and non-touch environments. Hacky hack.
        if ("ontouchstart" in document.documentElement) {
            d3.select(document).on("touchstart", function() {});  // this hack enables :active pseudoclass
        }
        else {
            d3.select(document.documentElement).classed("no-touch", true);  // to filter styles problematic for touch
        }

        configuration.on("change", report.reset);

        meshAgent.listenTo(configuration, "change:topology", function(context, attr) {
            meshAgent.submit(buildMesh, attr);
        });

        globeAgent.listenTo(configuration, "change:projection", function(source, attr) {
            globeAgent.submit(buildGlobe, attr);
        });

        gridAgent.listenTo(configuration, "change", function() {
            var changed = _.keys(configuration.changedAttributes()), rebuildRequired = false;

            // Build a new grid if any layer-related attributes have changed.
            if (_.intersection(changed, ["date", "hour", "param", "surface", "level"]).length > 0) {
                rebuildRequired = true;
            }
            // Build a new grid if the new overlay type is different from the current one.
            var overlayType = configuration.get("overlayType") || "default";
            if (_.indexOf(changed, "overlayType") >= 0 && overlayType !== "off") {
                var grids = (gridAgent.value() || {}), primary = grids.primaryGrid, overlay = grids.overlayGrid;
                if (!overlay) {
                    // Do a rebuild if we have no overlay grid.
                    rebuildRequired = true;
                }
                else if (overlay.type !== overlayType && !(overlayType === "default" && primary === overlay)) {
                    // Do a rebuild if the types are different.
                    rebuildRequired = true;
                }
            }

            if (rebuildRequired) {
                gridAgent.submit(buildGrids);
            }
        });
        gridAgent.on("submit", function() {
            showGridDetails(null);
        });
        gridAgent.on("update", function(grids) {
            showGridDetails(grids);
        });

        function startRendering() {
            rendererAgent.submit(buildRenderer, meshAgent.value(), globeAgent.value());
        }
        rendererAgent.listenTo(meshAgent, "update", startRendering);
        rendererAgent.listenTo(globeAgent, "update", startRendering);

        function startInterpolation() {
            fieldAgent.submit(interpolateField, globeAgent.value(), gridAgent.value());
        }
        function cancelInterpolation() {
            fieldAgent.cancel();
        }
        fieldAgent.listenTo(gridAgent, "update", startInterpolation);
        fieldAgent.listenTo(rendererAgent, "render", startInterpolation);
        fieldAgent.listenTo(rendererAgent, "start", cancelInterpolation);
        fieldAgent.listenTo(rendererAgent, "redraw", cancelInterpolation);

        animatorAgent.listenTo(fieldAgent, "update", function(field) {
            animatorAgent.submit(animate, globeAgent.value(), field, gridAgent.value());
        });
        animatorAgent.listenTo(rendererAgent, "start", stopCurrentAnimation.bind(null, true));
        animatorAgent.listenTo(gridAgent, "submit", stopCurrentAnimation.bind(null, false));
        animatorAgent.listenTo(fieldAgent, "submit", stopCurrentAnimation.bind(null, false));

        overlayAgent.listenTo(fieldAgent, "update", function() {
            overlayAgent.submit(drawOverlay, fieldAgent.value(), configuration.get("overlayType"));
        });
        overlayAgent.listenTo(rendererAgent, "start", function() {
            overlayAgent.submit(drawOverlay, fieldAgent.value(), null);
        });
        overlayAgent.listenTo(configuration, "change", function() {
            var changed = _.keys(configuration.changedAttributes())
            // if only overlay relevant flags have changed...
            if (_.intersection(changed, ["overlayType", "showGridPoints"]).length > 0) {
                overlayAgent.submit(drawOverlay, fieldAgent.value(), configuration.get("overlayType"));
            }
        });

        // Add event handlers for showing, updating, and removing location details.
        inputController.on("click", showLocationDetails);
        fieldAgent.on("update", updateLocationDetails);
        d3.select("#location-close").on("click", _.partial(clearLocationDetails, true));

        // When touch device changes between portrait and landscape, rebuild globe using the new view size.
        d3.select(window).on("orientationchange", function() {
            view = µ.view();
            globeAgent.submit(buildGlobe, configuration.get("projection"));
        });
    }

    function start() {
        // Everything is now set up, so load configuration from the hash fragment and kick off change events.
        configuration.fetch();
    }

    when(true).then(init).then(start).otherwise(report.error);

})();

},{"./globes.js":2,"./micro.js":3,"./products.js":4}],2:[function(require,module,exports){
/**
 * globes - a set of models of the earth, each having their own kind of projection and onscreen behavior.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
module.exports = function() {
    "use strict";

    var µ = require('./micro.js')();

    /**
     * @returns {Array} rotation of globe to current position of the user. Aside from asking for geolocation,
     *          which user may reject, there is not much available except timezone. Better than nothing.
     */
    function currentPosition() {
        var λ = µ.floorMod(new Date().getTimezoneOffset() / 4, 360);  // 24 hours * 60 min / 4 === 360 degrees
        return [λ, 0];
    }

    function ensureNumber(num, fallback) {
        return _.isFinite(num) || num === Infinity || num === -Infinity ? num : fallback;
    }

    /**
     * @param bounds the projection bounds: [[x0, y0], [x1, y1]]
     * @param view the view bounds {width:, height:}
     * @returns {Object} the projection bounds clamped to the specified view.
     */
    function clampedBounds(bounds, view) {
        var upperLeft = bounds[0];
        var lowerRight = bounds[1];
        var x = Math.max(Math.floor(ensureNumber(upperLeft[0], 0)), 0);
        var y = Math.max(Math.floor(ensureNumber(upperLeft[1], 0)), 0);
        var xMax = Math.min(Math.ceil(ensureNumber(lowerRight[0], view.width)), view.width - 1);
        var yMax = Math.min(Math.ceil(ensureNumber(lowerRight[1], view.height)), view.height - 1);
        return {x: x, y: y, xMax: xMax, yMax: yMax, width: xMax - x + 1, height: yMax - y + 1};
    }

    /**
     * Returns a globe object with standard behavior. At least the newProjection method must be overridden to
     * be functional.
     */
    function standardGlobe() {
        return {
            /**
             * This globe's current D3 projection.
             */
            projection: null,

            /**
             * @param view the size of the view as {width:, height:}.
             * @returns {Object} a new D3 projection of this globe appropriate for the specified view port.
             */
            newProjection: function(view) {
                throw new Error("method must be overridden");
            },

            /**
             * @param view the size of the view as {width:, height:}.
             * @returns {{x: Number, y: Number, xMax: Number, yMax: Number, width: Number, height: Number}}
             *          the bounds of the current projection clamped to the specified view.
             */
            bounds: function(view) {
                return clampedBounds(d3.geo.path().projection(this.projection).bounds({type: "Sphere"}), view);
            },

            /**
             * @param view the size of the view as {width:, height:}.
             * @returns {Number} the projection scale at which the entire globe fits within the specified view.
             */
            fit: function(view) {
                var defaultProjection = this.newProjection(view);
                var bounds = d3.geo.path().projection(defaultProjection).bounds({type: "Sphere"});
                var hScale = (bounds[1][0] - bounds[0][0]) / defaultProjection.scale();
                var vScale = (bounds[1][1] - bounds[0][1]) / defaultProjection.scale();
                return Math.min(view.width / hScale, view.height / vScale) * 0.9;
            },

            /**
             * @param view the size of the view as {width:, height:}.
             * @returns {Array} the projection transform at which the globe is centered within the specified view.
             */
            center: function(view) {
                return [view.width / 2, view.height / 2];
            },

            /**
             * @returns {Array} the range at which this globe can be zoomed.
             */
            scaleExtent: function() {
                return [25, 3000];
            },

            /**
             * Returns the current orientation of this globe as a string. If the arguments are specified,
             * mutates this globe to match the specified orientation string, usually in the form "lat,lon,scale".
             *
             * @param [o] the orientation string
             * @param [view] the size of the view as {width:, height:}.
             */
            orientation: function(o, view) {
                var projection = this.projection, rotate = projection.rotate();
                if (µ.isValue(o)) {
                    var parts = o.split(","), λ = +parts[0], φ = +parts[1], scale = +parts[2];
                    var extent = this.scaleExtent();
                    projection.rotate(_.isFinite(λ) && _.isFinite(φ) ?
                        [-λ, -φ, rotate[2]] :
                        this.newProjection(view).rotate());
                    projection.scale(_.isFinite(scale) ? µ.clamp(scale, extent[0], extent[1]) : this.fit(view));
                    projection.translate(this.center(view));
                    return this;
                }
                return [(-rotate[0]).toFixed(2), (-rotate[1]).toFixed(2), Math.round(projection.scale())].join(",");
            },

            /**
             * Returns an object that mutates this globe's current projection during a drag/zoom operation.
             * Each drag/zoom event invokes the move() method, and when the move is complete, the end() method
             * is invoked.
             *
             * @param startMouse starting mouse position.
             * @param startScale starting scale.
             */
            manipulator: function(startMouse, startScale) {
                var projection = this.projection;
                var sensitivity = 60 / startScale;  // seems to provide a good drag scaling factor
                var rotation = [projection.rotate()[0] / sensitivity, -projection.rotate()[1] / sensitivity];
                var original = projection.precision();
                projection.precision(original * 10);
                return {
                    move: function(mouse, scale) {
                        if (mouse) {
                            var xd = mouse[0] - startMouse[0] + rotation[0];
                            var yd = mouse[1] - startMouse[1] + rotation[1];
                            projection.rotate([xd * sensitivity, -yd * sensitivity, projection.rotate()[2]]);
                        }
                        projection.scale(scale);
                    },
                    end: function() {
                        projection.precision(original);
                    }
                };
            },

            /**
             * @returns {Array} the transform to apply, if any, to orient this globe to the specified coordinates.
             */
            locate: function(coord) {
                return null;
            },

            /**
             * Draws a polygon on the specified context of this globe's boundary.
             * @param context a Canvas element's 2d context.
             * @returns the context
             */
            defineMask: function(context) {
                d3.geo.path().projection(this.projection).context(context)({type: "Sphere"});
                return context;
            },

            /**
             * Appends the SVG elements that render this globe.
             * @param mapSvg the primary map SVG container.
             * @param foregroundSvg the foreground SVG container.
             */
            defineMap: function(mapSvg, foregroundSvg) {
                var path = d3.geo.path().projection(this.projection);
                var defs = mapSvg.append("defs");
                defs.append("path")
                    .attr("id", "sphere")
                    .datum({type: "Sphere"})
                    .attr("d", path);
                mapSvg.append("use")
                    .attr("xlink:href", "#sphere")
                    .attr("class", "background-sphere");
                mapSvg.append("path")
                    .attr("class", "graticule")
                    .datum(d3.geo.graticule())
                    .attr("d", path);
                mapSvg.append("path")
                    .attr("class", "hemisphere")
                    .datum(d3.geo.graticule().minorStep([0, 90]).majorStep([0, 90]))
                    .attr("d", path);
                mapSvg.append("path")
                    .attr("class", "coastline");
                mapSvg.append("path")
                    .attr("class", "lakes");
                foregroundSvg.append("use")
                    .attr("xlink:href", "#sphere")
                    .attr("class", "foreground-sphere");
            }
        };
    }

    function newGlobe(source, view) {
        var result = _.extend(standardGlobe(), source);
        result.projection = result.newProjection(view);
        return result;
    }

    // ============================================================================================

    function atlantis() {
        return newGlobe({
            newProjection: function() {
                return d3.geo.mollweide().rotate([30, -45, 90]).precision(0.1);
            }
        });
    }

    function azimuthalEquidistant() {
        return newGlobe({
            newProjection: function() {
                return d3.geo.azimuthalEquidistant().precision(0.1).rotate([0, -90]).clipAngle(180 - 0.001);
            }
        });
    }

    function conicEquidistant() {
        return newGlobe({
            newProjection: function() {
                return d3.geo.conicEquidistant().rotate(currentPosition()).precision(0.1);
            },
            center: function(view) {
                return [view.width / 2, view.height / 2 + view.height * 0.065];
            }
        });
    }

    function equirectangular() {
        return newGlobe({
            newProjection: function() {
                return d3.geo.equirectangular().rotate(currentPosition()).precision(0.1);
            }
        });
    }

    function orthographic() {
        return newGlobe({
            newProjection: function() {
                return d3.geo.orthographic().rotate(currentPosition()).precision(0.1).clipAngle(90);
            },
            defineMap: function(mapSvg, foregroundSvg) {
                var path = d3.geo.path().projection(this.projection);
                var defs = mapSvg.append("defs");
                var gradientFill = defs.append("radialGradient")
                    .attr("id", "orthographic-fill")
                    .attr("gradientUnits", "objectBoundingBox")
                    .attr("cx", "50%").attr("cy", "49%").attr("r", "50%");
                gradientFill.append("stop").attr("stop-color", "#303030").attr("offset", "69%");
                gradientFill.append("stop").attr("stop-color", "#202020").attr("offset", "91%");
                gradientFill.append("stop").attr("stop-color", "#000005").attr("offset", "96%");
                defs.append("path")
                    .attr("id", "sphere")
                    .datum({type: "Sphere"})
                    .attr("d", path);
                mapSvg.append("use")
                    .attr("xlink:href", "#sphere")
                    .attr("fill", "url(#orthographic-fill)");
                mapSvg.append("path")
                    .attr("class", "graticule")
                    .datum(d3.geo.graticule())
                    .attr("d", path);
                mapSvg.append("path")
                    .attr("class", "hemisphere")
                    .datum(d3.geo.graticule().minorStep([0, 90]).majorStep([0, 90]))
                    .attr("d", path);
                mapSvg.append("path")
                    .attr("class", "coastline");
                mapSvg.append("path")
                    .attr("class", "lakes");
                foregroundSvg.append("use")
                    .attr("xlink:href", "#sphere")
                    .attr("class", "foreground-sphere");
            },
            locate: function(coord) {
                return [-coord[0], -coord[1], this.projection.rotate()[2]];
            }
        });
    }

    function stereographic(view) {
        return newGlobe({
            newProjection: function(view) {
                return d3.geo.stereographic()
                    .rotate([-43, -20])
                    .precision(1.0)
                    .clipAngle(180 - 0.0001)
                    .clipExtent([[0, 0], [view.width, view.height]]);
            }
        }, view);
    }

    function waterman() {
        return newGlobe({
            newProjection: function() {
                return d3.geo.polyhedron.waterman().rotate([20, 0]).precision(0.1);
            },
            defineMap: function(mapSvg, foregroundSvg) {
                var path = d3.geo.path().projection(this.projection);
                var defs = mapSvg.append("defs");
                defs.append("path")
                    .attr("id", "sphere")
                    .datum({type: "Sphere"})
                    .attr("d", path);
                defs.append("clipPath")
                    .attr("id", "clip")
                    .append("use")
                    .attr("xlink:href", "#sphere");
                mapSvg.append("use")
                    .attr("xlink:href", "#sphere")
                    .attr("class", "background-sphere");
                mapSvg.append("path")
                    .attr("class", "graticule")
                    .attr("clip-path", "url(#clip)")
                    .datum(d3.geo.graticule())
                    .attr("d", path);
                mapSvg.append("path")
                    .attr("class", "coastline")
                    .attr("clip-path", "url(#clip)");
                mapSvg.append("path")
                    .attr("class", "lakes")
                    .attr("clip-path", "url(#clip)");
                foregroundSvg.append("use")
                    .attr("xlink:href", "#sphere")
                    .attr("class", "foreground-sphere");
            }
        });
    }

    function winkel3() {
        return newGlobe({
            newProjection: function() {
                return d3.geo.winkel3().precision(0.1);
            }
        });
    }

    return d3.map({
        atlantis: atlantis,
        azimuthal_equidistant: azimuthalEquidistant,
        conic_equidistant: conicEquidistant,
        equirectangular: equirectangular,
        orthographic: orthographic,
        stereographic: stereographic,
        waterman: waterman,
        winkel3: winkel3
    });

};

},{"./micro.js":3}],3:[function(require,module,exports){
/**
 * micro - a grab bag of somewhat useful utility functions and other stuff that requires unit testing
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
module.exports = function() {
    "use strict";

    var τ = 2 * Math.PI;
    var H = 0.0000360;  // 0.0000360°φ ~= 4m
    var DEFAULT_CONFIG = "current/wind/surface/level/orthographic";
    var TOPOLOGY = isMobile() ? "/data/earth-topo-mobile.json?v2" : "/data/earth-topo.json?v2";

    /**
     * @returns {Boolean} true if the specified value is truthy.
     */
    function isTruthy(x) {
        return !!x;
    }

    /**
     * @returns {Boolean} true if the specified value is not null and not undefined.
     */
    function isValue(x) {
        return x !== null && x !== undefined;
    }

    /**
     * @returns {Object} the first argument if not null and not undefined, otherwise the second argument.
     */
    function coalesce(a, b) {
        return isValue(a) ? a : b;
    }

    /**
     * @returns {Number} returns remainder of floored division, i.e., floor(a / n). Useful for consistent modulo
     *          of negative numbers. See http://en.wikipedia.org/wiki/Modulo_operation.
     */
    function floorMod(a, n) {
        var f = a - n * Math.floor(a / n);
        // HACK: when a is extremely close to an n transition, f can be equal to n. This is bad because f must be
        //       within range [0, n). Check for this corner case. Example: a:=-1e-16, n:=10. What is the proper fix?
        return f === n ? 0 : f;
    }

    /**
     * @returns {Number} distance between two points having the form [x, y].
     */
    function distance(a, b) {
        var Δx = b[0] - a[0];
        var Δy = b[1] - a[1];
        return Math.sqrt(Δx * Δx + Δy * Δy);
    }

    /**
     * @returns {Number} the value x clamped to the range [low, high].
     */
    function clamp(x, low, high) {
        return Math.max(low, Math.min(x, high));
    }

    /**
     * @returns {number} the fraction of the bounds [low, high] covered by the value x, after clamping x to the
     *          bounds. For example, given bounds=[10, 20], this method returns 1 for x>=20, 0.5 for x=15 and 0
     *          for x<=10.
     */
    function proportion(x, low, high) {
        return (µ.clamp(x, low, high) - low) / (high - low);
    }

    /**
     * @returns {number} the value p within the range [0, 1], scaled to the range [low, high].
     */
    function spread(p, low, high) {
        return p * (high - low) + low;
    }

    /**
     * Pad number with leading zeros. Does not support fractional or negative numbers.
     */
    function zeroPad(n, width) {
        var s = n.toString();
        var i = Math.max(width - s.length, 0);
        return new Array(i + 1).join("0") + s;
    }

    /**
     * @returns {String} the specified string with the first letter capitalized.
     */
    function capitalize(s) {
        return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.substr(1);
    }

    /**
     * @returns {Boolean} true if agent is probably firefox. Don't really care if this is accurate.
     */
    function isFF() {
        return (/firefox/i).test(navigator.userAgent);
    }

    /**
     * @returns {Boolean} true if agent is probably a mobile device. Don't really care if this is accurate.
     */
    function isMobile() {
        return (/android|blackberry|iemobile|ipad|iphone|ipod|opera mini|webos/i).test(navigator.userAgent);
    }

    function isEmbeddedInIFrame() {
        return window != window.top;
    }

    function toUTCISO(date) {
        return date.getUTCFullYear() + "-" +
            zeroPad(date.getUTCMonth() + 1, 2) + "-" +
            zeroPad(date.getUTCDate(), 2) + " " +
            zeroPad(date.getUTCHours(), 2) + ":00";
    }

    function toLocalISO(date) {
        return date.getFullYear() + "-" +
            zeroPad(date.getMonth() + 1, 2) + "-" +
            zeroPad(date.getDate(), 2) + " " +
            zeroPad(date.getHours(), 2) + ":00";
    }

    /**
     * @returns {String} the string yyyyfmmfdd as yyyytmmtdd, where f and t are the "from" and "to" delimiters. Either
     *          delimiter may be the empty string.
     */
    function ymdRedelimit(ymd, fromDelimiter, toDelimiter) {
        if (!fromDelimiter) {
            return ymd.substr(0, 4) + toDelimiter + ymd.substr(4, 2) + toDelimiter + ymd.substr(6, 2);
        }
        var parts = ymd.substr(0, 10).split(fromDelimiter);
        return [parts[0], parts[1], parts[2]].join(toDelimiter);
    }

    /**
     * @returns {String} the UTC year, month, and day of the specified date in yyyyfmmfdd format, where f is the
     *          delimiter (and may be the empty string).
     */
    function dateToUTCymd(date, delimiter) {
        return ymdRedelimit(date.toISOString(), "-", delimiter || "");
    }

    function dateToConfig(date) {
        return {date: µ.dateToUTCymd(date, "/"), hour: µ.zeroPad(date.getUTCHours(), 2) + "00"};
    }

    /**
     * @returns {Object} an object to perform logging, if/when the browser supports it.
     */
    function log() {
        function format(o) { return o && o.stack ? o + "\n" + o.stack : o; }
        return {
            debug:   function(s) { if (console && console.log) console.log(format(s)); },
            info:    function(s) { if (console && console.info) console.info(format(s)); },
            error:   function(e) { if (console && console.error) console.error(format(e)); },
            time:    function(s) { if (console && console.time) console.time(format(s)); },
            timeEnd: function(s) { if (console && console.timeEnd) console.timeEnd(format(s)); }
        };
    }

    /**
     * @returns {width: (Number), height: (Number)} an object that describes the size of the browser's current view.
     */
    function view() {
        var w = window;
        var d = document && document.documentElement;
        var b = document && document.getElementsByTagName("body")[0];
        var x = w.innerWidth || d.clientWidth || b.clientWidth;
        var y = w.innerHeight || d.clientHeight || b.clientHeight;
        return {width: x, height: y};
    }

    /**
     * Removes all children of the specified DOM element.
     */
    function removeChildren(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    /**
     * @returns {Object} clears and returns the specified Canvas element's 2d context.
     */
    function clearCanvas(canvas) {
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        return canvas;
    }

    function colorInterpolator(start, end) {
        var r = start[0], g = start[1], b = start[2];
        var Δr = end[0] - r, Δg = end[1] - g, Δb = end[2] - b;
        return function(i, a) {
            return [Math.floor(r + i * Δr), Math.floor(g + i * Δg), Math.floor(b + i * Δb), a];
        };
    }

    /**
     * Produces a color style in a rainbow-like trefoil color space. Not quite HSV, but produces a nice
     * spectrum. See http://krazydad.com/tutorials/makecolors.php.
     *
     * @param hue the hue rotation in the range [0, 1]
     * @param a the alpha value in the range [0, 255]
     * @returns {Array} [r, g, b, a]
     */
    function sinebowColor(hue, a) {
        // Map hue [0, 1] to radians [0, 5/6τ]. Don't allow a full rotation because that keeps hue == 0 and
        // hue == 1 from mapping to the same color.
        var rad = hue * τ * 5/6;
        rad *= 0.75;  // increase frequency to 2/3 cycle per rad

        var s = Math.sin(rad);
        var c = Math.cos(rad);
        var r = Math.floor(Math.max(0, -c) * 255);
        var g = Math.floor(Math.max(s, 0) * 255);
        var b = Math.floor(Math.max(c, 0, -s) * 255);
        return [r, g, b, a];
    }

    var BOUNDARY = 0.45;
    var fadeToWhite = colorInterpolator(sinebowColor(1.0, 0), [255, 255, 255]);

    /**
     * Interpolates a sinebow color where 0 <= i <= j, then fades to white where j < i <= 1.
     *
     * @param i number in the range [0, 1]
     * @param a alpha value in range [0, 255]
     * @returns {Array} [r, g, b, a]
     */
    function extendedSinebowColor(i, a) {
        return i <= BOUNDARY ?
            sinebowColor(i / BOUNDARY, a) :
            fadeToWhite((i - BOUNDARY) / (1 - BOUNDARY), a);
    }

    function asColorStyle(r, g, b, a) {
        return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
    }

    /**
     * @returns {Array} of wind colors and a method, indexFor, that maps wind magnitude to an index on the color scale.
     */
    function windIntensityColorScale(step, maxWind) {
        var result = [];
        for (var j = 85; j <= 255; j += step) {
            result.push(asColorStyle(j, j, j, 1.0));
        }
        result.indexFor = function(m) {  // map wind speed to a style
            return Math.floor(Math.min(m, maxWind) / maxWind * (result.length - 1));
        };
        return result;
    }

    /**
     * Creates a color scale composed of the specified segments. Segments is an array of two-element arrays of the
     * form [value, color], where value is the point along the scale and color is the [r, g, b] color at that point.
     * For example, the following creates a scale that smoothly transitions from red to green to blue along the
     * points 0.5, 1.0, and 3.5:
     *
     *     [ [ 0.5, [255, 0, 0] ],
     *       [ 1.0, [0, 255, 0] ],
     *       [ 3.5, [0, 0, 255] ] ]
     *
     * @param segments array of color segments
     * @returns {Function} a function(point, alpha) that returns the color [r, g, b, alpha] for the given point.
     */
    function segmentedColorScale(segments) {
        var points = [], interpolators = [], ranges = [];
        for (var i = 0; i < segments.length - 1; i++) {
            points.push(segments[i+1][0]);
            interpolators.push(colorInterpolator(segments[i][1], segments[i+1][1]));
            ranges.push([segments[i][0], segments[i+1][0]]);
        }

        return function(point, alpha) {
            var i;
            for (i = 0; i < points.length - 1; i++) {
                if (point <= points[i]) {
                    break;
                }
            }
            var range = ranges[i];
            return interpolators[i](µ.proportion(point, range[0], range[1]), alpha);
        };
    }

    /**
     * Returns a human readable string for the provided coordinates.
     */
    function formatCoordinates(λ, φ) {
        return Math.abs(φ).toFixed(2) + "° " + (φ >= 0 ? "N" : "S") + ", " +
            Math.abs(λ).toFixed(2) + "° " + (λ >= 0 ? "E" : "W");
    }

    /**
     * Returns a human readable string for the provided scalar in the given units.
     */
    function formatScalar(value, units) {
        return units.conversion(value).toFixed(units.precision);
    }

    /**
     * Returns a human readable string for the provided rectangular wind vector in the given units.
     * See http://mst.nerc.ac.uk/wind_vect_convs.html.
     */
    function formatVector(wind, units) {
        var d = Math.atan2(-wind[0], -wind[1]) / τ * 360;  // calculate into-the-wind cardinal degrees
        var wd = Math.round((d + 360) % 360 / 5) * 5;  // shift [-180, 180] to [0, 360], and round to nearest 5.
        return wd.toFixed(0) + "° @ " + formatScalar(wind[2], units);
    }

    /**
     * Returns a promise for a JSON resource (URL) fetched via XHR. If the load fails, the promise rejects with an
     * object describing the reason: {status: http-status-code, message: http-status-text, resource:}.
     */
    function loadJson(resource) {
        var d = when.defer();
        d3.json(resource, function(error, result) {
            return error ?
                !error.status ?
                    d.reject({status: -1, message: "Cannot load resource: " + resource, resource: resource}) :
                    d.reject({status: error.status, message: error.statusText, resource: resource}) :
                d.resolve(result);
        });
        return d.promise;
    }

    /**
     * Returns the distortion introduced by the specified projection at the given point.
     *
     * This method uses finite difference estimates to calculate warping by adding a very small amount (h) to
     * both the longitude and latitude to create two lines. These lines are then projected to pixel space, where
     * they become diagonals of triangles that represent how much the projection warps longitude and latitude at
     * that location.
     *
     * <pre>
     *        (λ, φ+h)                  (xλ, yλ)
     *           .                         .
     *           |               ==>        \
     *           |                           \   __. (xφ, yφ)
     *    (λ, φ) .____. (λ+h, φ)       (x, y) .--
     * </pre>
     *
     * See:
     *     Map Projections: A Working Manual, Snyder, John P: pubs.er.usgs.gov/publication/pp1395
     *     gis.stackexchange.com/questions/5068/how-to-create-an-accurate-tissot-indicatrix
     *     www.jasondavies.com/maps/tissot
     *
     * @returns {Array} array of scaled derivatives [dx/dλ, dy/dλ, dx/dφ, dy/dφ]
     */
    function distortion(projection, λ, φ, x, y) {
        var hλ = λ < 0 ? H : -H;
        var hφ = φ < 0 ? H : -H;
        var pλ = projection([λ + hλ, φ]);
        var pφ = projection([λ, φ + hφ]);

        // Meridian scale factor (see Snyder, equation 4-3), where R = 1. This handles issue where length of 1° λ
        // changes depending on φ. Without this, there is a pinching effect at the poles.
        var k = Math.cos(φ / 360 * τ);

        return [
            (pλ[0] - x) / hλ / k,
            (pλ[1] - y) / hλ / k,
            (pφ[0] - x) / hφ,
            (pφ[1] - y) / hφ
        ];
    }

    /**
     * Returns a new agent. An agent executes tasks and stores the result of the most recently completed task.
     *
     * A task is a value or promise, or a function that returns a value or promise. After submitting a task to
     * an agent using the submit() method, the task is evaluated and its result becomes the agent's value,
     * replacing the previous value. If a task is submitted to an agent while an earlier task is still in
     * progress, the earlier task is cancelled and its result ignored. Evaluation of a task may even be skipped
     * entirely if cancellation occurs early enough.
     *
     * Agents are Backbone.js Event emitters. When a submitted task is accepted for invocation by an agent, a
     * "submit" event is emitted. This event has the agent as its sole argument. When a task finishes and
     * the agent's value changes, an "update" event is emitted, providing (value, agent) as arguments. If a task
     * fails by either throwing an exception or rejecting a promise, a "reject" event having arguments (err, agent)
     * is emitted. If an event handler throws an error, an "error" event having arguments (err, agent) is emitted.
     *
     * The current task can be cancelled by invoking the agent.cancel() method, and the cancel status is available
     * as the Boolean agent.cancel.requested key. Within the task callback, the "this" context is set to the agent,
     * so a task can know to abort execution by checking the this.cancel.requested key. Similarly, a task can cancel
     * itself by invoking this.cancel().
     *
     * Example pseudocode:
     * <pre>
     *     var agent = newAgent();
     *     agent.on("update", function(value) {
     *         console.log("task completed: " + value);  // same as agent.value()
     *     });
     *
     *     function someLongAsynchronousProcess(x) {  // x === "abc"
     *         var d = when.defer();
     *         // some long process that eventually calls: d.resolve(result)
     *         return d.promise;
     *     }
     *
     *     agent.submit(someLongAsynchronousProcess, "abc");
     * </pre>
     *
     * @param [initial] initial value of the agent, if any
     * @returns {Object}
     */
    function newAgent(initial) {

        /**
         * @returns {Function} a cancel function for a task.
         */
        function cancelFactory() {
            return function cancel() {
                cancel.requested = true;
                return agent;
            };
        }

        /**
         * Invokes the specified task.
         * @param cancel the task's cancel function.
         * @param taskAndArguments the [task-function-or-value, arg0, arg1, ...] array.
         */
        function runTask(cancel, taskAndArguments) {

            function run(args) {
                return cancel.requested ? null : _.isFunction(task) ? task.apply(agent, args) : task;
            }

            function accept(result) {
                if (!cancel.requested) {
                    value = result;
                    agent.trigger("update", result, agent);
                }
            }

            function reject(err) {
                if (!cancel.requested) {  // ANNOYANCE: when cancelled, this task's error is silently suppressed
                    agent.trigger("reject", err, agent);
                }
            }

            function fail(err) {
                agent.trigger("fail", err, agent);
            }

            try {
                // When all arguments are resolved, invoke the task then either accept or reject the result.
                var task = taskAndArguments[0];
                when.all(_.rest(taskAndArguments)).then(run).then(accept, reject).done(undefined, fail);
                agent.trigger("submit", agent);
            } catch (err) {
                fail(err);
            }
        }

        var value = initial;
        var runTask_debounced = _.debounce(runTask, 0);  // ignore multiple simultaneous submissions--reduces noise
        var agent = {

            /**
             * @returns {Object} this agent's current value.
             */
            value: function() {
                return value;
            },

            /**
             * Cancels this agent's most recently submitted task.
             */
            cancel: cancelFactory(),

            /**
             * Submit a new task and arguments to invoke the task with. The task may return a promise for
             * asynchronous tasks, and all arguments may be either values or promises. The previously submitted
             * task, if any, is immediately cancelled.
             * @returns this agent.
             */
            submit: function(task, arg0, arg1, and_so_on) {
                // immediately cancel the previous task
                this.cancel();
                // schedule the new task and update the agent with its associated cancel function
                runTask_debounced(this.cancel = cancelFactory(), arguments);
                return this;
            }
        };

        return _.extend(agent, Backbone.Events);
    }

    /**
     * Parses a URL hash fragment:
     *
     * example: "2013/11/14/0900Z/wind/isobaric/1000hPa/orthographic=26.50,-153.00,1430/overlay=off"
     * output: {date: "2013/11/14", hour: "0900", param: "wind", surface: "isobaric", level: "1000hPa",
     *          projection: "orthographic", orientation: "26.50,-153.00,1430", overlayType: "off"}
     *
     * grammar:
     *     hash   := ( "current" | yyyy / mm / dd / hhhh "Z" ) / param / surface / level [ / option [ / option ... ] ]
     *     option := type [ "=" number [ "," number [ ... ] ] ]
     *
     * @param hash the hash fragment.
     * @param projectionNames the set of allowed projections.
     * @param overlayTypes the set of allowed overlays.
     * @returns {Object} the result of the parse.
     */
    function parse(hash, projectionNames, overlayTypes) {
        var option, result = {};
        //             1        2        3          4          5            6      7      8    9
        var tokens = /^(current|(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{3,4})Z)\/(\w+)\/(\w+)\/(\w+)([\/].+)?/.exec(hash);
        if (tokens) {
            var date = tokens[1] === "current" ?
                "current" :
                tokens[2] + "/" + zeroPad(tokens[3], 2) + "/" + zeroPad(tokens[4], 2);
            var hour = isValue(tokens[5]) ? zeroPad(tokens[5], 4) : "";
            result = {
                date: date,                  // "current" or "yyyy/mm/dd"
                hour: hour,                  // "hhhh" or ""
                param: tokens[6],            // non-empty alphanumeric _
                surface: tokens[7],          // non-empty alphanumeric _
                level: tokens[8],            // non-empty alphanumeric _
                projection: "orthographic",
                orientation: "",
                topology: TOPOLOGY,
                overlayType: "default",
                showGridPoints: false
            };
            coalesce(tokens[9], "").split("/").forEach(function(segment) {
                if ((option = /^(\w+)(=([\d\-.,]*))?$/.exec(segment))) {
                    if (projectionNames.has(option[1])) {
                        result.projection = option[1];                 // non-empty alphanumeric _
                        result.orientation = coalesce(option[3], "");  // comma delimited string of numbers, or ""
                    }
                }
                else if ((option = /^overlay=(\w+)$/.exec(segment))) {
                    if (overlayTypes.has(option[1]) || option[1] === "default") {
                        result.overlayType = option[1];
                    }
                }
                else if ((option = /^grid=(\w+)$/.exec(segment))) {
                    if (option[1] === "on") {
                        result.showGridPoints = true;
                    }
                }
            });
        }
        return result;
    }

    /**
     * A Backbone.js Model that persists its attributes as a human readable URL hash fragment. Loading from and
     * storing to the hash fragment is handled by the sync method.
     */
    var Configuration = Backbone.Model.extend({
        id: 0,
        _ignoreNextHashChangeEvent: false,
        _projectionNames: null,
        _overlayTypes: null,

        /**
         * @returns {String} this configuration converted to a hash fragment.
         */
        toHash: function() {
            var attr = this.attributes;
            var dir = attr.date === "current" ? "current" : attr.date + "/" + attr.hour + "Z";
            var proj = [attr.projection, attr.orientation].filter(isTruthy).join("=");
            var ol = !isValue(attr.overlayType) || attr.overlayType === "default" ? "" : "overlay=" + attr.overlayType;
            var grid = attr.showGridPoints ? "grid=on" : "";
            return [dir, attr.param, attr.surface, attr.level, ol, proj, grid].filter(isTruthy).join("/");
        },

        /**
         * Synchronizes between the configuration model and the hash fragment in the URL bar. Invocations
         * caused by "hashchange" events must have the {trigger: "hashchange"} option specified.
         */
        sync: function(method, model, options) {
            switch (method) {
                case "read":
                    if (options.trigger === "hashchange" && model._ignoreNextHashChangeEvent) {
                        model._ignoreNextHashChangeEvent = false;
                        return;
                    }
                    model.set(parse(
                        window.location.hash.substr(1) || DEFAULT_CONFIG,
                        model._projectionNames,
                        model._overlayTypes));
                    break;
                case "update":
                    // Ugh. Setting the hash fires a hashchange event during the next event loop turn. Ignore it.
                    model._ignoreNextHashChangeEvent = true;
                    window.location.hash = model.toHash();
                    break;
            }
        }
    });

    /**
     * A Backbone.js Model to hold the page's configuration as a set of attributes: date, layer, projection,
     * orientation, etc. Changes to the configuration fire events which the page's components react to. For
     * example, configuration.save({projection: "orthographic"}) fires an event which causes the globe to be
     * re-rendered with an orthographic projection.
     *
     * All configuration attributes are persisted in a human readable form to the page's hash fragment (and
     * vice versa). This allows deep linking and back-button navigation.
     *
     * @returns {Configuration} Model to represent the hash fragment, using the specified set of allowed projections.
     */
    function buildConfiguration(projectionNames, overlayTypes) {
        var result = new Configuration();
        result._projectionNames = projectionNames;
        result._overlayTypes = overlayTypes;
        return result;
    }

    return {
        isTruthy: isTruthy,
        isValue: isValue,
        coalesce: coalesce,
        floorMod: floorMod,
        distance: distance,
        clamp: clamp,
        proportion: proportion,
        spread: spread,
        zeroPad: zeroPad,
        capitalize: capitalize,
        isFF: isFF,
        isMobile: isMobile,
        isEmbeddedInIFrame: isEmbeddedInIFrame,
        toUTCISO: toUTCISO,
        toLocalISO: toLocalISO,
        ymdRedelimit: ymdRedelimit,
        dateToUTCymd: dateToUTCymd,
        dateToConfig: dateToConfig,
        log: log,
        view: view,
        removeChildren: removeChildren,
        clearCanvas: clearCanvas,
        sinebowColor: sinebowColor,
        extendedSinebowColor: extendedSinebowColor,
        windIntensityColorScale: windIntensityColorScale,
        segmentedColorScale: segmentedColorScale,
        formatCoordinates: formatCoordinates,
        formatScalar: formatScalar,
        formatVector: formatVector,
        loadJson: loadJson,
        distortion: distortion,
        newAgent: newAgent,
        parse: parse,
        buildConfiguration: buildConfiguration
    };

};

},{}],4:[function(require,module,exports){
/**
 * products - defines the behavior of weather data grids, including grid construction, interpolation, and color scales.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
module.exports = function() {
    "use strict";
    var µ = require('./micro.js')();
    console.log('inside products');
    console.log(µ);
    var WEATHER_PATH = "/data/weather";
    var OSCAR_PATH = "/data/oscar";
    var catalogs = {
        // The OSCAR catalog is an array of file names, sorted and prefixed with yyyyMMdd. Last item is the
        // most recent. For example: [ 20140101-abc.json, 20140106-abc.json, 20140112-abc.json, ... ]
        oscar: µ.loadJson([OSCAR_PATH, "catalog.json"].join("/"))
    };

    function buildProduct(overrides) {
        return _.extend({
            description: "",
            paths: [],
            date: null,
            navigate: function(step) {
                return gfsStep(this.date, step);
            },
            load: function(cancel) {
                var me = this;
                return when.map(this.paths, µ.loadJson).then(function(files) {
                    return cancel.requested ? null : _.extend(me, buildGrid(me.builder.apply(me, files)));
                });
            }
        }, overrides);
    }

    /**
     * @param attr
     * @param {String} type
     * @param {String?} surface
     * @param {String?} level
     * @returns {String}
     */
    function gfs1p0degPath(attr, type, surface, level) {
        var dir = attr.date, stamp = dir === "current" ? "current" : attr.hour;
        var file = [stamp, type, surface, level, "gfs", "1.0"].filter(µ.isValue).join("-") + ".json";
        return [WEATHER_PATH, dir, file].join("/");
    }

    function gfsDate(attr) {
        if (attr.date === "current") {
            // Construct the date from the current time, rounding down to the nearest three-hour block.
            var now = new Date(Date.now()), hour = Math.floor(now.getUTCHours() / 3);
            return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
        }
        var parts = attr.date.split("/");
        return new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], +attr.hour.substr(0, 2)));
    }

    /**
     * Returns a date for the chronologically next or previous GFS data layer. How far forward or backward in time
     * to jump is determined by the step. Steps of ±1 move in 3-hour jumps, and steps of ±10 move in 24-hour jumps.
     */
    function gfsStep(date, step) {
        var offset = (step > 1 ? 8 : step < -1 ? -8 : step) * 3, adjusted = new Date(date);
        adjusted.setHours(adjusted.getHours() + offset);
        return adjusted;
    }

    function netcdfHeader(time, lat, lon, center) {
        return {
            lo1: lon.sequence.start,
            la1: lat.sequence.start,
            dx: lon.sequence.delta,
            dy: -lat.sequence.delta,
            nx: lon.sequence.size,
            ny: lat.sequence.size,
            refTime: time.data[0],
            forecastTime: 0,
            centerName: center
        };
    }

    function describeSurface(attr) {
        return attr.surface === "surface" ? "Surface" : µ.capitalize(attr.level);
    }

    function describeSurfaceJa(attr) {
        return attr.surface === "surface" ? "地上" : µ.capitalize(attr.level);
    }

    /**
     * Returns a function f(langCode) that, given table:
     *     {foo: {en: "A", ja: "あ"}, bar: {en: "I", ja: "い"}}
     * will return the following when called with "en":
     *     {foo: "A", bar: "I"}
     * or when called with "ja":
     *     {foo: "あ", bar: "い"}
     */
    function localize(table) {
        return function(langCode) {
            var result = {};
            _.each(table, function(value, key) {
                result[key] = value[langCode] || value.en || value;
            });
            return result;
        }
    }

    var FACTORIES = {

        "wind": {
            matches: _.matches({param: "wind"}),
            create: function(attr) {
                return buildProduct({
                    field: "vector",
                    type: "wind",
                    description: localize({
                        name: {en: "Wind", ja: "風速"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "wind", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var uData = file[0].data, vData = file[1].data;
                        return {
                            header: file[0].header,
                            interpolate: bilinearInterpolateVector,
                            data: function(i) {
                                return [uData[i], vData[i]];
                            }
                        }
                    },
                    units: [
                        {label: "km/h", conversion: function(x) { return x * 3.6; },      precision: 0},
                        {label: "m/s",  conversion: function(x) { return x; },            precision: 1},
                        {label: "kn",   conversion: function(x) { return x * 1.943844; }, precision: 0},
                        {label: "mph",  conversion: function(x) { return x * 2.236936; }, precision: 0}
                    ],
                    scale: {
                        bounds: [0, 100],
                        gradient: function(v, a) {
                            return µ.extendedSinebowColor(Math.min(v, 100) / 100, a);
                        }
                    },
                    particles: {velocityScale: 1/60000, maxIntensity: 17}
                });
            }
        },

        "temp": {
            matches: _.matches({param: "wind", overlayType: "temp"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "temp",
                    description: localize({
                        name: {en: "Temp", ja: "気温"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "temp", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "°C", conversion: function(x) { return x - 273.15; },       precision: 1},
                        {label: "°F", conversion: function(x) { return x * 9/5 - 459.67; }, precision: 1},
                        {label: "K",  conversion: function(x) { return x; },                precision: 1}
                    ],
                    scale: {
                        bounds: [193, 328],
                        gradient: µ.segmentedColorScale([
                            [193,     [37, 4, 42]],
                            [206,     [41, 10, 130]],
                            [219,     [81, 40, 40]],
                            [233.15,  [192, 37, 149]],  // -40 C/F
                            [255.372, [70, 215, 215]],  // 0 F
                            [273.15,  [21, 84, 187]],   // 0 C
                            [275.15,  [24, 132, 14]],   // just above 0 C
                            [291,     [247, 251, 59]],
                            [298,     [235, 167, 21]],
                            [311,     [230, 71, 39]],
                            [328,     [88, 27, 67]]
                        ])
                    }
                });
            }
        },

        "relative_humidity": {
            matches: _.matches({param: "wind", overlayType: "relative_humidity"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "relative_humidity",
                    description: localize({
                        name: {en: "Relative Humidity", ja: "相対湿度"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "relative_humidity", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var vars = file.variables;
                        var rh = vars.Relative_humidity_isobaric || vars.Relative_humidity_height_above_ground;
                        var data = rh.data;
                        return {
                            header: netcdfHeader(vars.time, vars.lat, vars.lon, file.Originating_or_generating_Center),
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        };
                    },
                    units: [
                        {label: "%", conversion: function(x) { return x; }, precision: 0}
                    ],
                    scale: {
                        bounds: [0, 100],
                        gradient: function(v, a) {
                            return µ.sinebowColor(Math.min(v, 100) / 100, a);
                        }
                    }
                });
            }
        },

        "air_density": {
            matches: _.matches({param: "wind", overlayType: "air_density"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "air_density",
                    description: localize({
                        name: {en: "Air Density", ja: "空気密度"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [gfs1p0degPath(attr, "air_density", attr.surface, attr.level)],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var vars = file.variables;
                        var air_density = vars.air_density, data = air_density.data;
                        return {
                            header: netcdfHeader(vars.time, vars.lat, vars.lon, file.Originating_or_generating_Center),
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        };
                    },
                    units: [
                        {label: "kg/m³", conversion: function(x) { return x; }, precision: 2}
                    ],
                    scale: {
                        bounds: [0, 1.5],
                        gradient: function(v, a) {
                            return µ.sinebowColor(Math.min(v, 1.5) / 1.5, a);
                        }
                    }
                });
            }
        },

        "wind_power_density": {
            matches: _.matches({param: "wind", overlayType: "wind_power_density"}),
            create: function(attr) {
                var windProduct = FACTORIES.wind.create(attr);
                var airdensProduct = FACTORIES.air_density.create(attr);
                return buildProduct({
                    field: "scalar",
                    type: "wind_power_density",
                    description: localize({
                        name: {en: "Wind Power Density", ja: "風力エネルギー密度"},
                        qualifier: {en: " @ " + describeSurface(attr), ja: " @ " + describeSurfaceJa(attr)}
                    }),
                    paths: [windProduct.paths[0], airdensProduct.paths[0]],
                    date: gfsDate(attr),
                    builder: function(windFile, airdensFile) {
                        var windBuilder = windProduct.builder(windFile);
                        var airdensBuilder = airdensProduct.builder(airdensFile);
                        var windData = windBuilder.data, windInterpolate = windBuilder.interpolate;
                        var airdensData = airdensBuilder.data, airdensInterpolate = airdensBuilder.interpolate;
                        return {
                            header: _.clone(airdensBuilder.header),
                            interpolate: function(x, y, g00, g10, g01, g11) {
                                var m = windInterpolate(x, y, g00[0], g10[0], g01[0], g11[0])[2];
                                var ρ = airdensInterpolate(x, y, g00[1], g10[1], g01[1], g11[1]);
                                return 0.5 * ρ * m * m * m;
                            },
                            data: function(i) {
                                return [windData(i), airdensData(i)];
                            }
                        };
                    },
                    units: [
                        {label: "kW/m²", conversion: function(x) { return x / 1000; }, precision: 1},
                        {label: "W/m²", conversion: function(x) { return x; }, precision: 0}
                    ],
                    scale: {
                        bounds: [0, 80000],
                        gradient: µ.segmentedColorScale([
                            [0, [15, 4, 96]],
                            [250, [30, 8, 180]],
                            [1000, [121, 102, 2]],
                            [2000, [118, 161, 66]],
                            [4000, [50, 102, 219]],
                            [8000, [19, 131, 193]],
                            [16000, [59, 204, 227]],
                            [64000, [241, 1, 45]],
                            [80000, [243, 0, 241]]
                        ])
                    }
                });
            }
        },

        "total_cloud_water": {
            matches: _.matches({param: "wind", overlayType: "total_cloud_water"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "total_cloud_water",
                    description: localize({
                        name: {en: "Total Cloud Water", ja: "雲水量"},
                        qualifier: ""
                    }),
                    paths: [gfs1p0degPath(attr, "total_cloud_water")],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "kg/m²", conversion: function(x) { return x; }, precision: 3}
                    ],
                    scale: {
                        bounds: [0, 1],
                        gradient: µ.segmentedColorScale([
                            [0.0, [5, 5, 89]],
                            [0.2, [170, 170, 230]],
                            [1.0, [255, 255, 255]]
                        ])
                    }
                });
            }
        },

        "total_precipitable_water": {
            matches: _.matches({param: "wind", overlayType: "total_precipitable_water"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "total_precipitable_water",
                    description: localize({
                        name: {en: "Total Precipitable Water", ja: "可降水量"},
                        qualifier: ""
                    }),
                    paths: [gfs1p0degPath(attr, "total_precipitable_water")],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "kg/m²", conversion: function(x) { return x; }, precision: 3}
                    ],
                    scale: {
                        bounds: [0, 70],
                        gradient:
                            µ.segmentedColorScale([
                                [0, [230, 165, 30]],
                                [10, [120, 100, 95]],
                                [20, [40, 44, 92]],
                                [30, [21, 13, 193]],
                                [40, [75, 63, 235]],
                                [60, [25, 255, 255]],
                                [70, [150, 255, 255]]
                            ])
                    }
                });
            }
        },

        "mean_sea_level_pressure": {
            matches: _.matches({param: "wind", overlayType: "mean_sea_level_pressure"}),
            create: function(attr) {
                return buildProduct({
                    field: "scalar",
                    type: "mean_sea_level_pressure",
                    description: localize({
                        name: {en: "Mean Sea Level Pressure", ja: "海面更正気圧"},
                        qualifier: ""
                    }),
                    paths: [gfs1p0degPath(attr, "mean_sea_level_pressure")],
                    date: gfsDate(attr),
                    builder: function(file) {
                        var record = file[0], data = record.data;
                        return {
                            header: record.header,
                            interpolate: bilinearInterpolateScalar,
                            data: function(i) {
                                return data[i];
                            }
                        }
                    },
                    units: [
                        {label: "hPa", conversion: function(x) { return x / 100; }, precision: 0},
                        {label: "mmHg", conversion: function(x) { return x / 133.322387415; }, precision: 0},
                        {label: "inHg", conversion: function(x) { return x / 3386.389; }, precision: 1}
                    ],
                    scale: {
                        bounds: [92000, 105000],
                        gradient: µ.segmentedColorScale([
                            [92000, [40, 0, 0]],
                            [95000, [187, 60, 31]],
                            [96500, [137, 32, 30]],
                            [98000, [16, 1, 43]],
                            [100500, [36, 1, 93]],
                            [101300, [241, 254, 18]],
                            [103000, [228, 246, 223]],
                            [105000, [255, 255, 255]]
                        ])
                    }
                });
            }
        },

        "currents": {
            matches: _.matches({param: "ocean", surface: "surface", level: "currents"}),
            create: function(attr) {
                return when(catalogs.oscar).then(function(catalog) {
                    return buildProduct({
                        field: "vector",
                        type: "currents",
                        description: localize({
                            name: {en: "Ocean Currents", ja: "海流"},
                            qualifier: {en: " @ Surface", ja: " @ 地上"}
                        }),
                        paths: [oscar0p33Path(catalog, attr)],
                        date: oscarDate(catalog, attr),
                        navigate: function(step) {
                            return oscarStep(catalog, this.date, step);
                        },
                        builder: function(file) {
                            var uData = file[0].data, vData = file[1].data;
                            return {
                                header: file[0].header,
                                interpolate: bilinearInterpolateVector,
                                data: function(i) {
                                    var u = uData[i], v = vData[i];
                                    return µ.isValue(u) && µ.isValue(v) ? [u, v] : null;
                                }
                            }
                        },
                        units: [
                            {label: "m/s",  conversion: function(x) { return x; },            precision: 2},
                            {label: "km/h", conversion: function(x) { return x * 3.6; },      precision: 1},
                            {label: "kn",   conversion: function(x) { return x * 1.943844; }, precision: 1},
                            {label: "mph",  conversion: function(x) { return x * 2.236936; }, precision: 1}
                        ],
                        scale: {
                            bounds: [0, 1.5],
                            gradient: µ.segmentedColorScale([
                                [0, [10, 25, 68]],
                                [0.15, [10, 25, 250]],
                                [0.4, [24, 255, 93]],
                                [0.65, [255, 233, 102]],
                                [1.0, [255, 233, 15]],
                                [1.5, [255, 15, 15]]
                            ])
                        },
                        particles: {velocityScale: 1/4400, maxIntensity: 0.7}
                    });
                });
            }
        },

        "off": {
            matches: _.matches({overlayType: "off"}),
            create: function() {
                return null;
            }
        }
    };

    /**
     * Returns the file name for the most recent OSCAR data layer to the specified date. If offset is non-zero,
     * the file name that many entries from the most recent is returned.
     *
     * The result is undefined if there is no entry for the specified date and offset can be found.
     *
     * UNDONE: the catalog object itself should encapsulate this logic. GFS can also be a "virtual" catalog, and
     *         provide a mechanism for eliminating the need for /data/weather/current/* files.
     *
     * @param {Array} catalog array of file names, sorted and prefixed with yyyyMMdd. Last item is most recent.
     * @param {String} date string with format yyyy/MM/dd or "current"
     * @param {Number?} offset
     * @returns {String} file name
     */
    function lookupOscar(catalog, date, offset) {
        offset = +offset || 0;
        if (date === "current") {
            return catalog[catalog.length - 1 + offset];
        }
        var prefix = µ.ymdRedelimit(date, "/", ""), i = _.sortedIndex(catalog, prefix);
        i = (catalog[i] || "").indexOf(prefix) === 0 ? i : i - 1;
        return catalog[i + offset];
    }

    function oscar0p33Path(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        return file ? [OSCAR_PATH, file].join("/") : null;
    }

    function oscarDate(catalog, attr) {
        var file = lookupOscar(catalog, attr.date);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    /**
     * @returns {Date} the chronologically next or previous OSCAR data layer. How far forward or backward in
     * time to jump is determined by the step and the catalog of available layers. A step of ±1 moves to the
     * next/previous entry in the catalog (about 5 days), and a step of ±10 moves to the entry six positions away
     * (about 30 days).
     */
    function oscarStep(catalog, date, step) {
        var file = lookupOscar(catalog, µ.dateToUTCymd(date, "/"), step > 1 ? 6 : step < -1 ? -6 : step);
        var parts = file ? µ.ymdRedelimit(file, "", "/").split("/") : null;
        return parts ? new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], 0)) : null;
    }

    function dataSource(header) {
        // noinspection FallthroughInSwitchStatementJS
        switch (header.center || header.centerName) {
            case -3:
                return "OSCAR / Earth & Space Research";
            case 7:
            case "US National Weather Service, National Centres for Environmental Prediction (NCEP)":
                return "GFS / NCEP / US National Weather Service";
            default:
                return header.centerName;
        }
    }

    function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    }

    function bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        var a = rx * ry,  b = x * ry,  c = rx * y,  d = x * y;
        var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
        var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
        return [u, v, Math.sqrt(u * u + v * v)];
    }

    /**
     * Builds an interpolator for the specified data in the form of JSON-ified GRIB files. Example:
     *
     *     [
     *       {
     *         "header": {
     *           "refTime": "2013-11-30T18:00:00.000Z",
     *           "parameterCategory": 2,
     *           "parameterNumber": 2,
     *           "surface1Type": 100,
     *           "surface1Value": 100000.0,
     *           "forecastTime": 6,
     *           "scanMode": 0,
     *           "nx": 360,
     *           "ny": 181,
     *           "lo1": 0,
     *           "la1": 90,
     *           "lo2": 359,
     *           "la2": -90,
     *           "dx": 1,
     *           "dy": 1
     *         },
     *         "data": [3.42, 3.31, 3.19, 3.08, 2.96, 2.84, 2.72, 2.6, 2.47, ...]
     *       }
     *     ]
     *
     */
    function buildGrid(builder) {
        // var builder = createBuilder(data);

        var header = builder.header;
        var λ0 = header.lo1, φ0 = header.la1;  // the grid's origin (e.g., 0.0E, 90.0N)
        var Δλ = header.dx, Δφ = header.dy;    // distance between grid points (e.g., 2.5 deg lon, 2.5 deg lat)
        var ni = header.nx, nj = header.ny;    // number of grid points W-E and N-S (e.g., 144 x 73)
        var date = new Date(header.refTime);
        date.setHours(date.getHours() + header.forecastTime);

        // Scan mode 0 assumed. Longitude increases from λ0, and latitude decreases from φ0.
        // http://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_table3-4.shtml
        var grid = [], p = 0;
        var isContinuous = Math.floor(ni * Δλ) >= 360;
        for (var j = 0; j < nj; j++) {
            var row = [];
            for (var i = 0; i < ni; i++, p++) {
                row[i] = builder.data(p);
            }
            if (isContinuous) {
                // For wrapped grids, duplicate first column as last column to simplify interpolation logic
                row.push(row[0]);
            }
            grid[j] = row;
        }

        function interpolate(λ, φ) {
            var i = µ.floorMod(λ - λ0, 360) / Δλ;  // calculate longitude index in wrapped range [0, 360)
            var j = (φ0 - φ) / Δφ;                 // calculate latitude index in direction +90 to -90

            //         1      2           After converting λ and φ to fractional grid indexes i and j, we find the
            //        fi  i   ci          four points "G" that enclose point (i, j). These points are at the four
            //         | =1.4 |           corners specified by the floor and ceiling of i and j. For example, given
            //      ---G--|---G--- fj 8   i = 1.4 and j = 8.3, the four surrounding grid points are (1, 8), (2, 8),
            //    j ___|_ .   |           (1, 9) and (2, 9).
            //  =8.3   |      |
            //      ---G------G--- cj 9   Note that for wrapped grids, the first column is duplicated as the last
            //         |      |           column, so the index ci can be used without taking a modulo.

            var fi = Math.floor(i), ci = fi + 1;
            var fj = Math.floor(j), cj = fj + 1;

            var row;
            if ((row = grid[fj])) {
                var g00 = row[fi];
                var g10 = row[ci];
                if (µ.isValue(g00) && µ.isValue(g10) && (row = grid[cj])) {
                    var g01 = row[fi];
                    var g11 = row[ci];
                    if (µ.isValue(g01) && µ.isValue(g11)) {
                        // All four points found, so interpolate the value.
                        return builder.interpolate(i - fi, j - fj, g00, g10, g01, g11);
                    }
                }
            }
            // console.log("cannot interpolate: " + λ + "," + φ + ": " + fi + " " + ci + " " + fj + " " + cj);
            return null;
        }

        return {
            source: dataSource(header),
            date: date,
            interpolate: interpolate,
            forEachPoint: function(cb) {
                for (var j = 0; j < nj; j++) {
                    var row = grid[j] || [];
                    for (var i = 0; i < ni; i++) {
                        cb(µ.floorMod(180 + λ0 + i * Δλ, 360) - 180, φ0 - j * Δφ, row[i]);
                    }
                }
            }
        };
    }

    function productsFor(attributes) {
        var attr = _.clone(attributes), results = [];
        _.values(FACTORIES).forEach(function(factory) {
            if (factory.matches(attr)) {
                results.push(factory.create(attr));
            }
        });
        return results.filter(µ.isValue);
    }

    return {
        overlayTypes: d3.set(_.keys(FACTORIES)),
        productsFor: productsFor
    };

}();

},{"./micro.js":3}]},{},[1]);

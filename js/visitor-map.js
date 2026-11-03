(function () {
  "use strict";

  var container = document.getElementById("visitor-map");
  if (!container) return;

  var siteId = container.getAttribute("data-site-id");
  var map = document.getElementById("visitor-map-canvas");
  var markers = document.getElementById("visitor-map-markers");
  var details = document.getElementById("visitor-map-details");
  var locations = document.getElementById("visitor-map-locations");
  var groups = [];
  var receivedData = false;

  function setStatus(state) {
    container.setAttribute("data-state", state);
  }

  function unavailable() {
    if (!receivedData) {
      setStatus("unavailable");
    }
  }

  setStatus("loading");
  var timeout = window.setTimeout(unavailable, 10000);

  function countryName(countryCode) {
    if (!countryCode) return "";

    try {
      if (window.Intl && Intl.DisplayNames) {
        return new Intl.DisplayNames([document.documentElement.lang || "en"], {
          type: "region"
        }).of(countryCode) || countryCode;
      }
    } catch (error) {
      // Region names are optional; the country code still identifies the location.
    }

    return countryCode;
  }

  function locationName(point) {
    var country = countryName(point.cc);
    return [point.city, country].filter(Boolean).join(", ") || "Approximate location";
  }

  function coordinate(value, limit) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !value.trim()) return null;
    var number = Number(value);
    return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
  }

  function groupVisitors(points) {
    var byLocation = Object.create(null);

    points.forEach(function (point) {
      if (!point || typeof point !== "object") return;
      var lat = coordinate(point.lat, 90);
      var lon = coordinate(point.lon, 180);
      if (lat === null || lon === null) return;

      var cc = typeof point.cc === "string" ? point.cc.trim().toUpperCase() : "";
      if (!/^[A-Z]{2}$/.test(cc) || cc === "ZZ") cc = "";
      var city = typeof point.city === "string" ? point.city.trim() : "";
      if (city.toLowerCase() === "unknown") city = "";
      var key = [lat, lon, cc].join("|");
      if (!byLocation[key]) {
        byLocation[key] = { lat: lat, lon: lon, cc: cc, city: city, count: 0, isNew: false };
      }

      byLocation[key].count += 1;
      byLocation[key].isNew = byLocation[key].isNew || point.age === "new";
      if (!byLocation[key].city && city) byLocation[key].city = city;
    });

    return Object.keys(byLocation).map(function (key) { return byLocation[key]; })
      .sort(function (a, b) { return b.count - a.count || a.lat - b.lat || a.lon - b.lon; });
  }

  function diameter(count) {
    return Math.min(18, 8 + Math.log(count) / Math.LN2 * 2);
  }

  // Merge overlapping circles at the rendered size. The details retain each
  // original location, while each circle stays at its weighted geographic center.
  function clusterVisitors(width, height) {
    var clusters = groups.map(function (point) {
      return {
        x: (point.lon + 180) / 360,
        y: (90 - point.lat) / 180,
        count: point.count,
        isNew: point.isNew,
        labels: [locationName(point) + ": " + point.count]
      };
    });

    for (var i = 0; i < clusters.length; i += 1) {
      for (var j = i + 1; j < clusters.length; j += 1) {
        var a = clusters[i];
        var b = clusters[j];
        var dx = (a.x - b.x) * width;
        var dy = (a.y - b.y) * height;
        var separation = (diameter(a.count) + diameter(b.count)) / 2 + 3;
        if (dx * dx + dy * dy >= separation * separation) continue;

        var count = a.count + b.count;
        a.x = (a.x * a.count + b.x * b.count) / count;
        a.y = (a.y * a.count + b.y * b.count) / count;
        a.count = count;
        a.isNew = a.isNew || b.isNew;
        a.labels = a.labels.concat(b.labels);
        clusters.splice(j, 1);
        // The larger circle may overlap an earlier cluster; check again.
        i = -1;
        break;
      }
    }

    return clusters;
  }

  function renderMarkers() {
    var fragment = document.createDocumentFragment();
    var width = map.clientWidth || 360;
    clusterVisitors(width, width / 2).forEach(function (point) {
      var marker = document.createElement("span");
      var size = diameter(point.count);
      marker.className = "visitor-map-marker" + (point.isNew ? " is-new" : "");
      marker.style.left = point.x * 100 + "%";
      marker.style.top = point.y * 100 + "%";
      marker.style.width = size + "px";
      marker.style.height = size + "px";
      marker.title = point.labels.join("; ");
      fragment.appendChild(marker);
    });
    markers.textContent = "";
    markers.appendChild(fragment);
  }

  function render(onlineCount, responseSiteId, widgetIndex, points) {
    if (responseSiteId !== siteId) return;
    if (!Array.isArray(points)) {
      unavailable();
      return;
    }

    window.clearTimeout(timeout);
    receivedData = true;
    groups = groupVisitors(points);
    var fragment = document.createDocumentFragment();
    groups.forEach(function (point) {
      var item = document.createElement("li");
      var name = document.createElement("span");
      var visits = document.createElement("span");
      name.textContent = locationName(point);
      visits.textContent = point.count;
      item.appendChild(name);
      item.appendChild(visits);
      fragment.appendChild(item);
    });
    locations.textContent = "";
    locations.appendChild(fragment);
    details.hidden = !groups.length;
    renderMarkers();
    setStatus(groups.length ? "ready" : "empty");
  }

  if (window.ResizeObserver) {
    new ResizeObserver(renderMarkers).observe(map);
  } else {
    window.addEventListener("resize", renderMarkers);
  }

  // Keep the official tracker and site history. Register the widget only after
  // installing our renderer: m.js can otherwise request data before a later
  // deferred script runs, causing its stock renderer to win the race.
  window._wau = window._wau || [];
  window._wau_opt = { target: "_blank", fbase: false };
  var provider = document.createElement("script");
  provider.async = true;
  provider.src = "https://waust.at/m.js";
  provider.onerror = unavailable;
  provider.onload = function () {
    if (typeof window.WAU_la !== "function") {
      unavailable();
      return;
    }
    window.WAU_r_m = render;
    window._wau.push(["map", siteId, "mly", "360", "180", "natural", "default-red"]);
    window.WAU_la();
  };
  document.head.appendChild(provider);
}());

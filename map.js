// --- API key ---
const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjY4ZGFmNzAwOTkxZDRkMTU4MjI5MzhmNGQ5MGU1ZGE5IiwiaCI6Im11cm11cjY0In0=";
// ----------------------------------------------------------

let map = L.map('map').setView([14.676, 121.0437], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OSM'
}).addTo(map);

let markers = [], routeLine = null;

// ========== Dynamic UI helpers (pickups & dropoffs) ==========
let pickupCounter = 0;
let dropoffCounter = 0;

function addPickupRow(address = '', weight = '') {
  const container = document.getElementById('pickupsContainer');
  const id = `pickup-${++pickupCounter}`;

  const row = document.createElement('div');
  row.className = 'row';
  row.id = id;

  const addrInput = document.createElement('input');
  addrInput.type = 'text';
  addrInput.placeholder = 'Pickup address';
  addrInput.value = address;
  addrInput.className = 'addr-input';

  const wtInput = document.createElement('input');
  wtInput.type = 'number';
  wtInput.min = '0';
  wtInput.step = '0.1';
  wtInput.placeholder = 'kg';
  wtInput.value = weight;
  wtInput.style.maxWidth = '90px';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'mini-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => { container.removeChild(row); };

  row.appendChild(addrInput);
  row.appendChild(wtInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function addDropoffRow(address = '', weight = '') {
  const container = document.getElementById('dropoffsContainer');
  const id = `dropoff-${++dropoffCounter}`;

  const row = document.createElement('div');
  row.className = 'row';
  row.id = id;

  const addrInput = document.createElement('input');
  addrInput.type = 'text';
  addrInput.placeholder = 'Drop-off address';
  addrInput.value = address;
  addrInput.className = 'addr-input';

  const wtInput = document.createElement('input');
  wtInput.type = 'number';
  wtInput.min = '0';
  wtInput.step = '0.1';
  wtInput.placeholder = 'kg';
  wtInput.value = weight;
  wtInput.style.maxWidth = '90px';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'mini-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => { container.removeChild(row); };

  row.appendChild(addrInput);
  row.appendChild(wtInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function clearAll() {
  const pickups = document.getElementById('pickupsContainer');
  const dropoffs = document.getElementById('dropoffsContainer');
  pickups.innerHTML = '';
  dropoffs.innerHTML = '';
  pickupCounter = 0;
  dropoffCounter = 0;
  addPickupRow();
  addDropoffRow();
  document.getElementById('defaultWeight').value = '';
  document.getElementById('routePref').value = 'fastest';
  document.getElementById('output').textContent = '';
  if (markers.length) { markers.forEach(m => map.removeLayer(m)); markers = []; }
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
}

// ========== Geocoding & ORS routing ==========
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address + ', Quezon City, Philippines')}`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data[0]) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        display: data[0].display_name
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function fetchORSRoute(multiCoordsLatLng, preference = 'fastest') {
  if (!Array.isArray(multiCoordsLatLng) || multiCoordsLatLng.length < 2) return null;
  const url = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
  const headers = {
    "Authorization": ORS_API_KEY,
    "Accept": "application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8",
    "Content-Type": "application/json"
  };

  const coords = multiCoordsLatLng.map(c => [c[1], c[0]]); // to [lon, lat]
  const body = JSON.stringify({
    coordinates: coords,
    preference: preference,
    instructions: false,
    geometry: true
  });

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('ORS error response:', res.status, txt);
    return null;
  }
  return res.json();
}

// ========== Main routing logic (supports multiple pickups & dropoffs) ==========
window.setRoute = async function setRoute() {
  document.getElementById('output').textContent = 'Loading...';
  if (markers.length) { markers.forEach(m => map.removeLayer(m)); markers = []; }
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

  const routePref = document.getElementById('routePref').value;
  const defaultWeightRaw = document.getElementById('defaultWeight').value.trim();
  const defaultWeight = defaultWeightRaw === '' ? null : parseFloat(defaultWeightRaw);

  // Collect pickups & dropoffs rows
  const pickupRows = Array.from(document.querySelectorAll('#pickupsContainer .row'));
  const dropoffRows = Array.from(document.querySelectorAll('#dropoffsContainer .row'));

  if (pickupRows.length === 0 && dropoffRows.length === 0) {
    document.getElementById('output').textContent = "Please add at least one pickup or drop-off.";
    return;
  }

  const pickups = pickupRows.map(row => {
    const addr = row.querySelector('.addr-input').value.trim();
    const wtRaw = row.querySelector('input[type="number"]').value.trim();
    const wt = wtRaw === '' ? null : parseFloat(wtRaw);
    return { type: 'pickup', address: addr, weight: wt };
  });

  const dropoffs = dropoffRows.map(row => {
    const addr = row.querySelector('.addr-input').value.trim();
    const wtRaw = row.querySelector('input[type="number"]').value.trim();
    const wt = wtRaw === '' ? null : parseFloat(wtRaw);
    return { type: 'dropoff', address: addr, weight: wt };
  });

  // Validate addresses present
  for (let i = 0; i < pickups.length; i++) {
    if (!pickups[i].address) {
      document.getElementById('output').textContent = `Pickup #${i + 1} has no address.`;
      return;
    }
  }
  for (let i = 0; i < dropoffs.length; i++) {
    if (!dropoffs[i].address) {
      document.getElementById('output').textContent = `Drop-off #${i + 1} has no address.`;
      return;
    }
  }

  // Waypoints: pickups (in added order) then dropoffs (in added order)
  const waypoints = [...pickups, ...dropoffs];
  document.getElementById('output').textContent = "Geocoding addresses...";

  // Geocode all addresses in parallel
  const geocodePromises = waypoints.map(wp => geocode(wp.address));
  const geocoded = await Promise.all(geocodePromises);

  if (geocoded.some(g => g === null)) {
    const failedIndex = geocoded.findIndex(g => g === null);
    document.getElementById('output').textContent = `Unable to locate address for waypoint #${failedIndex + 1} (${waypoints[failedIndex].type}). Try to be more specific.`;
    return;
  }

  // Combine geocoded info with waypoint metadata and resolved weight
  const combined = waypoints.map((wp, i) => ({
    type: wp.type,
    address: wp.address,
    weight: (wp.weight !== null && !isNaN(wp.weight) && wp.weight >= 0) ? wp.weight : (defaultWeight !== null && !isNaN(defaultWeight) && defaultWeight >= 0 ? defaultWeight : 0),
    lat: geocoded[i].lat,
    lng: geocoded[i].lng,
    display: geocoded[i].display
  }));

  const pickupCount = pickups.length;
  // Add markers: pickups blue, dropoffs red
  combined.forEach((pt, idx) => {
    const icon = pt.type === 'pickup' ? blueIcon() : redIcon();
    const label = pt.type === 'pickup' ? `Pickup ${idx + 1}` : `Drop-off ${idx + 1 - pickupCount}`;
    const popup = `${pt.type === 'pickup' ? 'Pickup' : 'Drop-off'}:<br>${pt.display}<br>Weight: ${pt.weight} kg`;
    const marker = L.marker([pt.lat, pt.lng], { title: label, icon }).addTo(map).bindPopup(popup);
    markers.push(marker);
  });

  // Build coords array for ORS
  const coordsLatLng = combined.map(p => [p.lat, p.lng]);

  document.getElementById('output').textContent = "Calculating route...";
  const ors = await fetchORSRoute(coordsLatLng, routePref);
  if (!ors || !ors.features || !ors.features[0]) {
    document.getElementById('output').textContent = "No driving route found or ORS request failed.";
    return;
  }

  // Draw polyline
  const routeCoords = ors.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
  routeLine = L.polyline(routeCoords, { color: '#219150', weight: 5, opacity: 0.85 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });

  // Extract segments (legs between waypoints)
  const segments = (ors.features[0].properties && ors.features[0].properties.segments) || [];
  const totalDistanceMeters = (ors.features[0].properties && ors.features[0].properties.summary && ors.features[0].properties.summary.distance) || 0;
  const totalDurationSec = (ors.features[0].properties && ors.features[0].properties.summary && ors.features[0].properties.summary.duration) || 0;

  // Pricing params (adjust as needed)
  const BASE_RATE = 20;       // 20 PHP per km
  const WEIGHT_RATE = 5;      // 5 PHP per km per kg

  // Determine costs per-leg, accounting for pickups adding weight and dropoffs removing weight.
  // Initialize currentLoad as 0, then include effect of waypoint 0 (we assume we load/unload at waypoint 0 before leaving)
  let currentLoad = 0;
  if (combined.length > 0) {
    if (combined[0].type === 'pickup') currentLoad += combined[0].weight;
    else if (combined[0].type === 'dropoff') currentLoad = Math.max(0, currentLoad - combined[0].weight);
  }

  let totalCost = 0;
  const legCosts = []; // cost for each leg i (i -> i+1)
  const legInfo = [];  // store details for each leg for detailed breakdown

  if (segments.length > 0) {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segDistKm = seg.distance / 1000;
      const segDurationMin = Math.round(seg.duration / 60);

      // cost for this leg: distance * (base + weight_rate * currentLoad)
      const segCost = segDistKm * (BASE_RATE + (WEIGHT_RATE * currentLoad));
      legCosts.push(segCost);
      totalCost += segCost;

      const fromIdx = i;
      const toIdx = i + 1;
      const fromLabel = combined[fromIdx].type === 'pickup' ? `Pickup ${fromIdx + 1}` : `Drop-off ${fromIdx + 1 - pickupCount}`;
      const toLabel = combined[toIdx].type === 'pickup' ? `Pickup ${toIdx + 1}` : `Drop-off ${toIdx + 1 - pickupCount}`;

      legInfo.push({
        fromIdx,
        toIdx,
        fromLabel,
        toLabel,
        dist_km: segDistKm,
        dur_min: segDurationMin,
        load_before_kg: currentLoad,
        cost: segCost
      });

      // After arriving at waypoint toIdx, update currentLoad depending on waypoint type
      const toWP = combined[toIdx];
      if (toWP.type === 'pickup') {
        currentLoad += toWP.weight;
      } else if (toWP.type === 'dropoff') {
        currentLoad = Math.max(0, currentLoad - toWP.weight);
      }
    }
  } else {
    // Fallback: no segments returned — use summary as single leg
    const distKm = totalDistanceMeters / 1000;
    const segCost = distKm * (BASE_RATE + (WEIGHT_RATE * currentLoad));
    legCosts.push(segCost);
    legInfo.push({
      fromIdx: 0,
      toIdx: combined.length - 1,
      fromLabel: 'Start',
      toLabel: 'End',
      dist_km: distKm,
      dur_min: Math.round(totalDurationSec / 60),
      load_before_kg: currentLoad,
      cost: segCost
    });
    totalCost = segCost;
  }

  // Map leg costs to arriving waypoints: leg i arrives at waypoint i+1
  const arrivingCosts = new Array(combined.length).fill(0); // index 0 unused (no leg arrives to start)
  for (let i = 0; i < legCosts.length; i++) {
    const arriveIdx = i + 1;
    arrivingCosts[arriveIdx] = legCosts[i];
  }

  // Build per-dropoff summary: for each combined idx that is a dropoff, take arrivingCosts[idx]
  const dropoffSummaries = [];
  for (let idx = 0; idx < combined.length; idx++) {
    if (combined[idx].type === 'dropoff') {
      const label = `Drop-off ${idx + 1 - pickupCount}`;
      dropoffSummaries.push({
        label,
        address: combined[idx].display,
        weight: combined[idx].weight,
        cost_assigned: arrivingCosts[idx] || 0
      });
    }
  }

  const totalDistanceKm = (totalDistanceMeters / 1000).toFixed(2);
  const totalDurationMin = Math.round(totalDurationSec / 60);
  totalCost = totalCost.toFixed(2);

  // Build output: per-waypoint list, total, per-leg breakdown, and per-dropoff assigned costs
  let outputHtml = `<b>Route (${routePref === "fastest" ? "Fastest (Shortest Time)" : "Shortest (Shortest Distance)"}):</b><br>
    <b>Waypoints order:</b><br>`;

  combined.forEach((pt, idx) => {
    const label = pt.type === 'pickup' ? `Pickup ${idx + 1}` : `Drop-off ${idx + 1 - pickupCount}`;
    outputHtml += `${label}: ${pt.display} • Weight: ${pt.weight} kg<br>`;
  });

  outputHtml += `<br><b>Total Road Distance:</b> ${totalDistanceKm} km<br>
    <b>Estimated Driving Time:</b> ${totalDurationMin} min<br>
    <b>Total Estimated Cost:</b> <span style="color:#219150"><b>₱${totalCost}</b></span>
    <div class="breakdown"><b>Per-leg breakdown:</b><br>`;

  legInfo.forEach((l, idx) => {
    outputHtml += `<div style="margin-top:6px;"><b>Leg ${idx + 1}:</b> ${l.fromLabel} → ${l.toLabel}<br>
      Distance: ${l.dist_km.toFixed(2)} km • Time: ${l.dur_min} min<br>
      Load before leg: ${l.load_before_kg.toFixed(2)} kg • Cost: ₱${l.cost.toFixed(2)}</div>`;
  });

  // Per-dropoff summary
  outputHtml += `</div><div class="breakdown" style="margin-top:10px;"><b>Per-dropoff assigned cost:</b><br>`;
  if (dropoffSummaries.length === 0) {
    outputHtml += `<div style="margin-top:6px;">No drop-offs present.</div>`;
  } else {
    dropoffSummaries.forEach((d, i) => {
      outputHtml += `<div style="margin-top:6px;"><b>${d.label}:</b> ${d.address}<br>
        Weight: ${d.weight} kg • Assigned cost: <span style="color:#219150"><b>₱${d.cost_assigned.toFixed(2)}</b></span></div>`;
    });
  }

  outputHtml += `</div>`;

  document.getElementById('output').innerHTML = outputHtml;
};

// Icons
function blueIcon() {
  return new L.Icon({
    iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-blue.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
}
function redIcon() {
  return new L.Icon({
    iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-red.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
}

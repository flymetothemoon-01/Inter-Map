window.__interMapState = window.__interMapState || { initialized: false };

if (window.__interMapState.initialized) {
    throw new Error('Inter-Map already initialized');
}

window.__interMapState.initialized = true;

const mapWidth = 4000;
const mapHeight = 3000;
const loginStorageKey = 'inter-map-auth-v1';
const markerApiBase = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8766'
    : '';

const map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 2,
    zoomControl: true
});

const bounds = [
    [0, 0],
    [mapHeight, mapWidth]
];

const pageBase = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : '/Inter-Map';

L.imageOverlay(`${pageBase}/assets/world-map.png`, bounds).addTo(map);
map.fitBounds(bounds);

let locationMarkers = [];
let markerById = new Map();
let editingMarkerIndex = null;
let markerData = [];
let isLoggedIn = false;
let isPlacingMarker = false;

let routeLines = [];
let routeData = [];
let isPlacingRoute = false;
let routeFirstNodeId = null;
let editingRouteId = null;
let pendingRoute = null;
let isAddingBendPoint = false;
let editingRouteLine = null;
let editingWaypointMarkers = [];
let lastPlacedMarkerId = null;
let lastPlacedRouteId = null;
let partyArrowMarker = null;

const locationIcon = L.divIcon({
    html: '<div class="location-marker"></div>',
    className: 'location-marker-icon',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
});

const editableLocationIcon = L.divIcon({
    html: '<div class="location-marker editable"></div>',
    className: 'location-marker-icon',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
});

const partyArrowIcon = L.divIcon({
    html: '<div class="party-arrow"></div>',
    className: 'party-arrow-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 16]
});

const waypointIcon = L.divIcon({
    html: '<div class="route-waypoint-handle"></div>',
    className: 'route-waypoint-icon',
    iconSize: [10, 10],
    iconAnchor: [5, 5]
});

function clearLocationMarkers() {
    locationMarkers.forEach((marker) => map.removeLayer(marker));
    locationMarkers = [];
    markerById.clear();
}

function renderPartyArrow() {
    if (partyArrowMarker) {
        map.removeLayer(partyArrowMarker);
        partyArrowMarker = null;
    }

    const partyItem = markerData.find((item) => item.isPartyLocation);
    if (!partyItem) {
        return;
    }

    const position = getMarkerPosition(partyItem);
    if (!position) {
        return;
    }

    partyArrowMarker = L.marker(position, {
        icon: partyArrowIcon,
        interactive: false,
        zIndexOffset: 1000
    }).addTo(map);
}

function generateId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildMarkerTooltip(item, index) {
    return `<strong>${makeMarkerLabel(item, index)}</strong><br>${item.description || 'No description yet.'}`;
}

function saveStoredMarkers(items) {
    void persistMarkersToServer(items);
}

async function persistMarkersToServer(items) {
    if (!markerApiBase) {
        console.warn('Live marker persistence is unavailable outside the local backend.');
        return;
    }

    try {
        const response = await fetch(`${markerApiBase}/api/markers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items)
        });
        if (!response.ok) {
            console.warn('Unable to persist marker updates to the live server.', response.status);
        }
    } catch (error) {
        console.warn('Unable to reach the live marker persistence endpoint.', error);
    }
}

function getMarkerPosition(item) {
    const position = Array.isArray(item.position)
        ? item.position
        : [item.lat ?? item.y ?? item.latitude, item.lng ?? item.lon ?? item.x ?? item.longitude];

    if (!Array.isArray(position) || position.length < 2) {
        return null;
    }

    return [Number(position[0]), Number(position[1])];
}

function makeMarkerLabel(item, index) {
    return item.name || `Location ${index + 1}`;
}

function renderLocations(locations) {
    clearLocationMarkers();
    markerData = Array.isArray(locations) ? locations : [];
    let assignedNewId = false;

    markerData.forEach((item, index) => {
        if (!item.id) {
            item.id = generateId();
            assignedNewId = true;
        }

        const position = getMarkerPosition(item);
        if (!position) {
            return;
        }

        const marker = L.marker(position, {
            icon: isLoggedIn ? editableLocationIcon : locationIcon,
            draggable: isLoggedIn
        }).addTo(map);

        marker.bindTooltip(buildMarkerTooltip(item, index), {
            direction: 'top',
            sticky: true,
            offset: [0, -8],
            className: 'marker-tooltip'
        });
        marker.on('dragend', () => {
            if (!isLoggedIn) {
                return;
            }
            const latlng = marker.getLatLng();
            item.position = [latlng.lat, latlng.lng];
            saveStoredMarkers(markerData);
            marker.setTooltipContent(buildMarkerTooltip(item, index));
            renderRoutes(routeData);
            if (item.isPartyLocation) {
                renderPartyArrow();
            }
        });
        marker.on('click', () => {
            if (!isLoggedIn) {
                return;
            }
            if (isPlacingRoute) {
                handleRouteNodeClick(item);
                return;
            }
            editingMarkerIndex = markerData.indexOf(item);
            openMarkerEditor(item);
        });

        if (item.id === lastPlacedMarkerId) {
            const element = marker.getElement();
            if (element) {
                element.classList.add('marker-pop-in');
            }
        }

        locationMarkers.push(marker);
        markerById.set(item.id, { item, marker, index });
    });

    lastPlacedMarkerId = null;
    renderPartyArrow();

    return assignedNewId;
}

function syncLoginState() {
    const loginBtn = document.getElementById('login-btn');

    if (!markerApiBase) {
        // No live backend reachable (e.g. static hosting like GitHub Pages) means edits
        // could never be saved anyway, so the button is shown disabled/greyed-out
        // instead of pretending it works.
        isLoggedIn = false;
        loginBtn.disabled = true;
        loginBtn.title = 'Editing is only available when running the app locally.';
        document.getElementById('login-form').classList.remove('hidden');
        document.getElementById('logout-section').classList.add('hidden');
        updateModeIndicator();
        refreshMarkerUi();
        return;
    }

    loginBtn.disabled = false;
    loginBtn.title = '';

    const savedLogin = localStorage.getItem(loginStorageKey);
    isLoggedIn = savedLogin === 'true';
    document.getElementById('login-form').classList.toggle('hidden', isLoggedIn);
    document.getElementById('logout-section').classList.toggle('hidden', !isLoggedIn);
    if (!isLoggedIn) {
        setPlacingMarker(false);
        setPlacingRoute(false);
        cancelMarker();
        closeRouteEditor();
    }
    updateModeIndicator();
    refreshMarkerUi();
}

function updateModeIndicator() {
    const indicator = document.getElementById('mode-indicator');
    indicator.textContent = isLoggedIn ? 'Editor Mode' : 'Viewer Mode';
}

function refreshMarkerUi() {
    if (!markerData.length) {
        return;
    }
    markerData.forEach((item, index) => {
        const marker = locationMarkers[index];
        if (!marker) {
            return;
        }
        marker.setTooltipContent(buildMarkerTooltip(item, index));
        marker.setIcon(isLoggedIn ? editableLocationIcon : locationIcon);
        marker.options.draggable = isLoggedIn;
        if (marker.dragging) {
            if (isLoggedIn) {
                marker.dragging.enable();
            } else {
                marker.dragging.disable();
            }
        }
    });
}

async function loadLocations() {
    const fallbackLocations = [
        { name: 'Dawn Harbor', position: [700, 900], description: 'A bustling port town.' },
        { name: 'Iron Keep', position: [1350, 1750], description: 'A fortress city on the frontier.' },
        { name: 'Shadowfen', position: [2200, 3050], description: 'A haunted wetland full of secrets.' }
    ];

    let loadedLocations = fallbackLocations;

    try {
        const endpoint = markerApiBase ? `${markerApiBase}/api/markers` : `${pageBase}/locations.json`;
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (response.ok) {
            const payload = await response.json();
            loadedLocations = Array.isArray(payload) ? payload : (payload.locations || fallbackLocations);
        }
    } catch (error) {
        console.warn('Unable to load marker data from the backend, using fallback markers.', error);
    }

    const assignedNewId = renderLocations(loadedLocations);
    if (assignedNewId) {
        saveStoredMarkers(markerData);
    }
}

function clearRouteLines() {
    routeLines.forEach((line) => map.removeLayer(line));
    routeLines = [];
}

function buildRouteTooltip(route) {
    const description = route.description ? `<br>${route.description}` : '';
    return `Cost: ${route.cost}${description}`;
}

function buildRoutePoints(route) {
    const from = markerById.get(route.from);
    const to = markerById.get(route.to);
    if (!from || !to) {
        return null;
    }
    const waypointLatLngs = Array.isArray(route.waypoints)
        ? route.waypoints.map((point) => L.latLng(point[0], point[1]))
        : [];
    return [from.marker.getLatLng(), ...waypointLatLngs, to.marker.getLatLng()];
}

function renderRoutes(routes) {
    clearRouteLines();
    routeData = Array.isArray(routes) ? routes : [];

    routeData.forEach((route) => {
        const points = buildRoutePoints(route);
        if (!points) {
            return;
        }

        const isNewlyPlaced = route.id === lastPlacedRouteId;

        // Wide, near-invisible line drawn under the visible route line to give a much
        // larger, easier-to-hit hover/click target without changing how thick the
        // route looks visually.
        const hitLine = L.polyline(points, {
            color: '#000000',
            weight: 24,
            opacity: 0.001,
            className: 'route-line-hit'
        }).addTo(map);
        hitLine.__routeId = route.id;

        const line = L.polyline(points, {
            color: '#94a3b8',
            weight: 4,
            dashArray: '6, 8',
            className: isNewlyPlaced ? 'route-line route-just-placed' : 'route-line',
            interactive: false
        }).addTo(map);
        line.__routeId = route.id;

        hitLine.bindTooltip(buildRouteTooltip(route), {
            sticky: true,
            className: 'marker-tooltip'
        });

        hitLine.on('mouseover', () => {
            line.setStyle({ color: '#38bdf8', weight: 5 });
        });
        hitLine.on('mouseout', () => {
            line.setStyle({ color: '#94a3b8', weight: 4 });
        });

        hitLine.on('click', (event) => {
            L.DomEvent.stopPropagation(event);
            if (!isLoggedIn || isPlacingRoute || isAddingBendPoint) {
                return;
            }
            openRouteEditor(route, false);
        });

        routeLines.push(hitLine, line);
    });

    lastPlacedRouteId = null;
}

function saveStoredRoutes(items) {
    void persistRoutesToServer(items);
}

async function persistRoutesToServer(items) {
    if (!markerApiBase) {
        console.warn('Live route persistence is unavailable outside the local backend.');
        return;
    }

    try {
        const response = await fetch(`${markerApiBase}/api/routes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items)
        });
        if (!response.ok) {
            console.warn('Unable to persist route updates to the live server.', response.status);
        }
    } catch (error) {
        console.warn('Unable to reach the live route persistence endpoint.', error);
    }
}

async function loadRoutes() {
    let loadedRoutes = [];

    try {
        const endpoint = markerApiBase ? `${markerApiBase}/api/routes` : `${pageBase}/routes.json`;
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (response.ok) {
            const payload = await response.json();
            loadedRoutes = Array.isArray(payload) ? payload : (payload.routes || []);
        }
    } catch (error) {
        console.warn('Unable to load route data from the backend, using no routes.', error);
    }

    renderRoutes(loadedRoutes);
}

function handleStateUpdate(payload) {
    // The live WebSocket feed only carries a periodic party-position simulation and a
    // snapshot of locations captured once at connect time. It must never be used to
    // (re)populate markers - doing so previously caused deleted markers to "reappear"
    // from that stale snapshot. Marker data is only ever sourced from loadLocations().
    void payload;
}

function connectToSocket() {
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    if (!window.WebSocket || !isLocalHost) {
        if (!isLocalHost) {
            console.info('Live WebSocket updates are unavailable when the page is hosted remotely; using the static map view.');
        } else {
            console.warn('WebSockets are not supported in this browser.');
        }
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.hostname}:8765`);
    socket.addEventListener('message', (event) => {
        try {
            const payload = JSON.parse(event.data);
            handleStateUpdate(payload);
        } catch (error) {
            console.warn('Unable to parse live update payload.', error);
        }
    });

    socket.addEventListener('error', (event) => {
        console.warn('WebSocket error.', event);
    });
}

function login() {
    if (!markerApiBase) {
        return;
    }
    isLoggedIn = true;
    localStorage.setItem(loginStorageKey, 'true');
    closeMenu();
    syncLoginState();
}

function logout() {
    isLoggedIn = false;
    localStorage.setItem(loginStorageKey, 'false');
    closeMenu();
    syncLoginState();
}

function openMarkerEditor(item) {
    setPlacingMarker(false);
    editingMarkerIndex = markerData.indexOf(item);
    document.getElementById('marker-name').value = item.name || '';
    document.getElementById('marker-desc').value = item.description || '';
    document.getElementById('marker-party-location').checked = !!item.isPartyLocation;
    document.getElementById('delete-marker-btn').classList.remove('hidden');
    document.getElementById('admin-controls').classList.remove('hidden');
}

function saveMarker() {
    if (editingMarkerIndex === null || !markerData[editingMarkerIndex]) {
        return;
    }

    const item = markerData[editingMarkerIndex];
    item.name = document.getElementById('marker-name').value.trim() || item.name || 'Untitled';
    item.description = document.getElementById('marker-desc').value.trim();

    const isPartyLocation = document.getElementById('marker-party-location').checked;
    if (isPartyLocation) {
        markerData.forEach((entry) => {
            entry.isPartyLocation = entry === item;
        });
    } else {
        delete item.isPartyLocation;
    }

    saveStoredMarkers(markerData);
    const marker = locationMarkers[editingMarkerIndex];
    if (marker) {
        marker.setTooltipContent(buildMarkerTooltip(item, editingMarkerIndex));
    }
    document.getElementById('admin-controls').classList.add('hidden');
    editingMarkerIndex = null;
    renderPartyArrow();
}

function deleteMarker() {
    if (editingMarkerIndex === null || !markerData[editingMarkerIndex]) {
        return;
    }

    const item = markerData[editingMarkerIndex];
    markerData = markerData.filter((entry) => entry !== item);
    routeData = routeData.filter((route) => route.from !== item.id && route.to !== item.id);

    saveStoredMarkers(markerData);
    saveStoredRoutes(routeData);

    editingMarkerIndex = null;
    document.getElementById('admin-controls').classList.add('hidden');
    renderLocations(markerData);
    renderRoutes(routeData);
}

function cancelMarker() {
    editingMarkerIndex = null;
    document.getElementById('delete-marker-btn').classList.add('hidden');
    document.getElementById('admin-controls').classList.add('hidden');
}

function setPlacingMarker(active) {
    isPlacingMarker = active && isLoggedIn;
    document.getElementById('add-marker-btn').classList.toggle('active', isPlacingMarker);
    document.getElementById('map').classList.toggle('placing-marker', isPlacingMarker);
}

function toggleAddMarkerMode() {
    if (!isLoggedIn) {
        return;
    }
    cancelMarker();
    closeRouteEditor();
    setPlacingRoute(false);
    setPlacingMarker(!isPlacingMarker);
    closeMenu();
}

function createMarkerAtClick(event) {
    if (!isLoggedIn || !isPlacingMarker) {
        return;
    }

    const item = {
        id: generateId(),
        name: 'New location',
        description: '',
        position: [event.latlng.lat, event.latlng.lng],
        isCustom: true
    };

    markerData.push(item);
    lastPlacedMarkerId = item.id;
    saveStoredMarkers(markerData);
    renderLocations(markerData);
    renderRoutes(routeData);
    setPlacingMarker(false);
    openMarkerEditor(item);
}

function setPlacingRoute(active) {
    isPlacingRoute = active && isLoggedIn;
    if (!isPlacingRoute && routeFirstNodeId !== null) {
        highlightNode(routeFirstNodeId, false);
        routeFirstNodeId = null;
    }
    document.getElementById('add-route-btn').classList.toggle('active', isPlacingRoute);
    document.getElementById('map').classList.toggle('placing-route', isPlacingRoute);
}

function toggleAddRouteMode() {
    if (!isLoggedIn) {
        return;
    }
    cancelMarker();
    closeRouteEditor();
    setPlacingMarker(false);
    setPlacingRoute(!isPlacingRoute);
    closeMenu();
}

function highlightNode(id, active) {
    const entry = markerById.get(id);
    if (!entry) {
        return;
    }
    const element = entry.marker.getElement();
    if (element) {
        element.classList.toggle('route-node-selected', active);
    }
}

function handleRouteNodeClick(item) {
    const id = item.id;
    if (routeFirstNodeId === null) {
        routeFirstNodeId = id;
        highlightNode(id, true);
        return;
    }
    if (routeFirstNodeId === id) {
        highlightNode(id, false);
        routeFirstNodeId = null;
        return;
    }
    const fromId = routeFirstNodeId;
    highlightNode(fromId, false);
    routeFirstNodeId = null;
    setPlacingRoute(false);
    openRouteEditor({ from: fromId, to: id, cost: 1, description: '' }, true);
}

function openRouteEditor(route, isNew) {
    setPlacingMarker(false);
    cancelMarker();
    editingRouteId = isNew ? null : route.id;
    pendingRoute = {
        from: route.from,
        to: route.to,
        cost: route.cost,
        description: route.description || '',
        waypoints: Array.isArray(route.waypoints) ? route.waypoints.map((point) => [point[0], point[1]]) : []
    };

    if (!isNew) {
        const existingLines = routeLines.filter((line) => line.__routeId === route.id);
        existingLines.forEach((line) => map.removeLayer(line));
        routeLines = routeLines.filter((line) => line.__routeId !== route.id);
    }

    document.getElementById('route-cost').value = route.cost ?? 1;
    document.getElementById('route-desc').value = route.description || '';
    document.getElementById('delete-route-btn').classList.toggle('hidden', isNew);
    document.getElementById('route-controls').classList.remove('hidden');
    renderWaypointEditor();
}

function clearWaypointEditor() {
    if (editingRouteLine) {
        map.removeLayer(editingRouteLine);
        editingRouteLine = null;
    }
    editingWaypointMarkers.forEach((marker) => map.removeLayer(marker));
    editingWaypointMarkers = [];
}

function updateEditingRouteLine() {
    if (!editingRouteLine || !pendingRoute) {
        return;
    }
    const points = buildRoutePoints(pendingRoute);
    if (points) {
        editingRouteLine.setLatLngs(points);
    }
}

function renderWaypointEditor() {
    clearWaypointEditor();
    if (!pendingRoute) {
        return;
    }

    const points = buildRoutePoints(pendingRoute);
    if (!points) {
        return;
    }

    editingRouteLine = L.polyline(points, {
        color: '#38bdf8',
        weight: 3,
        dashArray: '6, 8'
    }).addTo(map);

    pendingRoute.waypoints.forEach((point, index) => {
        const handle = L.marker(L.latLng(point[0], point[1]), {
            icon: waypointIcon,
            draggable: true
        }).addTo(map);

        handle.on('drag', () => {
            const latlng = handle.getLatLng();
            pendingRoute.waypoints[index] = [latlng.lat, latlng.lng];
            updateEditingRouteLine();
        });

        handle.on('click', (event) => {
            L.DomEvent.stopPropagation(event);
            pendingRoute.waypoints.splice(index, 1);
            renderWaypointEditor();
        });

        editingWaypointMarkers.push(handle);
    });
}

function pointToSegmentDistance(point, a, b) {
    const px = point.lng;
    const py = point.lat;
    const ax = a.lng;
    const ay = a.lat;
    const bx = b.lng;
    const by = b.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
}

function insertBendPoint(latlng) {
    if (!pendingRoute) {
        return;
    }
    const points = buildRoutePoints(pendingRoute);
    if (!points) {
        return;
    }

    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
        const distance = pointToSegmentDistance(latlng, points[i], points[i + 1]);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    pendingRoute.waypoints.splice(bestIndex, 0, [latlng.lat, latlng.lng]);
    renderWaypointEditor();
}

function toggleAddBendMode() {
    if (!isLoggedIn || !pendingRoute) {
        return;
    }
    isAddingBendPoint = !isAddingBendPoint;
    document.getElementById('add-bend-btn').classList.toggle('active', isAddingBendPoint);
    document.getElementById('map').classList.toggle('placing-route', isAddingBendPoint);
}

function saveRoute() {
    const cost = Number(document.getElementById('route-cost').value);
    const safeCost = Number.isFinite(cost) ? cost : 0;
    const description = document.getElementById('route-desc').value.trim();
    const waypoints = pendingRoute && Array.isArray(pendingRoute.waypoints)
        ? pendingRoute.waypoints.map((point) => [point[0], point[1]])
        : [];

    if (editingRouteId === null) {
        const newRoute = { id: generateId(), from: pendingRoute.from, to: pendingRoute.to, cost: safeCost, description, waypoints };
        routeData.push(newRoute);
        lastPlacedRouteId = newRoute.id;
    } else {
        const route = routeData.find((entry) => entry.id === editingRouteId);
        if (route) {
            route.cost = safeCost;
            route.description = description;
            route.waypoints = waypoints;
        }
    }

    saveStoredRoutes(routeData);
    closeRouteEditor();
}

function deleteRoute() {
    if (editingRouteId !== null) {
        routeData = routeData.filter((entry) => entry.id !== editingRouteId);
        saveStoredRoutes(routeData);
    }
    closeRouteEditor();
}

function closeRouteEditor() {
    editingRouteId = null;
    pendingRoute = null;
    isAddingBendPoint = false;
    document.getElementById('add-bend-btn').classList.remove('active');
    document.getElementById('map').classList.remove('placing-route');
    clearWaypointEditor();
    document.getElementById('route-controls').classList.add('hidden');
    renderRoutes(routeData);
}

function handleMapClick(event) {
    if (isAddingBendPoint && pendingRoute) {
        insertBendPoint(event.latlng);
        return;
    }
    if (isPlacingMarker) {
        createMarkerAtClick(event);
        return;
    }
    if (isPlacingRoute) {
        setPlacingRoute(false);
        return;
    }
    if (editingMarkerIndex !== null) {
        cancelMarker();
    }
    if (editingRouteId !== null || pendingRoute !== null) {
        closeRouteEditor();
    }
}

function toggleMenu() {
    const panel = document.getElementById('menu-panel');
    const toggle = document.getElementById('menu-toggle');
    const isOpen = panel.classList.toggle('hidden') === false;
    toggle.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
}

function closeMenu() {
    document.getElementById('menu-panel').classList.add('hidden');
    document.getElementById('menu-toggle').classList.remove('open');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        setPlacingMarker(false);
        setPlacingRoute(false);
        cancelMarker();
        closeRouteEditor();
    }
});

map.on('click', handleMapClick);
document.getElementById('menu-toggle').addEventListener('click', toggleMenu);
document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('add-marker-btn').addEventListener('click', toggleAddMarkerMode);
document.getElementById('save-marker-btn').addEventListener('click', saveMarker);
document.getElementById('delete-marker-btn').addEventListener('click', deleteMarker);
document.getElementById('cancel-marker-btn').addEventListener('click', cancelMarker);
document.getElementById('close-marker-btn').addEventListener('click', cancelMarker);
document.getElementById('add-route-btn').addEventListener('click', toggleAddRouteMode);
document.getElementById('save-route-btn').addEventListener('click', saveRoute);
document.getElementById('delete-route-btn').addEventListener('click', deleteRoute);
document.getElementById('add-bend-btn').addEventListener('click', toggleAddBendMode);
document.getElementById('cancel-route-btn').addEventListener('click', closeRouteEditor);
document.getElementById('close-route-btn').addEventListener('click', closeRouteEditor);

loadLocations().then(loadRoutes).finally(() => {
    syncLoginState();
    connectToSocket();
});
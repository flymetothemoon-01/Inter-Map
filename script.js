window.__interMapState = window.__interMapState || { initialized: false };

if (window.__interMapState.initialized) {
    throw new Error('Inter-Map already initialized');
}

window.__interMapState.initialized = true;

const mapWidth = 4000;
const mapHeight = 3000;
const authFile = './auth.json';
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

L.imageOverlay(`${pageBase}/assets/world-map.webp`, bounds).addTo(map);
map.fitBounds(bounds);

let locationMarkers = [];
let editingMarkerIndex = null;
let markerData = [];
let isLoggedIn = false;
let isPlacingMarker = false;

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

function clearLocationMarkers() {
    locationMarkers.forEach((marker) => map.removeLayer(marker));
    locationMarkers = [];
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

    markerData.forEach((item, index) => {
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
        });
        marker.on('click', () => {
            if (!isLoggedIn) {
                return;
            }
            editingMarkerIndex = markerData.indexOf(item);
            openMarkerEditor(item);
        });
        locationMarkers.push(marker);
    });
}

function syncLoginState() {
    const savedLogin = localStorage.getItem(loginStorageKey);
    isLoggedIn = savedLogin === 'true';
    document.getElementById('login-form').classList.toggle('hidden', isLoggedIn);
    document.getElementById('logout-section').classList.toggle('hidden', !isLoggedIn);
    if (!isLoggedIn) {
        setPlacingMarker(false);
        cancelMarker();
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

    renderLocations(loadedLocations);
}

function handleStateUpdate(payload) {
    if (!payload || payload.type !== 'state' || !payload.state) {
        return;
    }

    const { locations } = payload.state;
    if (Array.isArray(locations) && (!markerData.length || !locationMarkers.length)) {
        renderLocations(locations);
    }
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

async function tryLoadAuth() {
    try {
        const response = await fetch(authFile, { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch (error) {
        return null;
    }
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const credentials = await tryLoadAuth();
    if (!credentials || credentials.username !== username || credentials.password !== password) {
        alert('Invalid login.');
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
    document.getElementById('admin-controls').classList.remove('hidden');
}

function saveMarker() {
    if (editingMarkerIndex === null || !markerData[editingMarkerIndex]) {
        return;
    }

    const item = markerData[editingMarkerIndex];
    item.name = document.getElementById('marker-name').value.trim() || item.name || 'Untitled';
    item.description = document.getElementById('marker-desc').value.trim();
    saveStoredMarkers(markerData);
    const marker = locationMarkers[editingMarkerIndex];
    if (marker) {
        marker.setTooltipContent(buildMarkerTooltip(item, editingMarkerIndex));
    }
    document.getElementById('admin-controls').classList.add('hidden');
    editingMarkerIndex = null;
}

function cancelMarker() {
    editingMarkerIndex = null;
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
    setPlacingMarker(!isPlacingMarker);
    closeMenu();
}

function createMarkerAtClick(event) {
    if (!isLoggedIn || !isPlacingMarker) {
        return;
    }

    const item = {
        name: 'New location',
        description: '',
        position: [event.latlng.lat, event.latlng.lng],
        isCustom: true
    };

    markerData.push(item);
    saveStoredMarkers(markerData);
    renderLocations(markerData);
    setPlacingMarker(false);
    openMarkerEditor(item);
}

function handleMapClick(event) {
    if (isPlacingMarker) {
        createMarkerAtClick(event);
        return;
    }
    if (editingMarkerIndex !== null) {
        cancelMarker();
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
        cancelMarker();
    }
});

map.on('click', handleMapClick);
document.getElementById('menu-toggle').addEventListener('click', toggleMenu);
document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('add-marker-btn').addEventListener('click', toggleAddMarkerMode);
document.getElementById('save-marker-btn').addEventListener('click', saveMarker);
document.getElementById('cancel-marker-btn').addEventListener('click', cancelMarker);
document.getElementById('close-marker-btn').addEventListener('click', cancelMarker);

loadLocations().finally(() => {
    syncLoginState();
    connectToSocket();
});
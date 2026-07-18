window.__interMapState = window.__interMapState || { initialized: false };

if (window.__interMapState.initialized) {
    throw new Error('Inter-Map already initialized');
}

window.__interMapState.initialized = true;

const mapWidth = 4000;
const mapHeight = 3000;
const storageKey = 'inter-map-markers-v1';

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

const partyIcon = L.divIcon({
    html: '<div class="party-marker"></div>',
    className: 'party-marker-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

let party = null;
let locationMarkers = [];
let mode = 'user';
let editingMarkerIndex = null;
let markerData = [];

function createPartyMarker(position) {
    if (party) {
        map.removeLayer(party);
    }
    party = L.marker(position, { icon: partyIcon }).addTo(map);
    party.bindPopup('Party location');
}

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

function buildMarkerPopup(item, index) {
    return `<strong>${makeMarkerLabel(item, index)}</strong><br>${item.description || 'No description yet.'}`;
}

function getStoredMarkers() {
    try {
        const stored = localStorage.getItem(storageKey);
        if (!stored) {
            return [];
        }
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn('Unable to read custom markers from storage.', error);
        return [];
    }
}

function saveStoredMarkers(items) {
    const customItems = items.filter((item) => item.isCustom);
    localStorage.setItem(storageKey, JSON.stringify(customItems));
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
            icon: mode === 'admin' ? editableLocationIcon : locationIcon,
            draggable: mode === 'admin'
        }).addTo(map);

        marker.bindPopup(buildMarkerPopup(item, index));
        marker.on('dragend', () => {
            if (mode !== 'admin') {
                return;
            }
            const latlng = marker.getLatLng();
            item.position = [latlng.lat, latlng.lng];
            saveStoredMarkers(markerData);
            marker.setPopupContent(buildMarkerPopup(item, index));
        });
        marker.on('click', () => {
            if (mode !== 'admin') {
                return;
            }
            editingMarkerIndex = markerData.indexOf(item);
            openMarkerEditor(item);
        });
        locationMarkers.push(marker);
    });
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
        marker.setPopupContent(buildMarkerPopup(item, index));
        marker.setIcon(mode === 'admin' ? editableLocationIcon : locationIcon);
        marker.options.draggable = mode === 'admin';
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
        const response = await fetch(`${pageBase}/locations.json`, { cache: 'no-store' });
        if (response.ok) {
            const payload = await response.json();
            loadedLocations = Array.isArray(payload) ? payload : (payload.locations || fallbackLocations);
        }
    } catch (error) {
        console.warn('Unable to load locations.json, using fallback markers.', error);
    }

    const customMarkers = getStoredMarkers();
    renderLocations([...loadedLocations, ...customMarkers]);
}

function handleStateUpdate(payload) {
    if (!payload || payload.type !== 'state' || !payload.state) {
        return;
    }

    const { party: partyState, locations } = payload.state;
    if (partyState && Array.isArray(partyState.position) && partyState.position.length >= 2) {
        createPartyMarker([Number(partyState.position[0]), Number(partyState.position[1])]);
    }

    if (Array.isArray(locations)) {
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

function switchMode(nextMode) {
    mode = nextMode;
    document.getElementById('user-mode-btn').classList.toggle('active', mode === 'user');
    document.getElementById('admin-mode-btn').classList.toggle('active', mode === 'admin');
    document.getElementById('admin-controls').classList.toggle('hidden', mode !== 'admin');
    refreshMarkerUi();
}

function openMarkerEditor(item) {
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
        marker.setPopupContent(buildMarkerPopup(item, editingMarkerIndex));
    }
    document.getElementById('admin-controls').classList.add('hidden');
    editingMarkerIndex = null;
}

function cancelMarker() {
    editingMarkerIndex = null;
    document.getElementById('admin-controls').classList.add('hidden');
}

function createMarkerAtClick(event) {
    if (mode !== 'admin') {
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
    openMarkerEditor(item);
}

map.on('click', createMarkerAtClick);
document.getElementById('user-mode-btn').addEventListener('click', () => switchMode('user'));
document.getElementById('admin-mode-btn').addEventListener('click', () => switchMode('admin'));
document.getElementById('save-marker-btn').addEventListener('click', saveMarker);
document.getElementById('cancel-marker-btn').addEventListener('click', cancelMarker);

loadLocations().finally(() => {
    connectToSocket();
});
window.__interMapState = window.__interMapState || { initialized: false };

if (window.__interMapState.initialized) {
    throw new Error('Inter-Map already initialized');
}

window.__interMapState.initialized = true;

const mapWidth = 4000;
const mapHeight = 3000;

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

L.imageOverlay('assets/world-map.webp', bounds).addTo(map);
map.fitBounds(bounds);

const partyIcon = L.divIcon({
    html: '<div class="party-marker"></div>',
    className: 'party-marker-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

let party = null;
let locationMarkers = [];

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

function clearLocationMarkers() {
    locationMarkers.forEach((marker) => map.removeLayer(marker));
    locationMarkers = [];
}

function addLocationMarkers(locations) {
    clearLocationMarkers();
    locations.forEach((item, index) => {
        const position = Array.isArray(item.position)
            ? item.position
            : [item.lat ?? item.y ?? item.latitude, item.lng ?? item.lon ?? item.x ?? item.longitude];

        if (!Array.isArray(position) || position.length < 2) {
            return;
        }

        const marker = L.marker([Number(position[0]), Number(position[1])], { icon: locationIcon }).addTo(map);
        marker.bindPopup(item.name || `Location ${index + 1}`);
        locationMarkers.push(marker);
    });
}

async function loadLocations() {
    const fallbackLocations = [
        { name: 'Dawn Harbor', position: [700, 900] },
        { name: 'Iron Keep', position: [1350, 1750] },
        { name: 'Shadowfen', position: [2200, 3050] }
    ];

    try {
        const response = await fetch('locations.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const locations = Array.isArray(payload) ? payload : (payload.locations || []);
        addLocationMarkers(locations);
    } catch (error) {
        console.warn('Unable to load locations.json, using fallback markers.', error);
        addLocationMarkers(fallbackLocations);
    }
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
        addLocationMarkers(locations);
    }
}

function connectToSocket() {
    if (!window.WebSocket) {
        console.warn('WebSockets are not supported in this browser.');
        return;
    }

    const socket = new WebSocket('ws://127.0.0.1:8765');
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

loadLocations().finally(() => {
    connectToSocket();
});
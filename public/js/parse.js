/**
 * Parse Google Timeline / Location History JSON exports into a unified model.
 * Supports: Records.json, Semantic Location History, Phone Takeout (semanticSegments).
 */

const ACTIVITY_LABELS = {
  IN_VEHICLE: 'Kendaraan',
  IN_CAR: 'Mobil',
  IN_BUS: 'Bus',
  IN_TRAIN: 'Kereta',
  IN_SUBWAY: 'MRT/Subway',
  IN_TRAM: 'Tram',
  IN_FERRY: 'Ferry',
  ON_BICYCLE: 'Sepeda',
  ON_FOOT: 'Jalan kaki',
  WALKING: 'Jalan kaki',
  RUNNING: 'Lari',
  STILL: 'Diam',
  TILTING: 'Gerakan',
  UNKNOWN: 'Tidak diketahui',
  MOTORCYCLING: 'Motor',
  FLYING: 'Terbang',
  BOATING: 'Perahu',
  SKIING: 'Ski',
  IN_PASSENGER_VEHICLE: 'Kendaraan',
  CYCLING: 'Sepeda',
};

function labelActivity(type) {
  if (!type) return 'Tidak diketahui';
  const key = String(type).toUpperCase().replace(/\s+/g, '_');
  return ACTIVITY_LABELS[key] || String(type).replace(/_/g, ' ').toLowerCase();
}

function parseE7(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) > 180 ? n / 1e7 : n;
}

function parseLatLngString(s) {
  if (!s || typeof s !== 'string') return null;
  // "geo:lat,lng" or "-6.2°, 106.8°" or "-6.2, 106.8"
  let m = s.match(/geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)\s*°?/);
  if (m) return { lat: +m[1], lng: +m[2] };
  return null;
}

function fromLocationObj(loc) {
  if (!loc) return null;
  if (loc.latLng) return parseLatLngString(loc.latLng);
  if (loc.latitudeE7 != null && loc.longitudeE7 != null) {
    return { lat: parseE7(loc.latitudeE7), lng: parseE7(loc.longitudeE7) };
  }
  if (loc.lat != null && loc.lng != null) return { lat: +loc.lat, lng: +loc.lng };
  if (loc.latitude != null && loc.longitude != null) {
    return { lat: +loc.latitude, lng: +loc.longitude };
  }
  return null;
}

function parseTs(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    // ms or seconds
    return v > 1e12 ? v : v > 1e10 ? v : v * 1000;
  }
  const s = String(v);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 1e12 ? n : n * 1000;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function detectFormat(data) {
  if (!data) return 'unknown';
  if (Array.isArray(data)) {
    if (data[0]?.visit || data[0]?.activity || data[0]?.timelinePath) return 'phone-array';
    if (data[0]?.latitudeE7 != null) return 'records-array';
    return 'unknown-array';
  }
  if (data.locations) return 'records';
  if (data.timelineObjects) return 'semantic';
  if (data.semanticSegments || data.rawSignals) return 'phone';
  return 'unknown';
}

function pushPoint(points, lat, lng, t, extra = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
  points.push({ lat, lng, t, ...extra });
}

function parseRecords(data) {
  const locations = data.locations || data;
  const points = [];
  const list = Array.isArray(locations) ? locations : [];
  // File besar (Records.json puluhan MB): thin on the fly supaya HP tidak freeze
  const minDt = 20_000; // 20 detik
  const minDist = 25; // meter
  let lastKept = null;

  for (const loc of list) {
    const lat = parseE7(loc.latitudeE7 ?? loc.lat);
    const lng = parseE7(loc.longitudeE7 ?? loc.lng);
    const t = parseTs(loc.timestamp || loc.timestampMs || loc.time);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(t)) continue;
    if (loc.accuracy != null && Number(loc.accuracy) > 250) continue;

    if (lastKept) {
      const dt = t - lastKept.t;
      if (dt >= 0 && dt < minDt && haversine(lastKept, { lat, lng }) < minDist) continue;
    }

    const activity = loc.activity?.[0]?.activity?.[0]?.type || null;
    pushPoint(points, lat, lng, t, {
      accuracy: loc.accuracy,
      altitude: loc.altitude,
      activity: activity ? labelActivity(activity) : null,
      activityRaw: activity,
      kind: 'point',
    });
    lastKept = { lat, lng, t };
  }
  return { points, visits: [], segments: [], format: 'records' };
}

function parseSemantic(data) {
  const points = [];
  const visits = [];
  const segments = [];
  const objects = data.timelineObjects || [];

  for (const obj of objects) {
    if (obj.placeVisit) {
      const pv = obj.placeVisit;
      const loc = fromLocationObj(pv.location) || fromLocationObj(pv.centerLatE7 != null
        ? { latitudeE7: pv.centerLatE7, longitudeE7: pv.centerLngE7 }
        : null);
      const start = parseTs(pv.duration?.startTimestamp || pv.duration?.startTimestampMs);
      const end = parseTs(pv.duration?.endTimestamp || pv.duration?.endTimestampMs);
      const name = pv.location?.name || pv.location?.address || 'Tempat';
      if (loc && start) {
        visits.push({
          lat: loc.lat,
          lng: loc.lng,
          t: start,
          endT: end,
          name,
          address: pv.location?.address || '',
          kind: 'visit',
        });
        pushPoint(points, loc.lat, loc.lng, start, { kind: 'visit', name });
      }
    }

    if (obj.activitySegment) {
      const as = obj.activitySegment;
      const activity = as.activityType || as.activities?.[0]?.activityType;
      const start = parseTs(as.duration?.startTimestamp || as.duration?.startTimestampMs);
      const end = parseTs(as.duration?.endTimestamp || as.duration?.endTimestampMs);
      const startLoc = fromLocationObj(as.startLocation);
      const endLoc = fromLocationObj(as.endLocation);
      const path = [];

      const rawPath =
        as.waypointPath?.waypoints ||
        as.simplifiedRawPath?.points ||
        [];

      for (const wp of rawPath) {
        const p = fromLocationObj(wp) || {
          lat: parseE7(wp.latE7 ?? wp.latitudeE7),
          lng: parseE7(wp.lngE7 ?? wp.longitudeE7),
        };
        const pt = parseTs(wp.timestamp || wp.timestampMs) || start;
        if (p?.lat != null) {
          path.push({ lat: p.lat, lng: p.lng, t: pt });
          pushPoint(points, p.lat, p.lng, pt, {
            activity: labelActivity(activity),
            activityRaw: activity,
            kind: 'move',
          });
        }
      }

      if (!path.length && startLoc && endLoc && start) {
        path.push({ lat: startLoc.lat, lng: startLoc.lng, t: start });
        path.push({ lat: endLoc.lat, lng: endLoc.lng, t: end || start });
        pushPoint(points, startLoc.lat, startLoc.lng, start, {
          activity: labelActivity(activity),
          activityRaw: activity,
          kind: 'move',
        });
        if (end) {
          pushPoint(points, endLoc.lat, endLoc.lng, end, {
            activity: labelActivity(activity),
            activityRaw: activity,
            kind: 'move',
          });
        }
      }

      if (path.length) {
        segments.push({
          activity: labelActivity(activity),
          activityRaw: activity,
          start,
          end,
          distance: as.distance || as.distanceMeters || null,
          path,
        });
      }
    }
  }

  return { points, visits, segments, format: 'semantic' };
}

function parsePhone(data) {
  const points = [];
  const visits = [];
  const segments = [];
  const segs = data.semanticSegments || (Array.isArray(data) ? data : []);

  for (const seg of segs) {
    const start = parseTs(seg.startTime);
    const end = parseTs(seg.endTime);

    if (seg.timelinePath) {
      const path = [];
      for (const tp of seg.timelinePath) {
        const p = parseLatLngString(tp.point) || fromLocationObj(tp);
        const t = parseTs(tp.time) || start;
        if (p) {
          path.push({ lat: p.lat, lng: p.lng, t });
          pushPoint(points, p.lat, p.lng, t, { kind: 'path' });
        }
      }
      if (path.length > 1) {
        segments.push({
          activity: 'Perjalanan',
          activityRaw: 'PATH',
          start,
          end,
          path,
        });
      }
    }

    if (seg.visit?.topCandidate) {
      const tc = seg.visit.topCandidate;
      const loc =
        fromLocationObj(tc.placeLocation) ||
        parseLatLngString(tc.placeLocation?.latLng || tc.placeLocation);
      const name = tc.semanticType || tc.placeId || 'Kunjungan';
      if (loc && start) {
        visits.push({
          lat: loc.lat,
          lng: loc.lng,
          t: start,
          endT: end,
          name: String(name).replace(/_/g, ' '),
          address: '',
          kind: 'visit',
        });
        pushPoint(points, loc.lat, loc.lng, start, { kind: 'visit', name });
      }
    }

    if (seg.activity) {
      const act = seg.activity;
      const type = act.topCandidate?.type || act.type;
      const startLoc = parseLatLngString(act.start?.latLng) || fromLocationObj(act.start);
      const endLoc = parseLatLngString(act.end?.latLng) || fromLocationObj(act.end);
      const path = [];
      if (startLoc && start) {
        path.push({ lat: startLoc.lat, lng: startLoc.lng, t: start });
        pushPoint(points, startLoc.lat, startLoc.lng, start, {
          activity: labelActivity(type),
          activityRaw: type,
          kind: 'move',
        });
      }
      if (endLoc && end) {
        path.push({ lat: endLoc.lat, lng: endLoc.lng, t: end });
        pushPoint(points, endLoc.lat, endLoc.lng, end, {
          activity: labelActivity(type),
          activityRaw: type,
          kind: 'move',
        });
      }
      if (path.length) {
        segments.push({
          activity: labelActivity(type),
          activityRaw: type,
          start,
          end,
          distance: act.distanceMeters || null,
          path,
        });
      }
    }
  }

  // rawSignals positions
  const signals = data.rawSignals || [];
  for (const sig of signals) {
    const pos = sig.position;
    if (!pos) continue;
    const p =
      parseLatLngString(pos.LatLng || pos.latLng) ||
      fromLocationObj(pos);
    const t = parseTs(pos.timestamp || sig.timestamp);
    if (p && t) pushPoint(points, p.lat, p.lng, t, { kind: 'raw', accuracy: pos.accuracyMeters });
  }

  return { points, visits, segments, format: 'phone' };
}

function downsamplePoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function finalize(parsed, sourceName) {
  const points = parsed.points
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  // Deduplicate near-identical consecutive points
  const deduped = [];
  for (const p of points) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.t - p.t) < 1000 && haversine(prev, p) < 5) continue;
    deduped.push(p);
  }

  const rawCount = deduped.length;
  const MAX = 60_000;
  const kept = downsamplePoints(deduped, MAX);

  let distance = 0;
  for (let i = 1; i < kept.length; i++) {
    distance += haversine(kept[i - 1], kept[i]);
  }

  const activities = new Map();
  for (const p of kept) {
    if (p.activity) activities.set(p.activity, (activities.get(p.activity) || 0) + 1);
  }
  for (const s of parsed.segments) {
    if (s.activity) activities.set(s.activity, (activities.get(s.activity) || 0) + (s.path?.length || 1));
  }

  // Cap segment path sizes for map performance
  const segments = (parsed.segments || []).map((s) => ({
    ...s,
    path: downsamplePoints(s.path || [], 2_000),
  }));

  const minT = kept[0]?.t ?? null;
  const maxT = kept[kept.length - 1]?.t ?? null;

  return {
    sourceName,
    format: parsed.format,
    points: kept,
    visits: parsed.visits.sort((a, b) => a.t - b.t),
    segments,
    stats: {
      pointCount: kept.length,
      rawPointCount: rawCount,
      downsampled: rawCount > kept.length,
      visitCount: parsed.visits.length,
      segmentCount: segments.length,
      distanceM: distance,
      minT,
      maxT,
      activities: [...activities.entries()].sort((a, b) => b[1] - a[1]),
    },
  };
}

export function parseTimelineJson(data, sourceName = 'upload') {
  const format = detectFormat(data);
  let parsed;
  switch (format) {
    case 'records':
    case 'records-array':
      parsed = parseRecords(format === 'records-array' ? { locations: data } : data);
      break;
    case 'semantic':
      parsed = parseSemantic(data);
      break;
    case 'phone':
    case 'phone-array':
      parsed = parsePhone(format === 'phone-array' ? { semanticSegments: data } : data);
      break;
    default:
      throw new Error(
        'Format JSON tidak dikenali. Upload Records.json, Semantic Location History, atau export Timeline dari ponsel.'
      );
  }
  if (!parsed.points.length && !parsed.visits.length) {
    throw new Error('Tidak ada titik lokasi yang bisa dibaca dari file ini.');
  }
  return finalize(parsed, sourceName);
}

export function filterTimeline(data, { from, to, activities, query } = {}) {
  const actSet = activities?.length ? new Set(activities) : null;
  const q = query?.trim().toLowerCase();

  const points = data.points.filter((p) => {
    if (from && p.t < from) return false;
    if (to && p.t > to) return false;
    // Titik tanpa label aktivitas tetap ditampilkan (umum di Records.json)
    if (actSet && p.activity && !actSet.has(p.activity)) return false;
    return true;
  });

  const visits = data.visits.filter((v) => {
    if (from && v.t < from) return false;
    if (to && v.endT && v.endT < from) return false;
    if (to && v.t > to) return false;
    if (q && !(v.name || '').toLowerCase().includes(q) && !(v.address || '').toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  const segments = data.segments.filter((s) => {
    if (from && s.end && s.end < from) return false;
    if (to && s.start && s.start > to) return false;
    if (actSet && s.activity && !actSet.has(s.activity)) return false;
    return true;
  });

  let distance = 0;
  for (let i = 1; i < points.length; i++) distance += haversine(points[i - 1], points[i]);

  return {
    ...data,
    points,
    visits,
    segments,
    stats: {
      ...data.stats,
      pointCount: points.length,
      visitCount: visits.length,
      segmentCount: segments.length,
      distanceM: distance,
      minT: points[0]?.t ?? null,
      maxT: points[points.length - 1]?.t ?? null,
    },
  };
}

export { haversine, labelActivity, detectFormat };

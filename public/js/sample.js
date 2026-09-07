/** Demo sample — weekend trip around Jakarta (fictional). */

export function getSampleTimeline() {
  const day = (d, h, m = 0) => Date.parse(`2025-06-0${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`);

  const pathHomeToCafe = [
    { lat: -6.2088, lng: 106.8456, t: day(7, 8, 0) },
    { lat: -6.205, lng: 106.84, t: day(7, 8, 12) },
    { lat: -6.2, lng: 106.832, t: day(7, 8, 25) },
    { lat: -6.1944, lng: 106.8229, t: day(7, 8, 40) },
  ];

  const pathCafeToMonas = [
    { lat: -6.1944, lng: 106.8229, t: day(7, 10, 0) },
    { lat: -6.185, lng: 106.825, t: day(7, 10, 15) },
    { lat: -6.1754, lng: 106.8272, t: day(7, 10, 30) },
  ];

  const pathMonasToAncol = [
    { lat: -6.1754, lng: 106.8272, t: day(7, 13, 0) },
    { lat: -6.15, lng: 106.83, t: day(7, 13, 20) },
    { lat: -6.125, lng: 106.84, t: day(7, 13, 40) },
    { lat: -6.1225, lng: 106.842, t: day(7, 14, 0) },
  ];

  const pathSunday = [
    { lat: -6.2088, lng: 106.8456, t: day(8, 9, 0) },
    { lat: -6.22, lng: 106.83, t: day(8, 9, 30) },
    { lat: -6.235, lng: 106.8, t: day(8, 10, 10) },
    { lat: -6.244, lng: 106.799, t: day(8, 10, 40) },
    { lat: -6.244, lng: 106.799, t: day(8, 14, 0) },
    { lat: -6.22, lng: 106.82, t: day(8, 15, 0) },
    { lat: -6.2088, lng: 106.8456, t: day(8, 16, 0) },
  ];

  const segments = [
    {
      activity: 'Kendaraan',
      activityRaw: 'IN_VEHICLE',
      start: pathHomeToCafe[0].t,
      end: pathHomeToCafe.at(-1).t,
      path: pathHomeToCafe.map((p) => ({ ...p, activity: 'Kendaraan' })),
    },
    {
      activity: 'Jalan kaki',
      activityRaw: 'WALKING',
      start: pathCafeToMonas[0].t,
      end: pathCafeToMonas.at(-1).t,
      path: pathCafeToMonas.map((p) => ({ ...p, activity: 'Jalan kaki' })),
    },
    {
      activity: 'Kendaraan',
      activityRaw: 'IN_VEHICLE',
      start: pathMonasToAncol[0].t,
      end: pathMonasToAncol.at(-1).t,
      path: pathMonasToAncol.map((p) => ({ ...p, activity: 'Kendaraan' })),
    },
    {
      activity: 'Sepeda',
      activityRaw: 'ON_BICYCLE',
      start: pathSunday[0].t,
      end: pathSunday.at(-1).t,
      path: pathSunday.map((p) => ({ ...p, activity: 'Sepeda' })),
    },
  ];

  const visits = [
    { lat: -6.2088, lng: 106.8456, t: day(7, 7, 0), endT: day(7, 8, 0), name: 'Rumah', address: 'Jakarta Pusat', kind: 'visit' },
    { lat: -6.1944, lng: 106.8229, t: day(7, 8, 45), endT: day(7, 10, 0), name: 'Kafe Menteng', address: 'Menteng', kind: 'visit' },
    { lat: -6.1754, lng: 106.8272, t: day(7, 10, 35), endT: day(7, 13, 0), name: 'Monas', address: 'Gambir', kind: 'visit' },
    { lat: -6.1225, lng: 106.842, t: day(7, 14, 5), endT: day(7, 18, 0), name: 'Ancol', address: 'Jakarta Utara', kind: 'visit' },
    { lat: -6.244, lng: 106.799, t: day(8, 10, 45), endT: day(8, 14, 0), name: 'Taman Mini', address: 'Jakarta Timur', kind: 'visit' },
  ];

  const points = segments.flatMap((s) =>
    s.path.map((p) => ({
      ...p,
      activity: s.activity,
      activityRaw: s.activityRaw,
      kind: 'move',
      color: undefined,
    }))
  );

  let distanceM = 0;
  for (let i = 1; i < points.length; i++) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const a = points[i - 1];
    const b = points[i];
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    distanceM += 2 * R * Math.asin(Math.sqrt(h));
  }

  return {
    sourceName: 'sample-jakarta.json',
    format: 'sample',
    points,
    visits,
    segments,
    stats: {
      pointCount: points.length,
      visitCount: visits.length,
      segmentCount: segments.length,
      distanceM,
      minT: points[0].t,
      maxT: points.at(-1).t,
      activities: [
        ['Kendaraan', 8],
        ['Jalan kaki', 3],
        ['Sepeda', 7],
      ],
    },
  };
}

"use strict";
// Night sky: what's coming up in the sky over you (meteor showers, eclipses, full moons, planets, the space station),
// how good each night looks for stargazing (cloud forecast + moonlight), and darker places nearby to watch from.
//
// Everything about the sky is calculated on the device with Astronomy Engine (vendor/astronomy, MIT, accurate to
// about an arcminute), so it works for any place and any year with no account or key. Free, keyless data:
//  - Open-Meteo: hourly cloud cover at home and at each viewing spot
//  - OpenStreetMap (Overpass API): parks, nature reserves, observatories and viewpoints, plus town populations
//    used to estimate light pollution with Walker's law
//  - CelesTrak: the space station's current orbit (propagated with satellite.js, vendor/satellite, MIT)
// Depends on helpers from index.html: $, esc, current, lastData, units, termBtn, TERMS, TERM_ORDER, scaleList, store,
// getJSON, fmtTime, moonIcon, moonPhase, coverDot, RAD; and from almanac.js: secOpen, skyPosition.

(() => {      // kept in its own scope so these names can't clash with the other scripts
const sky = { el: null, key: null, clouds: null, cloudsAt: 0, dark: null, darkErr: false, spotClouds: null, spotCloudsAt: 0, iss: null, issAt: 0, events: null, eventsKey: null, loading: false };
const KM_PER_MI = 1.609344;
const SKY_DIRS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const dirWord = (az) => SKY_DIRS[Math.round(((az % 360) + 360) % 360 / 45) % 8];
const dist = (km) => units === "F" ? `${Math.round(km / KM_PER_MI)} mi` : `${Math.round(km)} km`;
const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtDayTime = (d) => `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${fmtTime(d)}`;
const localNoon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const round10 = (n) => n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n);

// ---------- positions ----------
const observer = () => new Astronomy.Observer(current.lat, current.lon, 0);
function altAz(body, when, obs) {
  const eq = Astronomy.Equator(body, when, obs, true, true);
  const h = Astronomy.Horizon(when, obs, eq.ra, eq.dec, "normal");
  return { alt: h.altitude, az: h.azimuth };
}
function lookText(p) {
  if (p.alt > 70) return "almost straight overhead";
  return `${p.alt > 45 ? "high" : p.alt > 22 ? "halfway up" : "low"} in the ${dirWord(p.az)}`;
}
const moonLit = (when) => Astronomy.Illumination("Moon", when).phase_fraction;

// The dark part of a night: from when the Sun is 12° below the horizon in the evening until it's back there at dawn.
// Where summer nights never get that dark, fall back to 6° (the end of evening twilight).
function nightWindow(evening, obs) {
  for (const a of [-12, -6]) {
    const s = Astronomy.SearchAltitude("Sun", obs, -1, evening, 1, a);
    if (!s) continue;
    const e = Astronomy.SearchAltitude("Sun", obs, +1, s.date, 1, a);
    if (e) return { start: s.date, end: e.date, depth: a };
  }
  return null;
}
// The night we're in now, or the coming one: before dawn it's still last night.
function tonightEvening(obs) {
  const now = new Date();
  const noon = localNoon(now);
  if (now < noon) {
    const last = nightWindow(addDays(noon, -1), obs);
    if (last && now < last.end) return addDays(noon, -1);
  }
  return noon;
}

// ---------- clouds (Open-Meteo, hourly, total and by layer) ----------
async function loadClouds(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, forecast_days: 8, timeformat: "unixtime",
    hourly: "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability"
  });
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  const h = d.hourly;
  return h.time.map((s, i) => ({ t: new Date(s * 1000), cc: h.cloud_cover[i], low: h.cloud_cover_low?.[i], mid: h.cloud_cover_mid?.[i], high: h.cloud_cover_high?.[i], pop: h.precipitation_probability?.[i] }))
    .filter((x) => x.cc != null);
}
async function loadSpotClouds(spots) {
  if (!spots.length) return [];
  const q = new URLSearchParams({
    latitude: spots.map((s) => s.lat.toFixed(4)).join(","), longitude: spots.map((s) => s.lon.toFixed(4)).join(","),
    forecast_days: 3, timeformat: "unixtime", hourly: "cloud_cover"
  });
  let d = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!Array.isArray(d)) d = [d];
  return d.map((x) => x.hourly.time.map((s, i) => ({ t: new Date(s * 1000), cc: x.hourly.cloud_cover[i] })).filter((h) => h.cc != null));
}

// How good each hour is for stars: clear sky, and no bright moon up. 1 is perfect.
function hourQuality(cc, moonUp, lit) { return (1 - cc / 100) * (moonUp ? 1 - 0.65 * lit : 1); }
const RATINGS = [[0.8, "Excellent"], [0.6, "Good"], [0.35, "Fair"], [-1, "Poor"]];
const ratingFor = (q) => RATINGS.find(([min]) => q >= min)[1];

function analyzeNight(evening, hours, obs) {
  const win = nightWindow(evening, obs);
  if (!win) return null;
  const hs = (hours || []).filter((h) => h.t >= win.start.getTime() - 30 * 6e4 && h.t <= win.end.getTime() - 30 * 6e4).map((h) => {
    const m = altAz("Moon", h.t, obs), lit = moonLit(h.t);
    return { ...h, moonUp: m.alt > 0, lit, q: hourQuality(h.cc, m.alt > 0, lit) };
  });
  const midnight = new Date((win.start.getTime() + win.end.getTime()) / 2);
  const res = { evening, win, hours: hs, lit: moonLit(midnight), phase: moonPhase(midnight) };
  if (!hs.length) return res;
  // Best run of up to 3 hours in a row
  const k = Math.min(3, hs.length);
  let best = -1, at = 0;
  for (let i = 0; i + k <= hs.length; i++) {
    const q = hs.slice(i, i + k).reduce((a, h) => a + h.q, 0) / k;
    if (q > best) { best = q; at = i; }
  }
  const cloud = hs.reduce((a, h) => a + h.cc, 0) / hs.length;
  const highOnly = hs.filter((h) => h.cc >= 40 && (h.high ?? 0) >= 40 && (h.low ?? 0) < 20 && (h.mid ?? 0) < 20).length > hs.length / 2;
  const moonUpShare = hs.filter((h) => h.moonUp).length / hs.length;
  return Object.assign(res, { q: best, rating: ratingFor(best), bestFrom: hs[at].t, bestTo: new Date(Math.min(hs[at + k - 1].t.getTime() + 36e5, win.end.getTime())), cloud, highOnly, moonUpShare, complete: hs.length >= (win.end - win.start) / 36e5 - 1 });
}
function skyWords(cc) {
  return cc < 12 ? "Clear" : cc < 30 ? "Mostly clear" : cc < 60 ? "Partly cloudy" : cc < 85 ? "Mostly cloudy" : "Cloudy";
}
function nightForecast(evening) {
  if (!sky.clouds) return null;
  const n = analyzeNight(localNoon(evening), sky.clouds, observer());
  return n && n.hours.length && n.complete ? n : null;
}

// ---------- light pollution (estimated) ----------
// Walker's law: a town's glow at a spot grows with its population and fades with distance to the power 2.5.
// Added up over every town and city around, it gives the sky brightness in magnitudes per square arcsecond (SQM):
// about 22 is a truly dark sky, 18 or less is a city sky.
function skyBrightness(lat, lon, towns) {
  let r = 0;
  for (const tw of towns) {
    const d = Math.max(kmBetween(lat, lon, tw.lat, tw.lon), 0.5 * 0.014 * Math.sqrt(tw.pop), 1);
    r += 0.01 * tw.pop * Math.pow(d, -2.5);
  }
  return Math.min(22, 22 - 2.5 * Math.log10(1 + r));
}
const BORTLE = [
  [21.99, 1, "Truly dark", "The Milky Way casts shadows. Very rare."],
  [21.89, 2, "Very dark", "The Milky Way looks detailed, like marbled smoke."],
  [21.69, 3, "Rural", "The Milky Way is easy to see and shows lots of structure."],
  [20.49, 4, "Countryside edge", "The Milky Way is visible but washed out near the horizon."],
  [19.5, 5, "Suburban", "The Milky Way is faint and only overhead, if at all."],
  [18.94, 6, "Bright suburban", "No Milky Way. Only the brighter stars."],
  [18.38, 7, "Edge of a city", "The sky glows gray or orange. A few dozen bright stars."],
  [-99, 8, "City", "Only the Moon, planets and the brightest stars."]
];
const bortle = (sqm) => BORTLE.find(([min]) => sqm >= min);
// Faintest star you can see (naked-eye limiting magnitude) and roughly how many stars that means above the horizon.
const limitingMag = (sqm) => 7.93 - 5 * Math.log10(Math.pow(10, 4.316 - sqm / 5) + 1);
function starsVisible(lm) {
  const tbl = [[2, 50], [3, 170], [4, 515], [5, 1600], [6, 4800], [6.5, 8000], [7, 14000]];
  let n = tbl[0][1];
  for (let i = 1; i < tbl.length; i++) if (lm >= tbl[i - 1][0]) n = tbl[i - 1][1] * Math.pow(tbl[i][1] / tbl[i - 1][1], Math.min(1, (lm - tbl[i - 1][0]) / (tbl[i][0] - tbl[i - 1][0])));
  return round10(n / 2.4);           // half the sky is below the horizon, and haze hides stars near it
}
function kmBetween(a, b, c, d) {
  const x = Math.sin((c - a) * RAD / 2) ** 2 + Math.cos(a * RAD) * Math.cos(c * RAD) * Math.sin((d - b) * RAD / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}
function bearing(a, b, c, d) {
  const y = Math.sin((d - b) * RAD) * Math.cos(c * RAD);
  const x = Math.cos(a * RAD) * Math.sin(c * RAD) - Math.sin(a * RAD) * Math.cos(c * RAD) * Math.cos((d - b) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
// A box around a point, as Overpass wants it: south,west,north,east.
function bboxAround(lat, lon, km) {
  const dLat = km / 111.2, dLon = km / (111.2 * Math.max(0.1, Math.cos(lat * RAD)));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((n) => n.toFixed(4)).join(",");
}
// Bounding boxes use the server's spatial index, so they're fast even for huge forests and parks.
// "around:" has to measure the distance to every edge of every big area, which used to make this
// query run past the server's time limit. We trim to the real distance on the phone instead.
function overpassQuery(lat, lon) {
  const b = (km) => `(${bboxAround(lat, lon, km)})`;
  return `[out:json][timeout:90];
node["place"~"^(city|town)$"]${b(150)};out body qt;
(
  nwr["boundary"="national_park"]${b(90)};
  nwr["leisure"="nature_reserve"]["name"]${b(80)};
  nwr["boundary"="protected_area"]["name"]${b(80)};
  nwr["leisure"="park"]["name"]["park:type"]${b(80)};
  nwr["man_made"="observatory"]["name"]${b(90)};
  nwr["tourism"="viewpoint"]["name"]${b(50)};
)->.s;
node.s out body qt;
(way.s;relation.s;);out tags center bb qt;`;
}
// Ask the first server; if it hasn't answered in a few seconds (busy or rate-limited), ask the next
// one too, and take whichever good answer comes back first.
async function overpass(q) {
  const ctls = [], errs = [];
  const ask = async (url) => {
    const ctl = new AbortController(); ctls.push(ctl);
    const timer = setTimeout(() => ctl.abort(), 100000);
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }), signal: ctl.signal });
      if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
      const d = await r.json();
      if (/error|timed out|out of memory/i.test(d.remark || "")) throw new Error(d.remark);   // a partial answer would look falsely dark
      return d;
    } finally { clearTimeout(timer); }
  };
  let done = false, wait;
  try {
    return await new Promise((resolve, reject) => {
      let left = OVERPASS.length, next = 0;
      const fail = (e) => { errs.push(e); launch(); if (--left === 0) reject(errs[0]); };
      const launch = () => {
        clearTimeout(wait);
        if (done || next >= OVERPASS.length) return;
        ask(OVERPASS[next++]).then(resolve, fail);
        wait = setTimeout(launch, 8000);
      };
      launch();
    });
  } finally { done = true; clearTimeout(wait); ctls.forEach((c) => c.abort()); }
}
const titleCase = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function spotKind(tg) {
  if (tg.man_made === "observatory") return "Observatory";
  if (tg.tourism === "viewpoint") return "Scenic viewpoint";
  if (tg.boundary === "national_park") return tg.protection_title ? titleCase(tg.protection_title) : "National park";
  if (tg["park:type"]) return titleCase(tg["park:type"]);
  if (tg.protection_title) return titleCase(tg.protection_title);
  if (tg.leisure === "nature_reserve") return "Nature reserve";
  return "Protected land";
}
// Is any part of a big area's box within km of the point? (A forest's center can be far off while its edge is close.)
function boxNear(b, lat, lon, km) {
  const cLat = Math.min(Math.max(lat, b.minlat), b.maxlat), cLon = Math.min(Math.max(lon, b.minlon), b.maxlon);
  return kmBetween(lat, lon, cLat, cLon) <= km;
}
const parsePop = (s) => { const n = parseInt(String(s || "").replace(/[\s,.]/g, ""), 10); return isNaN(n) ? null : n; };

async function loadDarkSpots(lat, lon) {
  const ck = `lw.darksky.${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = store.get(ck);
  if (cached && Date.now() - cached.at < 30 * 864e5) return cached.v;
  const d = await overpass(overpassQuery(lat, lon));
  const maxKm = (tg) => tg.place === "city" ? 150 : tg.place === "town" ? 70 : tg.tourism === "viewpoint" ? 50
    : tg.boundary === "national_park" || tg.man_made === "observatory" ? 90 : 80;
  const towns = [], cands = [];
  for (const e of d.elements || []) {
    const tg = e.tags || {};
    const p = e.lat != null ? { lat: e.lat, lon: e.lon } : e.center;
    if (!p) continue;
    if (kmBetween(lat, lon, p.lat, p.lon) > maxKm(tg) && !(e.bounds && boxNear(e.bounds, lat, lon, maxKm(tg)))) continue;
    if (tg.place === "city" || tg.place === "town") { towns.push({ lat: p.lat, lon: p.lon, pop: parsePop(tg.population) || (tg.place === "city" ? 50000 : 8000) }); continue; }
    if (!tg.name || /private/.test(tg.access || "")) continue;
    let km2 = 0;
    if (e.bounds) { const b = e.bounds; km2 = (b.maxlat - b.minlat) * 111 * (b.maxlon - b.minlon) * 111 * Math.cos(p.lat * RAD); }
    const pointy = tg.man_made === "observatory" || tg.tourism === "viewpoint";
    if (!pointy && km2 < 1) continue;                       // small city parks are no darker than your yard
    cands.push({ name: tg.name, kind: spotKind(tg), lat: p.lat, lon: p.lon, km2, obs: tg.man_made === "observatory" });
  }
  const home = skyBrightness(lat, lon, towns);
  const seen = new Set();
  const scored = cands.filter((c) => { const k = c.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((c) => ({ ...c, km: kmBetween(lat, lon, c.lat, c.lon), az: bearing(lat, lon, c.lat, c.lon), sqm: skyBrightness(c.lat, c.lon, towns) }))
    .filter((c) => c.sqm - home >= 0.4 || (c.obs && c.sqm >= home - 0.2))
    .map((c) => ({ ...c, score: c.sqm - 0.015 * c.km + (c.obs ? 0.3 : 0) }))
    .sort((a, b) => b.score - a.score);
  // Up to five, not right next to each other; make sure the closest worthwhile one is in the list.
  const pick = [];
  const closest = [...scored].filter((c) => c.sqm - home >= 0.5).sort((a, b) => a.km - b.km)[0];
  for (const c of [closest, ...scored]) {
    if (!c || pick.length >= 5) continue;
    if (pick.some((p) => p === c || kmBetween(p.lat, p.lon, c.lat, c.lon) < 4)) continue;
    pick.push(c);
  }
  pick.sort((a, b) => a.km - b.km);
  const v = { home, spots: pick.map(({ name, kind, lat, lon, km, az, sqm, obs }) => ({ name, kind, lat, lon, km, az, sqm, obs })), towns: towns.length };
  store.set(ck, { at: Date.now(), v });
  return v;
}

// ---------- meteor showers ----------
// Peak = when Earth reaches the same spot in its orbit each year (solar longitude, J2000), from the
// International Meteor Organization. ZHR = meteors an hour under a perfect dark sky with the radiant overhead.
const SHOWERS = [
  { id: "quadrantids", name: "Quadrantids", lam: 283.15, zhr: 80, ra: 230, dec: 49, v: 41, from: "asteroid 2003 EH1, which may be a burnt-out comet", note: "A sharp peak lasting only a few hours, so timing matters." },
  { id: "lyrids", name: "Lyrids", lam: 32.32, zhr: 18, ra: 271, dec: 34, v: 49, from: "Comet Thatcher, which last came by in 1861", note: "One of the oldest known showers: people in China recorded it 2,700 years ago." },
  { id: "etaaquariids", name: "Eta Aquariids", lam: 45.5, zhr: 50, ra: 338, dec: -1, v: 66, from: "Halley's Comet", note: "Best before dawn, and much better the farther south you are." },
  { id: "sdaquariids", name: "Southern Delta Aquariids", lam: 127, zhr: 25, ra: 340, dec: -16, v: 41, from: "Comet 96P/Machholz", note: "Faint meteors that run for weeks around late July, overlapping the start of the Perseids." },
  { id: "capricornids", name: "Alpha Capricornids", lam: 127, zhr: 5, ra: 307, dec: -10, v: 23, from: "Comet 169P/NEAT", note: "Few meteors, but slow and often bright fireballs." },
  { id: "perseids", name: "Perseids", lam: 140.0, zhr: 100, ra: 48, dec: 58, v: 59, from: "Comet Swift-Tuttle", note: "The summer favorite: fast, bright meteors on warm nights." },
  { id: "draconids", name: "Draconids", lam: 195.4, zhr: 10, ra: 262, dec: 54, v: 21, from: "Comet Giacobini-Zinner", note: "Usually quiet, but it has surprised people with storms of hundreds an hour. Best in the evening, unlike most showers." },
  { id: "orionids", name: "Orionids", lam: 208, zhr: 20, ra: 95, dec: 16, v: 66, from: "Halley's Comet", note: "Fast meteors that often leave glowing trails for a second or two." },
  { id: "taurids", name: "Northern Taurids", lam: 230, zhr: 5, ra: 58, dec: 22, v: 29, from: "Comet Encke", note: "Slow and few, but known for big, bright fireballs. Active for weeks around early November." },
  { id: "leonids", name: "Leonids", lam: 235.27, zhr: 15, ra: 152, dec: 22, v: 71, from: "Comet Tempel-Tuttle", note: "The fastest meteors of the year. Every 33 years or so it can storm with thousands an hour." },
  { id: "geminids", name: "Geminids", lam: 262.2, zhr: 150, ra: 112, dec: 33, v: 35, from: "asteroid 3200 Phaethon, a rare shower that comes from a rock instead of a comet", note: "The richest shower of the year, with bright, colorful meteors. Good from mid-evening, not just before dawn." },
  { id: "ursids", name: "Ursids", lam: 270.7, zhr: 10, ra: 217, dec: 76, v: 33, from: "Comet Tuttle", note: "A small shower around the winter solstice, near the Little Dipper." }
];
function sunLonJ2000(when) {
  const v = Astronomy.RotateVector(Astronomy.Rotation_EQJ_ECL(), Astronomy.GeoVector("Sun", when, false));
  return Astronomy.SphereFromVector(v).lon;
}
// Next time the Sun reaches solar longitude `lam`, starting from `from`
function nextSolarLon(lam, from) {
  let t = addDays(from, (((lam - sunLonJ2000(from)) % 360) + 360) % 360 / 0.98565);
  for (let i = 0; i < 4; i++) {
    const diff = ((lam - sunLonJ2000(t) + 540) % 360) - 180;
    t = addDays(t, diff / 0.98565);
  }
  return t;
}
// The night whose middle (about 1 AM) is closest to the peak moment, named by its evening.
const nightOf = (peak) => addDays(localNoon(new Date(peak.getTime() + 11 * 36e5)), -1);

function showerDetails(sh, peak, obs) {
  const evening = nightOf(peak), win = nightWindow(evening, obs);
  if (!win) return null;
  let best = null;
  for (let t = win.start.getTime(); t <= win.end.getTime(); t += 15 * 6e4) {
    const p = skyPosition(sh.ra / 15, sh.dec, current.lat, current.lon, new Date(t));
    if (!best || p.alt > best.alt) best = { alt: p.alt, az: p.az, t: new Date(t) };
  }
  const moonUp = altAz("Moon", best.t, obs).alt > 0, lit = moonLit(best.t);
  // Hourly rate seen = ZHR × sin(radiant altitude) × r^(limiting mag − 6.5); r ≈ 2.5 for a typical shower.
  const rate = (lm) => best.alt <= 0 ? 0 : Math.round(sh.zhr * Math.sin(best.alt * RAD) * Math.pow(2.5, Math.min(0, lm - 6.5)));
  const moonCut = moonUp ? 1.2 * lit : 0;              // a bright moon hides the faint ones
  const homeLm = sky.dark ? limitingMag(sky.dark.home) : 5;
  return { evening, best, moonUp, lit, homeRate: rate(homeLm - moonCut), darkRate: rate(6.5 - moonCut) };
}

// ---------- events ----------
const MOON_NAMES = ["Wolf", "Snow", "Worm", "Pink", "Flower", "Strawberry", "Buck", "Sturgeon", "Corn", "Hunter's", "Beaver", "Cold"];
function fullMoonName(t) {
  const eq = Astronomy.Seasons(t.getFullYear()).sep_equinox.date.getTime(), half = 14.77 * 864e5;
  if (Math.abs(t - eq) <= half) return "Harvest Moon";
  if (Math.abs(t - eq - 29.53 * 864e5) <= half) return "Hunter's Moon";
  const prev = addDays(t, -29.53);
  if (prev.getMonth() === t.getMonth() && prev.getFullYear() === t.getFullYear()) return "Blue Moon";
  const m = t.getMonth();
  return `${MOON_NAMES[m]} Moon`;
}
const PLANETS = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const PLANET_LOOK = {
  Mercury: "A small, pinkish dot close to the horizon in twilight. The planet closest to the Sun, and the hardest to catch.",
  Venus: "Dazzling white: the brightest thing in the sky after the Sun and Moon. It's often mistaken for a plane's landing light.",
  Mars: "Orange-red and steady. Its color comes from rusty dust covering the whole planet.",
  Jupiter: "Very bright and creamy white. Binoculars held steady show up to four of its moons as tiny dots in a line.",
  Saturn: "Steady and golden. Any small telescope shows its rings, which never fails to get a gasp."
};

// Morning and evening "dark enough to see planets" moments for a date: Sun 8° below the horizon.
function twilightTimes(evening, obs) {
  const ev = Astronomy.SearchAltitude("Sun", obs, -1, evening, 1, -8);
  const mo = ev ? Astronomy.SearchAltitude("Sun", obs, +1, ev.date, 1, -8) : null;
  return { evening: ev?.date || null, morning: mo?.date || null };
}
// When and where a pair of objects can be seen together around a moment: evening or morning sky, or not at all.
function pairVisibility(a, b, when, obs) {
  const tw = twilightTimes(nightOf(when), obs), out = [];
  for (const [label, t] of [["evening", tw.evening], ["morning", tw.morning]]) {
    if (!t) continue;
    const pa = altAz(a, t, obs), pb = altAz(b, t, obs);
    if (Math.min(pa.alt, pb.alt) > 6) out.push({ label, t, p: pa });
  }
  return out.sort((x, y) => y.p.alt - x.p.alt)[0] || null;
}

function computeEvents(obs, from, days) {
  const end = addDays(from, days), ev = [];
  const north = current.lat >= 0;

  // Full and new moons
  for (let mq = Astronomy.SearchMoonQuarter(from); mq.time.date < end; mq = Astronomy.NextMoonQuarter(mq)) {
    const t = mq.time.date;
    if (mq.quarter === 2) {
      const km = Astronomy.GeoMoon(t).Length() * Astronomy.KM_PER_AU, name = fullMoonName(t);
      const rise = Astronomy.SearchRiseSet("Moon", obs, +1, addDays(localNoon(t), -0.25), 1.5);
      const sup = km < 362000;
      ev.push({ t, kind: "moon", tag: sup ? "Supermoon" : "Full moon", icon: { illum: 1, waxing: true }, title: `Full moon: the ${name}${sup ? ", a supermoon" : ""}`, term: sup ? "supermoon" : "fullmoon",
        text: `${name === "Blue Moon" ? "The second full moon this month, which is what a Blue Moon means. It doesn't actually look blue. " : name === "Harvest Moon" ? "The full moon closest to the fall equinox. For several nights it rises soon after sunset, which once gave farmers extra light to bring in crops. " : ""}${sup ? `It's only ${Math.round(km / (units === "F" ? KM_PER_MI : 1)).toLocaleString()} ${units === "F" ? "miles" : "km"} away, close enough to look up to about 7% bigger and 15% brighter than an average full moon. ` : ""}${rise ? `Moonrise around ${fmtTime(rise.date)}${rise.date.getDate() !== t.getDate() ? ` on ${rise.date.toLocaleDateString(undefined, { weekday: "long" })}` : ""}, low in the east: that's when it looks biggest next to trees and buildings.` : ""}` });
    } else if (mq.quarter === 0) {
      ev.push({ t, kind: "moon", tag: "New moon", icon: { illum: 0, waxing: true }, title: "New moon: darkest nights of the month", term: "newmoon",
        text: "The Moon is between Earth and the Sun, so its lit side faces away from us. The few nights around now are the best of the month for faint stars, the Milky Way and meteors." });
    }
  }

  // Meteor showers (always include the next big one even if it's past the window)
  const showers = [];
  for (const sh of SHOWERS) {
    const peak = nextSolarLon(sh.lam, addDays(from, -1.5));
    showers.push({ sh, peak });
  }
  showers.sort((a, b) => a.peak - b.peak);
  const nextBig = showers.find((s) => s.sh.zhr >= 50);
  for (const { sh, peak } of showers) {
    if (peak > end && !(nextBig && nextBig.sh === sh)) continue;
    const d = showerDetails(sh, peak, obs);
    if (!d) continue;
    const ok = d.best.alt > 10;
    const long = (x) => x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const when = `the night of ${long(d.evening)} into ${long(addDays(d.evening, 1))}`;
    ev.push({ t: d.evening, kind: "meteor", tag: "Meteor shower", term: "meteor", title: `${sh.name} meteor shower peaks`, night: d.evening, big: sh.zhr >= 50, peak,
      text: `${ok ? `Best ${when}, around ${fmtTime(new Date(Math.round(d.best.t / 18e5) * 18e5))}, when the ${termBtn("radiant", "radiant")} is ${lookText(d.best)}. You don't need to look at the radiant: meteors streak across the whole sky, so lie back and take in as much sky as you can.` : `The ${termBtn("radiant", "radiant")} stays low or below the horizon from here, so you'll see few, if any.`} `
        + `${ok ? `Under a dark sky you might see up to ${plural(d.darkRate, "meteor")} an hour; from ${sky.dark ? "your neighborhood" : "a typical suburb"}, ${d.homeRate >= 1 ? `more like ${d.homeRate}` : "probably none"}. ` : ""}`
        + `${d.moonUp && d.lit > 0.4 ? `A ${Math.round(d.lit * 100)}% moon will be up, which hides the fainter ones. ` : d.lit < 0.25 || !d.moonUp ? "The Moon is out of the way, which helps a lot. " : ""}`
        + `These are bits of ${esc(sh.from)}, hitting our air at ${units === "F" ? `${Math.round(sh.v * 2237).toLocaleString()} mph` : `${sh.v} km a second`}. ${esc(sh.note)}` });
  }

  // Eclipses: lunar ones are seen by everyone on the night side of Earth; solar ones only along a path.
  const ecEnd = addDays(from, 3 * 365);
  for (let e = Astronomy.SearchLunarEclipse(from); e.peak.date < ecEnd; e = Astronomy.NextLunarEclipse(e.peak)) {
    if (e.kind === "penumbral" && e.peak.date > end) continue;            // too subtle to list far ahead
    const pk = e.peak.date.getTime(), semi = (e.kind === "total" ? e.sd_total : e.kind === "partial" ? e.sd_partial : e.sd_penum) * 6e4;
    const samples = [pk - semi, pk, pk + semi].map((t) => ({ t: new Date(t), alt: altAz("Moon", new Date(t), obs).alt, sun: altAz("Sun", new Date(t), obs).alt }));
    const seen = samples.filter((s) => s.alt > 0 && s.sun < -3);
    if (!seen.length) continue;
    const label = e.kind === "total" ? "Total lunar eclipse" : e.kind === "partial" ? "Partial lunar eclipse" : "Penumbral lunar eclipse";
    const peakSeen = samples[1].alt > 0 && samples[1].sun < -3;
    ev.push({ t: new Date(pk), kind: "eclipse", tag: "Lunar eclipse", term: "lunareclipse", title: label, night: nightOf(new Date(pk)), big: e.kind !== "penumbral",
      text: `${e.kind === "total" ? `The whole Moon slips into Earth's shadow and turns a coppery red for about ${Math.round(e.sd_total * 2)} minutes.` : e.kind === "partial" ? `Earth's shadow takes a dark bite out of the Moon: up to ${Math.round(e.obscuration * 100)}% of it.` : "The Moon passes through the faint outer edge of Earth's shadow and dims slightly. Easy to miss."} `
        + `${peakSeen ? `The middle comes at ${fmtDayTime(new Date(pk))}, with the Moon ${lookText(altAz("Moon", new Date(pk), obs))}.` : `From here you'll see part of it: ${seen.map((s) => fmtDayTime(s.t)).join(" to ")}.`} It's safe to watch with your eyes, binoculars or a telescope.` });
  }
  let solarCount = 0;
  for (let s = Astronomy.SearchLocalSolarEclipse(from, obs), n = 0; n < 12 && s; n++, s = Astronomy.NextLocalSolarEclipse(s.peak.time, obs)) {
    const pk = s.peak.time.date;
    const up = Math.max(s.partial_begin.altitude, s.peak.altitude, s.partial_end.altitude) > 0;
    if (!up) continue;
    if (pk > ecEnd && solarCount > 0) break;
    solarCount++;
    const label = s.kind === "total" ? "Total solar eclipse" : s.kind === "annular" ? "Annular solar eclipse (ring of fire)" : "Partial solar eclipse";
    ev.push({ t: pk, kind: "eclipse", tag: "Solar eclipse", term: "solareclipse", title: `${label}${pk > ecEnd ? ", the next one you can see from here" : ""}`, big: true,
      text: `The Moon passes in front of the Sun${s.kind === "partial" ? `, covering about ${Math.round(s.obscuration * 100)}% of it from here` : s.kind === "annular" ? ", leaving a ring of sunlight" : " and blocks it completely: the sky goes dark and the Sun's glowing outer atmosphere appears"}. `
        + `It starts at ${fmtTime(s.partial_begin.time.date)}, peaks at ${fmtTime(pk)} with the Sun ${lookText({ alt: s.peak.altitude, az: altAz("Sun", pk, obs).az })}, and ends at ${fmtTime(s.partial_end.time.date)}. `
        + `<b>Never look at the Sun without certified eclipse glasses (ISO 12312-2), not even when it's mostly covered.</b> Sunglasses aren't safe. A pinhole in a piece of card makes a safe projected image.` });
    if (pk > ecEnd) break;
  }

  // Planets: oppositions and greatest elongations
  for (const p of ["Mars", "Jupiter", "Saturn"]) {
    const t = Astronomy.SearchRelativeLongitude(p, 0, from).date;
    if (t > end) continue;
    const mag = Astronomy.Illumination(p, t).mag;
    ev.push({ t, kind: "planet", tag: "Planet", term: "opposition", title: `${p} at opposition`, planet: p,
      text: `Earth passes between ${p} and the Sun, so ${p} is at its closest and brightest for the year (magnitude ${mag.toFixed(1)}). It rises at sunset, is highest around midnight and sets at sunrise. ${PLANET_LOOK[p]}` });
  }
  for (const p of ["Mercury", "Venus"]) {
    for (let s = from, i = 0; i < 3; i++) {
      const e = Astronomy.SearchMaxElongation(p, s);
      if (e.time.date > end) break;
      const tw = twilightTimes(localNoon(e.time.date), obs);
      const at = e.visibility === "evening" ? tw.evening : tw.morning;
      const pos = at ? altAz(p, at, obs) : null;
      ev.push({ t: e.time.date, kind: "planet", tag: "Planet", term: "elongation", title: `${p} at its farthest from the Sun (${e.visibility} sky)`, planet: p,
        text: `${p} swings out to ${Math.round(e.elongation)}° from the Sun, its best ${e.visibility} showing for a while.${pos && pos.alt > 3 ? ` Look ${lookText(pos)} ${e.visibility === "evening" ? "about 45 minutes after sunset" : "about 45 minutes before sunrise"}.` : " From your latitude it stays quite low, so you'll need a clear, flat horizon."} ${PLANET_LOOK[p]}` });
      s = addDays(e.time.date, 20);
    }
  }

  // Close pairings: the Moon next to a planet, or two planets close together
  const vec = (b, t) => Astronomy.GeoVector(b, t, true);
  for (const p of PLANETS) {
    let prev = null, prev2 = null;
    for (let t = from.getTime(); t < end.getTime(); t += 3 * 36e5) {
      const sep = Astronomy.AngleBetween(vec("Moon", new Date(t)), vec(p, new Date(t)));
      if (prev && prev2 && prev.sep < prev2.sep && prev.sep < sep && prev.sep < 4) {
        const elong = Astronomy.AngleFromSun(p, prev.t);
        const vis = elong > 15 && pairVisibility("Moon", p, prev.t, obs);
        if (vis) ev.push({ t: prev.t, kind: "pair", tag: "Close pairing", term: "conjunction", title: `The Moon passes ${p}`, night: nightOf(prev.t), planet: p,
          text: `They'll be about ${Math.max(1, Math.round(prev.sep))}° apart (${prev.sep < 2 ? "less than a finger's width" : "about two fingers"} at arm's length). Look ${lookText(vis.p)} in the ${vis.label} around ${fmtTime(vis.t)}. ${p} is the bright "star" right next to the Moon.` });
      }
      prev2 = prev; prev = { t: new Date(t), sep };
    }
  }
  for (let i = 0; i < PLANETS.length; i++) for (let j = i + 1; j < PLANETS.length; j++) {
    const a = PLANETS[i], b = PLANETS[j];
    let prev = null, prev2 = null;
    for (let t = from.getTime(); t < end.getTime(); t += 864e5) {
      const sep = Astronomy.AngleBetween(vec(a, new Date(t)), vec(b, new Date(t)));
      if (prev && prev2 && prev.sep < prev2.sep && prev.sep < sep && prev.sep < 3) {
        const vis = Math.min(Astronomy.AngleFromSun(a, prev.t), Astronomy.AngleFromSun(b, prev.t)) > 12 && pairVisibility(a, b, prev.t, obs);
        if (vis) ev.push({ t: prev.t, kind: "pair", tag: "Close pairing", term: "conjunction", title: `${a} and ${b} side by side`, night: nightOf(prev.t),
          text: `The two planets appear only ${prev.sep < 1 ? "a fraction of a degree" : `about ${Math.round(prev.sep)}°`} apart. They're really hundreds of millions of miles from each other; they just line up from where we stand. Look ${lookText(vis.p)} in the ${vis.label} around ${fmtTime(vis.t)}.` });
      }
      prev2 = prev; prev = { t: new Date(t), sep };
    }
  }

  // Equinoxes and solstices
  for (const y of [from.getFullYear(), from.getFullYear() + 1]) {
    const s = Astronomy.Seasons(y);
    for (const [k, title, nWord, sWord] of [["mar_equinox", "March equinox", "spring", "fall"], ["jun_solstice", "June solstice", "summer", "winter"], ["sep_equinox", "September equinox", "fall", "spring"], ["dec_solstice", "December solstice", "winter", "summer"]]) {
      const t = s[k].date;
      if (t < from || t > end) continue;
      const season = north ? nWord : sWord, eq = k.includes("equinox");
      ev.push({ t, kind: "season", tag: "Season", term: "solstice", title: `${title}: first day of ${season}`,
        text: eq ? "Day and night are about the same length everywhere on Earth. The Sun rises due east and sets due west, a handy way to find directions."
          : (season === "winter" ? "The shortest day and longest night of the year. From here on, the days get longer." : "The longest day and shortest night of the year. The Sun rises and sets as far north as it ever does.") });
    }
  }
  return ev.filter((e) => e.t >= addDays(from, -1)).sort((a, b) => a.t - b.t);
}

// ---------- planets tonight ----------
function planetsTonight(evening, obs) {
  const tw = twilightTimes(evening, obs), out = [];
  if (!tw.evening) return out;
  for (const p of PLANETS) {
    const ev = altAz(p, tw.evening, obs), mo = tw.morning ? altAz(p, tw.morning, obs) : null, mid = altAz(p, new Date((tw.evening.getTime() + (tw.morning || tw.evening).getTime()) / 2), obs);
    const mag = Astronomy.Illumination(p, tw.evening).mag;
    let when = null;
    if (ev.alt > 8) {
      const set = Astronomy.SearchRiseSet(p, obs, -1, tw.evening, 1);
      when = { pos: ev, at: tw.evening, words: `In the evening, ${lookText(ev)}${set && tw.morning && set.date < tw.morning ? `. Sets around ${fmtTime(set.date)}` : ". Up all night"}` };
    } else if (mid.alt > 15) {
      const rise = Astronomy.SearchRiseSet(p, obs, +1, tw.evening, 1);
      when = { pos: mid, at: mid, words: `Rises around ${rise ? fmtTime(rise.date) : "late evening"}, ${lookText(mid)} by the middle of the night` };
    } else if (mo && mo.alt > 8) {
      const rise = Astronomy.SearchRiseSet(p, obs, +1, tw.evening, 1);
      when = { pos: mo, at: tw.morning, words: `Before dawn, ${lookText(mo)}${rise ? `. Rises around ${fmtTime(rise.date)}` : ""}` };
    }
    if (when) out.push({ name: p, mag, ...when });
  }
  return out;
}
const brightWords = (mag) => mag < -3 ? "Brighter than anything but the Sun and Moon" : mag < -1.4 ? "Brighter than any star" : mag < 0.5 ? "As bright as the brightest stars" : mag < 2 ? "Like a fairly bright star" : "Faint: you'll want a dark sky";

// ---------- the space station ----------
async function loadIssTle() {
  const cached = store.get("lw.isstle");
  if (cached && Date.now() - cached.at < 12 * 36e5) return cached.tle;
  let tle = null;
  try {
    const txt = await (await fetch("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE")).text();
    const lines = txt.trim().split(/\r?\n/).map((s) => s.trim());
    const i = lines.findIndex((s) => s.startsWith("1 "));
    if (i >= 0 && lines[i + 1]?.startsWith("2 ")) tle = [lines[i], lines[i + 1]];
  } catch { /* try the backup */ }
  if (!tle) {
    const j = await getJSON("https://tle.ivanstanojevic.me/api/tle/25544");
    if (j.line1 && j.line2) tle = [j.line1, j.line2];
  }
  if (!tle) throw new Error("no orbit data");
  store.set("lw.isstle", { at: Date.now(), tle });
  return tle;
}
// Visible passes: the station is above 10°, our sky is dark, and the station itself is still in sunlight.
function issPasses(tle, lat, lon, hours = 72) {
  const sat = satellite.twoline2satrec(tle[0], tle[1]);
  const gd = { latitude: lat * RAD, longitude: lon * RAD, height: 0 };
  const obs = new Astronomy.Observer(lat, lon, 0);
  const passes = [];
  let cur = null;
  const start = Date.now();
  for (let t = start; t < start + hours * 36e5; t += 20e3) {
    const d = new Date(t);
    const pv = satellite.propagate(sat, d);
    if (!pv || !pv.position) continue;
    const look = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, satellite.gstime(d)));
    const el = look.elevation / RAD;
    if (el > 10) {
      const sunAlt = altAz("Sun", d, obs).alt;
      const s = Astronomy.GeoVector("Sun", d, false), sl = Math.hypot(s.x, s.y, s.z);
      const r = pv.position, proj = (r.x * s.x + r.y * s.y + r.z * s.z) / sl;
      const perp = Math.sqrt(Math.max(0, r.x ** 2 + r.y ** 2 + r.z ** 2 - proj ** 2));
      const lit = proj > 0 || perp > 6371;
      const visible = sunAlt < -6 && lit;
      if (!cur) cur = { samples: [] };
      cur.samples.push({ t: d, el, az: look.azimuth / RAD, visible });
    } else if (cur) {
      const v = cur.samples.filter((s) => s.visible);
      if (v.length >= 3) {
        const top = v.reduce((a, s) => s.el > a.el ? s : a, v[0]);
        passes.push({ start: v[0].t, end: v[v.length - 1].t, from: v[0].az, to: v[v.length - 1].az, top });
      }
      cur = null;
    }
    if (passes.length >= 6) break;
  }
  return passes;
}

// ---------- rendering ----------
function skyPanel() {
  if (sky.el) return sky.el;
  const el = document.createElement("section");
  el.className = "panel almanac nightsky";
  el.setAttribute("aria-label", "Night sky");
  sky.el = el;
  return el;
}
const rateChip = (r) => `<span class="rate rate-${r.toLowerCase()}">${r}</span>`;
function cloudCell(h) {
  return `<div class="nh${h.q >= 0.6 ? " good" : ""}"><div class="t">${fmtHourShort(h.t)}</div>${coverDot(Math.round(h.cc / 12.5))}<div class="cc">${Math.round(h.cc)}%</div><div class="mn">${h.moonUp ? moonIcon(moonPhase(h.t), 12) : ""}</div></div>`;
}
const fmtHourShort = (d) => d.toLocaleTimeString(undefined, { hour: "numeric" }).replace(/\s?([AP])M/i, (m, x) => x.toLowerCase());

function renderSky() {
  const el = sky.el;
  if (!el || !current || typeof Astronomy === "undefined") return;
  const obs = observer(), now = new Date();
  let html = `<details class="alm-all" data-sec="nightsky"${secOpen("nightsky")}>%%SUMMARY%%<div class="alm-body">`;

  // Events are slow-ish to work out, so do it once per place per hour.
  const ek = `${current.lat.toFixed(2)},${current.lon.toFixed(2)},${Math.floor(now / 36e5)},${sky.dark ? 1 : 0}`;
  if (sky.eventsKey !== ek) { try { sky.events = computeEvents(obs, now, 60); } catch (e) { console.warn("sky events", e); sky.events = []; } sky.eventsKey = ek; }
  const events = sky.events || [];

  // Headline: something big in the next few days
  const soon = events.find((e) => (e.big || e.kind === "eclipse") && e.t - now < 4 * 864e5 && e.t > addDays(now, -1));
  if (soon) {
    const n = soon.night ? nightForecast(soon.night) : null;
    html += `<div class="sky-soon"><b>${soon.night && dayKey(soon.night) === dayKey(tonightEvening(obs)) ? "Tonight" : esc(fmtDate(soon.night || soon.t))}:</b> ${esc(soon.title)}${n ? ` · forecast ${rateChip(n.rating)}` : ""}</div>`;
  }

  // 1. Tonight
  const ev0 = tonightEvening(obs), nights = [];
  for (let i = 0; i < 7; i++) { const n = sky.clouds ? analyzeNight(addDays(ev0, i), sky.clouds, obs) : null; if (n && n.hours.length) nights.push(n); }
  const tn = nights[0];
  html += `<details class="alm-sec" data-sec="skytonight"${secOpen("skytonight")}><summary><h3>${termBtn("stargazing", "Stargazing forecast")}</h3></summary>`;
  if (!sky.clouds) html += `<p class="hint">${sky.loading ? "Loading the cloud forecast…" : "The cloud forecast needs a connection."}</p>`;
  else if (!tn) html += `<p>${nightWindow(ev0, obs) ? "No cloud forecast for tonight yet." : "The sky doesn't get properly dark here at this time of year."}</p>`;
  else {
    const mp = tn.phase;
    html += `<p>Tonight looks ${rateChip(tn.rating)}.
      ${tn.q >= 0.35 ? `Best from <b>${fmtTime(tn.bestFrom)} to ${fmtTime(tn.bestTo)}</b>.` : ""}
      ${skyWords(tn.cloud)} overall (${Math.round(tn.cloud)}% ${termBtn("cloudcover", "cloud cover")})${tn.highOnly ? ", mostly thin, high clouds that dim stars rather than hide them" : ""}.
      ${tn.moonUpShare === 0 ? "The Moon stays out of the way." : `The Moon is ${Math.round(mp.illum * 100)}% lit and up for ${tn.moonUpShare > 0.9 ? "the whole night" : tn.moonUpShare > 0.5 ? "most of the night" : "part of the night"}${mp.illum > 0.6 ? ", so it will wash out fainter stars while it's up" : ""}.`}
      Dark from ${fmtTime(tn.win.start)} to ${fmtTime(tn.win.end)}.</p>
      <div class="nhours" role="list" aria-label="Cloud cover by hour tonight">${tn.hours.map(cloudCell).join("")}</div>
      <p class="hint">Dots show how much of the sky is cloudy. A small moon means it's up. Highlighted hours are the clearest and darkest.</p>`;
    if (nights.length > 1) html += `<div class="nights">${nights.slice(1).map((n) => `<div class="night"><div class="nd">${esc(n.evening.toLocaleDateString(undefined, { weekday: "short" }))}</div>${rateChip(n.rating)}<div class="ns">${coverDot(Math.round(n.cloud / 12.5))} ${Math.round(n.cloud)}% cloud</div><div class="ns">${moonIcon(n.phase, 14)} ${Math.round(n.phase.illum * 100)}% moon</div></div>`).join("")}</div>`;
  }
  html += `</details>`;

  // 2. Coming up
  html += `<details class="alm-sec" data-sec="skyevents"${secOpen("skyevents")}><summary><h3>Coming up in the sky</h3></summary>`;
  if (!events.length) html += `<p class="hint">Working out what's coming up…</p>`;
  else {
    const evHtml = (e) => {
      const n = e.night ? nightForecast(e.night) : null;
      const dd = e.night || e.t;
      const k = esc(`${e.kind}|${dayKey(dd)}|${e.title}`);
      return `<details class="sky-ev ev-${e.kind}" data-k="${k}"><summary><div class="ev-date"><b>${esc(dd.toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</b><span>${esc(dd.toLocaleDateString(undefined, { weekday: "short" }))}${dd.getFullYear() !== now.getFullYear() ? ` ${dd.getFullYear()}` : ""}</span></div>
        <div class="ev-main"><div class="ev-tag">${e.icon ? moonIcon(e.icon, 14) : ""}${termBtn(e.term, esc(e.tag))}</div><div class="ev-title">${esc(e.title)}</div>
        ${n ? `<div class="ev-fc">Forecast for that night: ${rateChip(n.rating)} ${skyWords(n.cloud).toLowerCase()}, ${Math.round(n.cloud)}% cloud</div>` : ""}</div></summary>
        <div class="ev-body"><p>${e.text}</p></div></details>`;
    };
    const first = events.slice(0, 6), rest = events.slice(6);
    html += `<p class="hint">Tap an event for when and where to look.</p><div class="sky-evs">${first.map(evHtml).join("")}</div>`;
    if (rest.length) html += `<details class="sky-more" data-k="more"><summary>${rest.length} more coming up</summary><div class="sky-evs">${rest.map(evHtml).join("")}</div></details>`;
    html += `<p class="hint">Times are for your location. Eclipses are listed up to three years ahead, everything else for the next two months.</p>`;
  }
  html += `</details>`;

  // 3. Where to watch
  html += `<details class="alm-sec" data-sec="skyspots"${secOpen("skyspots")}><summary><h3>${termBtn("lightpollution", "Darker skies near you")}</h3></summary>`;
  const dk = sky.dark;
  if (!dk) html += `<p class="hint">${sky.darkErr ? "Couldn't reach the map data right now. It'll try again next time the forecast refreshes." : "Looking for parks and dark places nearby…"}</p>`;
  else {
    const hb = bortle(dk.home), hlm = limitingMag(dk.home);
    html += `<p>Your sky is about <b>${termBtn("bortle", `Bortle ${hb[1]}`)}</b> (${esc(hb[2].toLowerCase())}): on a clear, moonless night you can see roughly <b>${starsVisible(hlm).toLocaleString()} stars</b>. ${esc(hb[3])}</p>`;
    if (!dk.spots.length) html += `<p>We couldn't find a noticeably darker park or reserve within about ${units === "F" ? "50 miles" : "80 km"}.</p>`;
    else {
      const tonightClouds = (i) => {
        const hrs = sky.spotClouds?.[i];
        const w = nightWindow(ev0, obs);
        if (!hrs || !w) return null;
        const hs = hrs.filter((h) => h.t >= w.start && h.t <= w.end);
        return hs.length ? hs.reduce((a, h) => a + h.cc, 0) / hs.length : null;
      };
      html += `<div class="spots">${dk.spots.map((s, i) => {
        const b = bortle(s.sqm), more = starsVisible(limitingMag(s.sqm)) / starsVisible(hlm), cc = tonightClouds(i);
        return `<div class="spot"><div class="sc-top"><b>${esc(s.name)}</b><span class="where">${esc(dist(s.km))} ${esc(dirWord(s.az))}</span></div>
          <div class="sp-kind">${esc(s.kind)} · Bortle ${b[1]}, ${esc(b[2].toLowerCase())}</div>
          <p>${more >= 1.3 ? `About ${more >= 10 ? Math.round(more) : more.toFixed(1)} times as many stars as at home.` : "A little darker than home."}${b[1] <= 4 ? " The Milky Way should show on moonless nights." : ""}${s.obs ? " Observatories often hold free public viewing nights: check their website." : ""}</p>
          ${cc != null ? `<p class="sp-cc">${coverDot(Math.round(cc / 12.5))} Tonight: ${skyWords(cc).toLowerCase()} (${Math.round(cc)}% cloud)</p>` : ""}
          <a class="sp-go" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat.toFixed(5)},${s.lon.toFixed(5)}" target="_blank" rel="noopener">Directions</a></div>`; }).join("")}</div>`;
    }
    html += `<p class="hint">Sky darkness is estimated from the size of nearby towns and how far away they are, using park and town data from OpenStreetMap. Many parks close at dusk, so check hours, and some host star parties. For satellite measurements, see the <a href="https://www.lightpollutionmap.info/#zoom=9&lat=${current.lat.toFixed(4)}&lon=${current.lon.toFixed(4)}" target="_blank" rel="noopener">light pollution map</a>.</p>`;
  }
  html += `</details>`;

  // 4. Planets tonight
  const pl = planetsTonight(ev0, obs);
  html += `<details class="alm-sec" data-sec="skyplanets"${secOpen("skyplanets")}><summary><h3>${termBtn("planets", "Planets tonight")}</h3></summary>`;
  html += pl.length ? `<div class="stars">${pl.map((p) => `<div class="star-card"><div class="sc-top"><b>${p.name}</b><span class="where">${esc(brightWords(p.mag))}</span></div><p>${esc(p.words)}.</p><p class="fact">${esc(PLANET_LOOK[p.name])}</p></div>`).join("")}</div>
    <p class="hint">How to tell a planet from a star: stars twinkle, planets mostly shine steadily.</p>` : `<p>None of the bright planets are well placed tonight. They're too close to the Sun to see.</p>`;
  html += `</details>`;

  // 5. Constellations (the stars to find tonight, next to the planets)
  let st = null;
  try { st = typeof starsTonight === "function" && lastData ? starsTonight(lastData) : null; } catch { st = null; }
  if (st) {
    html += `<details class="alm-sec" data-sec="skystars"${secOpen("skystars")}><summary><h3>${termBtn("constellation", "Constellations tonight")}</h3></summary>
      ${st.visible.length ? `<p class="hint">Best placed around ${esc(fmtTime(st.when))}.</p><div class="stars">${st.visible.map((c) => `<div class="star-card">
        <div class="sc-top"><b>${esc(c.name)}</b><span class="where">${esc(whereToLook(c.pos))}</span></div>
        <p>${esc(c.find)}</p><p class="fact">${esc(c.fact)}</p></div>`).join("")}</div>` : `<p>No major constellations are well placed right now.</p>`}
      <p class="hint">Away from streetlights you'll see far more. Give your eyes 15 minutes to adjust, and use red light if you need a flashlight.</p></details>`;
  }

  // 6. Space station
  html += `<details class="alm-sec" data-sec="skyiss"${secOpen("skyiss")}><summary><h3>${termBtn("iss", "Space station flyovers")}</h3></summary>`;
  if (sky.iss === null) html += `<p class="hint">Checking the space station's orbit…</p>`;
  else if (sky.iss === false) html += `<p class="hint">Couldn't get the station's orbit right now.</p>`;
  else if (!sky.iss.filter((p) => p.end > now).length) html += `<p>No visible passes in the next 3 days. The station is only visible when it's lit by the Sun while your sky is dark, so it comes in spells of a week or two.</p>`;
  else html += `<div class="passes">${sky.iss.filter((p) => p.end > now).map((p) => {
    const mins = Math.max(1, Math.round((p.end - p.start) / 6e4));
    return `<div class="pass"><div class="ev-date"><b>${esc(fmtTime(p.start))}</b><span>${esc(p.start.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }))}</span></div>
      <div><p>Appears in the <b>${dirWord(p.from)}</b>, ${p.top.el > 70 ? "passes almost straight overhead" : `climbs ${p.top.el > 40 ? "high" : "about halfway up"} in the ${dirWord(p.top.az)}`}, and ${p.end.getTime() === p.start.getTime() ? "" : `fades out in the <b>${dirWord(p.to)}</b> `}about ${plural(mins, "minute")} later.</p>
      <p class="fact">${p.top.el > 40 ? "Very bright" : "Bright"}: a steady white light moving faster than a plane, with no blinking.</p></div></div>`; }).join("")}</div>`;
  html += `</details>`;

  html += `</div></details>`;
  // Peek: tonight's stargazing rating and the next thing coming up.
  const nextEv = events.find((e) => e.t > now);
  const peek = [tn ? `Tonight ${rateChip(tn.rating)}` : "", nextEv ? `${esc((nextEv.night || nextEv.t).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}: ${esc(nextEv.title)}` : ""].filter(Boolean).join(" · ");
  html = html.replace("%%SUMMARY%%", secSummary("Night sky", peek));
  // A short version for the Tonight card on the Weather tab.
  const issTonight = sky.iss ? sky.iss.find((p) => p.end > now && p.start - now < 16 * 36e5) : null;
  window.skyBrief = {
    rating: tn ? rateChip(tn.rating) : null, best: tn && tn.q >= 0.35 ? `${fmtTime(tn.bestFrom)} to ${fmtTime(tn.bestTo)}` : null,
    next: nextEv ? `${(nextEv.night || nextEv.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${nextEv.title}` : null,
    iss: issTonight ? `${fmtTime(issTonight.start)}, from the ${dirWord(issTonight.from)}` : null
  };
  if (typeof renderTonight === "function") renderTonight();
  // Keep any events the reader has opened open across refreshes.
  const opened = new Set([...el.querySelectorAll("details[data-k][open]")].map((d) => d.dataset.k));
  el.innerHTML = html;
  el.querySelectorAll("details[data-k]").forEach((d) => { if (opened.has(d.dataset.k)) d.open = true; });
}

async function refreshSky() {
  if (!current || typeof Astronomy === "undefined") return;
  const { lat, lon } = current, key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (sky.key !== key) Object.assign(sky, { key, clouds: null, cloudsAt: 0, dark: null, darkErr: false, spotClouds: null, iss: null, eventsKey: null });
  renderSky();
  const jobs = [], busy = sky.busy || (sky.busy = new Set());
  // Each kind of data is fetched once at a time, even if the app re-renders while it's loading.
  const job = (name, p) => { if (busy.has(name)) return; busy.add(name); jobs.push(p.finally(() => busy.delete(name))); };
  if (!sky.clouds || Date.now() - sky.cloudsAt > 30 * 6e4) {
    sky.loading = true;
    job("clouds", loadClouds(lat, lon).then((c) => { if (sky.key === key) { sky.clouds = c; sky.cloudsAt = Date.now(); } }).catch(() => {}).finally(() => { sky.loading = false; }));
  }
  if (!sky.dark) job("dark", loadDarkSpots(lat, lon).then(async (v) => {
    if (sky.key !== key) return;
    sky.dark = v; sky.darkErr = false; renderSky();
    sky.spotClouds = await loadSpotClouds(v.spots).catch(() => null); sky.spotCloudsAt = Date.now();
  }).catch(() => { if (sky.key === key) sky.darkErr = true; }));
  else if (!sky.spotClouds || Date.now() - sky.spotCloudsAt > 3 * 36e5) job("spotclouds", loadSpotClouds(sky.dark.spots).then((c) => { if (sky.key === key) { sky.spotClouds = c; sky.spotCloudsAt = Date.now(); } }).catch(() => {}));
  if (sky.iss === null || sky.iss === false || Date.now() - sky.issAt > 36e5) job("iss", loadIssTle().then((tle) => { if (sky.key === key) { sky.iss = issPasses(tle, lat, lon); sky.issAt = Date.now(); } }).catch(() => { if (sky.key === key) sky.iss = false; }));
  await Promise.all(jobs.map((j) => j.then(() => renderSky())));
  renderSky();
}

function mountSky() {
  const slot = $("skySlot");
  if (!slot) return;
  slot.replaceWith(skyPanel());
  refreshSky();
}

// ---------- explanations ----------
Object.assign(TERMS, {
  meteor: {
    title: "Meteor showers",
    aka: "Shooting stars",
    what: "A shooting star isn't a star at all. It's a bit of space dust, usually smaller than a grain of sand, hitting Earth's air so fast that it heats the air around it until it glows, about 50 to 75 miles up. Comets leave trails of this dust along their orbits. When Earth passes through a trail on the same dates each year, we get a shower. The best viewing: get away from lights, let your eyes adjust for 20 minutes (no phone screens), lie back, and look at the widest patch of open sky. The rate in the forecast is for good conditions; you'll often see fewer, in bursts.",
    extra: () => scaleList([["ZHR", "Meteors an hour under a perfect dark sky with the radiant overhead"], ["Your rate", "Lower: the radiant is never straight overhead, and lights and moonlight hide the faint ones"]], -1)
  },
  radiant: {
    title: "Radiant",
    what: "The spot in the sky that a shower's meteors seem to fly out from. It's a trick of perspective, like snowflakes seeming to come from one point when you drive through snow. The higher the radiant, the more meteors you'll see, which is why most showers are best after midnight. Showers are named after the constellation the radiant sits in: the Perseids come from Perseus, the Geminids from Gemini."
  },
  newmoon: {
    title: "New moon",
    what: "The Moon is roughly between Earth and the Sun, so the side facing us is in shadow and the Moon is up during the day, lost in the Sun's glare. With no moonlight, the nights around a new moon are the darkest of the month.",
    now: () => { const m = moonPhase(); return `${m.name}, ${Math.round(m.illum * 100)}% lit. Next new moon in about ${Math.round(m.daysToNew)} days.`; }
  },
  fullmoon: {
    title: "Full moon names",
    what: "The Moon is on the far side of Earth from the Sun, so we see its whole sunlit face. It rises at sunset and sets at sunrise. The names (Wolf Moon, Harvest Moon and so on) come from old North American and European traditions for the time of year. A Blue Moon is a second full moon in one calendar month, which happens about every two and a half years."
  },
  supermoon: {
    title: "Supermoon",
    what: "The Moon's orbit is an oval, so its distance from Earth changes by about 30,000 miles over each month. A supermoon is a full moon near its closest point. It looks a little bigger and brighter than usual, though the difference is hard to notice without a side-by-side photo. A low Moon looking huge near the horizon is a separate effect: an illusion of the brain, not the Moon's distance."
  },
  lunareclipse: {
    title: "Lunar eclipse",
    what: "Earth passes directly between the Sun and the Moon, and Earth's shadow falls on the Moon. In a total eclipse the Moon turns red or copper (a \"blood moon\") because the only sunlight reaching it has bent through Earth's atmosphere: it's the glow of every sunrise and sunset on Earth at once. Anyone on the night side of Earth can see it, and it's completely safe to look at.",
    extra: () => scaleList([["Penumbral", "Moon in the faint outer shadow. Slight dimming, easy to miss"], ["Partial", "Part of the Moon in the dark inner shadow"], ["Total", "The whole Moon in the inner shadow. Turns red"]], -1)
  },
  solareclipse: {
    title: "Solar eclipse",
    what: "The Moon passes directly between Earth and the Sun and blocks some or all of it. The Moon is 400 times smaller than the Sun but also about 400 times closer, so they look almost the same size. Its shadow is small, so a total eclipse is only seen along a narrow path. Never look at the Sun without certified eclipse glasses (ISO 12312-2): even a sliver of uncovered Sun can damage your eyes, and you won't feel it happening.",
    extra: () => scaleList([["Partial", "The Moon covers part of the Sun. Glasses needed the whole time"], ["Annular", "The Moon is a bit too far to cover it all, leaving a \"ring of fire\""], ["Total", "The Sun is completely covered for a few minutes, and day turns to twilight"]], -1)
  },
  opposition: {
    title: "Opposition",
    what: "When Earth passes between the Sun and an outer planet, the planet is \"opposite\" the Sun in our sky. It's at its closest to us, fully lit, and up all night, so it's the best time of the year to see it. Earth laps Mars about every 26 months, Jupiter and Saturn about once a year."
  },
  elongation: {
    title: "Greatest elongation",
    what: "Mercury and Venus orbit inside Earth's orbit, so from here they never get far from the Sun. They swing back and forth from one side of it to the other. Greatest elongation is when one is at its farthest from the Sun in our sky, the easiest time to spot it. East of the Sun means it's in the evening sky after sunset; west means the morning sky before sunrise."
  },
  conjunction: {
    title: "Close pairings",
    aka: "Astronomers call these conjunctions or appulses",
    what: "When the Moon or planets line up so they look close together in our sky. They're really nowhere near each other: the Moon is about a quarter of a million miles away and the planets are hundreds of millions. To measure gaps in the sky, hold your hand out at arm's length: a finger is about 1°, a fist about 10°."
  },
  solstice: {
    title: "Solstices and equinoxes",
    what: "Earth is tilted, so over the year first one half and then the other leans toward the Sun. That makes the seasons. At a solstice, your half of Earth leans the most toward the Sun (the longest day) or away from it (the shortest day). At an equinox, neither half leans toward the Sun, and day and night are nearly equal everywhere."
  },
  cloudcover: {
    title: "Cloud cover",
    what: "How much of the sky is covered by cloud, from 0% (clear) to 100% (overcast). For stars, low and middle clouds block everything. High, thin clouds (made of ice crystals, 4 to 8 miles up) let bright stars and planets show through but hide faint ones. The forecast is from Open-Meteo's weather models, hour by hour.",
    extra: () => scaleList([["0–10%", "Clear"], ["10–30%", "Mostly clear"], ["30–60%", "Partly cloudy: watch through the gaps"], ["60–100%", "Mostly cloudy to overcast"]], -1)
  },
  lightpollution: {
    title: "Light pollution",
    what: "Light from streetlights, buildings and signs that shines up into the sky and scatters off the air, making a glow that hides stars. From a city you might see a few dozen stars; from a truly dark place, thousands, plus the Milky Way. A big city's glow can be seen 100 miles away. This app estimates how dark the sky is at each spot from the size of nearby towns and their distance (a rule called Walker's law), so treat it as a guide."
  },
  bortle: {
    title: "Bortle scale",
    what: "A 1-to-9 scale for how dark the night sky is, made by the astronomer John Bortle in 2001. 1 is the darkest sky on Earth, 9 is the center of a big city.",
    extra: () => scaleList(BORTLE.map(([, n, name]) => [`${n === 8 ? "8–9" : n}`, name]), sky.dark ? bortle(sky.dark.home)[1] - 1 : -1),
    now: () => { if (!sky.dark) return null; const b = bortle(sky.dark.home); return `Your area: about Bortle ${b[1]}, ${b[2].toLowerCase()}. ${b[3]}`; }
  },
  planets: {
    title: "Seeing planets",
    what: "Five planets are easy to see with just your eyes: Mercury, Venus, Mars, Jupiter and Saturn. They look like bright stars, but they don't twinkle as much, because they're tiny disks rather than points of light. They also move against the stars from night to night; \"planet\" comes from the Greek word for wanderer. Brightness is measured in magnitudes, where lower numbers are brighter and negative numbers are very bright.",
    extra: () => scaleList([["−4", "Venus at its brightest"], ["−2", "Jupiter"], ["0", "The brightest stars, like Vega"], ["+6", "The faintest stars you can see in a dark place"]], -1)
  },
  iss: {
    title: "International Space Station",
    what: "A science lab the size of a football field, with astronauts living on board, orbiting about 250 miles up at 17,500 mph: once around Earth every 90 minutes. It has no lights you can see from the ground. It shines by reflecting sunlight, so you can only see it shortly after sunset or before sunrise, when your sky is dark but the station, high up, is still in sunshine. Sometimes it fades out in mid-sky as it flies into Earth's shadow. Wave: there are people up there."
  }
});
["meteor", "radiant", "newmoon", "fullmoon", "supermoon", "lunareclipse", "solareclipse", "opposition", "elongation", "conjunction", "solstice", "cloudcover", "lightpollution", "bortle", "planets", "iss"].forEach((k) => { if (typeof TERM_ORDER !== "undefined" && !TERM_ORDER.includes(k)) TERM_ORDER.push(k); });

window.mountSky = mountSky;
if (lastData) mountSky();
})();

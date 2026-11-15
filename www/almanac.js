"use strict";
// Almanac: how this week compares with normal, frost dates and growing zone, what to plant now,
// birds people have seen near you this month, and a little sky and weather folklore.
// Uses free, open sources: Open-Meteo's historical archive (20 years of local temperatures),
// phzmapi.org (USDA hardiness zones by ZIP), BigDataCloud (ZIP lookup) and iNaturalist (bird sightings).
// Depends on helpers from index.html: $, esc, t, units, current, lastData, termBtn, TERMS, scaleList,
// moonPhase, store, getJSON, cToF, pressureTrend.

const ALM_YEARS = 20;
const almanac = { el: null, key: null, clim: null, zone: null, birds: null, loading: false };

const doyOf = (d) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
const dateFromDoy = (doy) => new Date(2025, 0, doy);      // a non-leap year, only used for month/day text
const monthDay = (doy) => dateFromDoy(doy).toLocaleDateString(undefined, { month: "long", day: "numeric" });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const almKey = (lat, lon) => `${lat.toFixed(1)},${lon.toFixed(1)}`;

// ---------- data ----------
async function loadClimate(lat, lon) {
  const ck = `lw.clim.${almKey(lat, lon)}`;
  const cached = store.get(ck);
  if (cached && Date.now() - cached.at < 60 * 864e5) return cached.c;
  const end = new Date().getFullYear() - 1;
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "auto",
    start_date: `${end - ALM_YEARS + 1}-01-01`, end_date: `${end}-12-31`,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum"
  });
  const d = await getJSON(`https://archive-api.open-meteo.com/v1/archive?${q}`);
  const days = d.daily.time.map((s, i) => ({ y: +s.slice(0, 4), m: +s.slice(5, 7), doy: doyOf(new Date(s + "T12:00:00")), hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i], p: d.daily.precipitation_sum[i] }));
  const c = summarize(days);
  store.set(ck, { at: Date.now(), c });
  return c;
}

function summarize(days) {
  const years = [...new Set(days.map((x) => x.y))];
  // Frost: last spring and first fall day at or below 0 °C, per year (northern-hemisphere seasons).
  const spring = [], fall = [], extremes = [];
  for (const y of years) {
    const yd = days.filter((x) => x.y === y && x.lo != null);
    const s = yd.filter((x) => x.m <= 7 && x.lo <= 0).map((x) => x.doy);
    const f = yd.filter((x) => x.m >= 8 && x.lo <= 0).map((x) => x.doy);
    if (s.length) spring.push(Math.max(...s));
    if (f.length) fall.push(Math.min(...f));
    if (yd.length > 300) extremes.push(Math.min(...yd.map((x) => x.lo)));
  }
  // Normals for each day of the year: average over a 15-day window across all years.
  const byDoy = [];
  for (let doy = 1; doy <= 366; doy++) {
    const w = days.filter((x) => Math.min(Math.abs(x.doy - doy), 366 - Math.abs(x.doy - doy)) <= 7 && x.hi != null);
    if (!w.length) { byDoy.push(null); continue; }
    byDoy.push({
      hi: w.reduce((a, x) => a + x.hi, 0) / w.length, lo: w.reduce((a, x) => a + x.lo, 0) / w.length,
      recHi: Math.max(...w.map((x) => x.hi)), recLo: Math.min(...w.map((x) => x.lo))
    });
  }
  // Rain per calendar month: average total and average number of wet days (1 mm or more).
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const md = days.filter((x) => x.m === m && x.p != null);
    months.push({ total: md.reduce((a, x) => a + x.p, 0) / years.length, wet: md.filter((x) => x.p >= 1).length / years.length });
  }
  const meanExtreme = extremes.length ? extremes.reduce((a, x) => a + x, 0) / extremes.length : null;
  return {
    years: years.length,
    frostYears: Math.max(spring.length, fall.length),
    lastSpring: median(spring), firstFall: median(fall),
    meanExtremeMinC: meanExtreme, byDoy, months
  };
}

function zoneFromExtreme(c) {
  if (c == null) return null;
  const f = cToF(c), n = Math.min(13, Math.max(1, Math.floor((f + 60) / 10) + 1));
  return `${n}${((f + 60) % 10 + 10) % 10 < 5 ? "a" : "b"}`;
}

async function loadZone(lat, lon) {
  // Official USDA zone by ZIP code where we can find one; otherwise estimate from the 20-year record.
  try {
    const r = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    if (r.countryCode === "US" && r.postcode) {
      const z = await getJSON(`https://phzmapi.org/${r.postcode.slice(0, 5)}.json`);
      if (z?.zone) return { zone: z.zone, range: z.temperature_range, official: true };
    }
  } catch {}
  return null;
}

async function loadBirds(lat, lon) {
  const month = new Date().getMonth() + 1;
  const q = new URLSearchParams({ lat, lng: lon, radius: 25, iconic_taxa: "Aves", month, quality_grade: "research", per_page: 12, locale: "en" });
  const r = await getJSON(`https://api.inaturalist.org/v1/observations/species_counts?${q}`);
  return (r.results || []).map((x) => ({
    id: x.taxon.id, name: x.taxon.preferred_common_name || x.taxon.name, sci: x.taxon.name, count: x.count,
    photo: x.taxon.default_photo?.square_url || null, credit: x.taxon.default_photo?.attribution || ""
  }));
}

// ---------- planting ----------
const CROPS = {
  cool: "lettuce, spinach, peas, radishes, carrots, beets, kale, chard, broccoli",
  warm: "tomatoes, peppers, squash, cucumbers, beans, corn, basil, melons",
  start: "tomatoes and peppers indoors on a sunny windowsill",
};
function plantingNow(c, doy) {
  const out = [];
  const frostRare = c.frostYears < c.years / 4;
  const m = new Date().getMonth() + 1;
  if (frostRare) {
    if (m >= 9 || m <= 2) out.push(["Sow or plant now", `Cool-season crops love this mild winter: ${CROPS.cool}. Also onions, strawberries and sweet peas.`]);
    if (m >= 10 && m <= 12) out.push(["Also good now", "Garlic cloves, and wildflower seeds scattered before the winter rains do the watering for you."]);
    if (m === 12 || m <= 2) out.push(["Trees and roses", "Bare-root fruit trees and roses go in now, while they're dormant."]);
    if (m >= 3 && m <= 5) out.push(["Sow or plant now", `Warm-season crops: ${CROPS.warm}. Sunflowers too.`]);
    if (m >= 6 && m <= 8) out.push(["Summer garden", "Keep sowing beans, squash and corn into July. Plant pumpkins by early July for Halloween. Start broccoli and kale seeds in August for fall."]);
    out.push(["Your season", "Frost almost never happens here, so the hot summer, not the cold, is the hardest time for most vegetables."]);
    return out;
  }
  const L = c.lastSpring, F = c.firstFall, w = 7;
  if (L == null || F == null) return out;
  if (doy < L - 10 * w || doy > F + 4 * w) {
    out.push(["Resting season", "Too cold to plant outside. Mulch garden beds, plan next year's garden and order seeds."]);
    if (doy < L && doy >= L - 14 * w) out.push(["Coming up", `In a few weeks, start ${CROPS.start}. They need 6 to 8 weeks before your last frost.`]);
  } else if (doy < L - 6 * w) out.push(["Start indoors", `Start ${CROPS.start}. Onions and leeks can start indoors too.`]);
  else if (doy < L) out.push(["Sow outside now", "Cool-season crops that shrug off light frost: peas, spinach, lettuce, radishes, carrots. Seed potatoes go in about 2 weeks before the last frost."]);
  else if (doy < L + 4 * w) out.push(["Plant now", `The frost danger is past. Transplant tomatoes and peppers, and sow ${CROPS.warm.replace("tomatoes, peppers, ", "")}.`]);
  else if (doy < F - 12 * w) out.push(["Summer garden", "Keep sowing beans and lettuce every few weeks for a steady harvest. Water deeply in the morning."]);
  else if (doy < F - 6 * w) out.push(["Sow for fall", "Kale, broccoli, carrots, beets, spinach and lettuce sown now will be ready before the first frost."]);
  else out.push(["Fall planting", "Plant garlic and spring bulbs like tulips and daffodils. Harvest tender crops before the first frost."]);
  return out;
}

// ---------- folklore ----------
function folklore(d) {
  const items = [];
  const m = moonPhase();
  items.push({
    say: m.waxing ? "Plant crops that grow above ground while the moon is waxing." : "Plant root crops while the moon is waning.",
    sci: "This is an old almanac tradition. Scientists haven't found that the moon changes how plants grow, but it's a fun way to plan."
  });
  const c = d.current, tr = pressureTrend(c.pressureHpa, c.pressure3hAgo);
  const hour = new Date().getHours();
  if (tr && tr.word.startsWith("falling")) items.push({ say: "When the glass falls low, prepare for a blow.", sci: "True. \"The glass\" is the barometer. Falling pressure often means wind and storms are on the way, and it's falling now." });
  else if (tr && tr.word.startsWith("rising")) items.push({ say: "Long foretold, long last; short notice, soon past.", sci: "Mostly true. Weather that arrives with a slow, steady change in pressure tends to stay longer than a quick change. Pressure is rising now." });
  else if (c.humidity != null && c.humidity > 85) items.push({ say: "When the dew is on the grass, rain will never come to pass.", sci: "Often true. Heavy dew forms on clear, calm nights, which usually mean fair weather. It's very humid right now." });
  else if (hour >= 15) items.push({ say: "Red sky at night, sailor's delight. Red sky in morning, sailors take warning.", sci: "Often true where weather moves west to east, like most of the US. A red sunset means clear skies to the west, where tomorrow's weather is coming from." });
  else items.push({ say: "Ring around the moon, rain or snow soon.", sci: "Often true. The ring comes from high, thin ice clouds that tend to arrive a day or so ahead of a storm." });
  return items;
}

// ---------- rendering ----------
function almanacPanel() {
  if (almanac.el) return almanac.el;
  const el = document.createElement("section");
  el.className = "panel almanac";
  el.setAttribute("aria-label", "Almanac");
  almanac.el = el;
  return el;
}

function renderAlmanac() {
  const el = almanac.el, d = lastData;
  if (!el || !d) return;
  const now = new Date(), doy = doyOf(now), c = almanac.clim;
  const season = now.toLocaleDateString(undefined, { month: "long" });
  let html = `<h2 class="label">Almanac for ${esc(season)}</h2>`;

  if (!c) {
    html += `<p class="hint">${almanac.loading ? "Looking up 20 years of local weather…" : "The almanac needs a connection to load."}</p>`;
    el.innerHTML = html;
    return;
  }

  // 1. This week vs normal
  const n = c.byDoy[doy - 1];
  const next = d.days.filter((x) => x.hiC != null).slice(0, 7);
  const avgHi = next.length ? next.reduce((a, x) => a + x.hiC, 0) / next.length : null;
  const diff = avgHi != null && n ? (units === "F" ? (avgHi - n.hi) * 9 / 5 : avgHi - n.hi) : null;
  const mo = c.months[now.getMonth()];
  const rainTxt = units === "F" ? `${(mo.total / 25.4).toFixed(1)} in` : `${Math.round(mo.total)} mm`;
  html += `<div class="alm-sec"><h3>${termBtn("normal", "This time of year")}</h3>
    ${n ? `<p>A normal ${esc(monthDay(doy))} here is a high of <b>${t(n.hi)}</b> and a low of <b>${t(n.lo)}</b>. The warmest it has been in the last ${c.years} years around this date was ${t(n.recHi)}, and the coldest ${t(n.recLo)}.</p>` : ""}
    ${diff != null ? `<p>${Math.abs(diff) < 2 ? "The coming week looks close to normal." : `The coming week looks about <b>${Math.round(Math.abs(diff))}° ${diff > 0 ? "warmer" : "cooler"}</b> than normal.`}</p>` : ""}
    <p>${esc(season)} usually brings about ${Math.round(mo.wet)} rainy day${Math.round(mo.wet) === 1 ? "" : "s"} and ${rainTxt} of rain in total.</p></div>`;

  // 2. Frost and zone
  const frostRare = c.frostYears < c.years / 4;
  const z = almanac.zone, zEst = zoneFromExtreme(c.meanExtremeMinC);
  html += `<div class="alm-sec"><h3>${termBtn("frost", "Frost dates")} and ${termBtn("zone", "growing zone")}</h3>
    <p>${frostRare ? `Frost is rare here: it showed up in only ${c.frostYears} of the last ${c.years} winters.` : `Last spring frost: around <b>${esc(monthDay(c.lastSpring))}</b>. First fall frost: around <b>${esc(monthDay(c.firstFall))}</b>. That's about ${Math.round((c.firstFall - c.lastSpring) / 7)} weeks of frost-free growing.`}</p>
    <p>${z ? `USDA hardiness zone <b>${termBtn("zone", esc(z.zone))}</b>${z.range ? ` (coldest nights usually ${esc(z.range)}°F)` : ""}.` : zEst ? `About USDA hardiness zone <b>${termBtn("zone", zEst)}</b>, estimated from 20 years of local temperatures.` : ""}</p></div>`;

  // 3. Garden
  const tips = plantingNow(c, doy);
  if (tips.length) html += `<div class="alm-sec"><h3>In the garden</h3>${tips.map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join("")}</div>`;

  // 4. Birds
  const b = almanac.birds;
  html += `<div class="alm-sec"><h3>Birds around in ${esc(season)}</h3>`;
  if (b && b.length) {
    html += `<p class="hint">The birds people have photographed most often within 15 miles of you in ${esc(season)}, from ${termBtn("inat", "iNaturalist")}.</p>
      <div class="birds">${b.map((x) => `<a class="bird" href="https://www.inaturalist.org/taxa/${x.id}" target="_blank" rel="noopener" title="${esc(x.sci)}${x.credit ? ` · Photo ${esc(x.credit)}` : ""}">
        ${x.photo ? `<img src="${esc(x.photo)}" alt="" loading="lazy" width="56" height="56">` : `<span class="noimg"></span>`}
        <span><span class="bn">${esc(x.name)}</span><span class="bc">${x.count.toLocaleString()} sightings</span></span></a>`).join("")}</div>`;
  } else html += `<p class="hint">${b ? "No bird sightings recorded near here for this month yet." : "Loading sightings…"}</p>`;
  html += `</div>`;

  // 5. Folklore
  html += `<div class="alm-sec"><h3>Sky and weather sayings</h3>${folklore(d).map((f) => `<div class="lore"><p class="say">“${esc(f.say)}”</p><p><b>Science says:</b> ${esc(f.sci)}</p></div>`).join("")}</div>`;
  el.innerHTML = html;
}

async function refreshAlmanac() {
  if (!current) return;
  const key = almKey(current.lat, current.lon);
  if (almanac.key === key && (almanac.clim || almanac.loading)) { renderAlmanac(); return; }
  almanac.key = key; almanac.clim = null; almanac.zone = null; almanac.birds = null; almanac.loading = true;
  renderAlmanac();
  const { lat, lon } = current;
  const [clim, zone, birds] = await Promise.all([
    loadClimate(lat, lon).catch(() => null), loadZone(lat, lon).catch(() => null), loadBirds(lat, lon).catch(() => [])
  ]);
  if (almanac.key !== key) return;            // location changed while loading
  Object.assign(almanac, { clim, zone, birds, loading: false });
  renderAlmanac();
}

function mountAlmanac() {
  const slot = $("almanacSlot");
  if (!slot) return;
  slot.replaceWith(almanacPanel());
  refreshAlmanac();
}

// What a zone means in practice, in plain words
const ZONE_PLANTS = {
  1: "Only the toughest plants survive here, like dwarf birch and some willows.", 2: "Hardy plants like spruce, birch and rhubarb do well.",
  3: "Apples, lilacs and peonies can handle these winters.", 4: "Apples, lilacs, peonies and many maples grow well.",
  5: "Peaches, roses and most garden perennials survive the winter.", 6: "Peaches, figs with some protection, and lots of perennials grow well.",
  7: "Figs, crape myrtles and many evergreens thrive.", 8: "Camellias, figs and crape myrtles thrive, and many vegetables grow almost all year.",
  9: "Oranges and lemons can grow outside, and many vegetables grow through the winter.",
  10: "Citrus, avocados and bougainvillea grow outside all year, and winter is the best time for lettuce, peas and broccoli.",
  11: "Frost almost never comes: mangoes, bananas and other tropical plants can grow outdoors.",
  12: "Tropical: coconuts, papayas and other plants that can't take any cold.", 13: "Fully tropical: almost anything that likes heat grows here."
};
function currentZone() { return almanac.zone?.zone || (almanac.clim ? zoneFromExtreme(almanac.clim.meanExtremeMinC) : null); }

// Explanations for the almanac's own words
Object.assign(TERMS, {
  normal: {
    title: "Normal weather",
    what: "\"Normal\" is the average over many years, not what you should expect every day. Real days bounce above and below it. This app works out normals for your exact spot from 20 years of daily temperatures, averaging the week on either side of today's date."
  },
  frost: {
    title: "Frost dates",
    what: "The last frost in spring and the first frost in fall, when the temperature near the ground drops to freezing (32°F). Frost kills tender plants like tomatoes and basil, so gardeners plan around these dates. They're typical dates, not promises: in any year, frost can come a couple of weeks earlier or later."
  },
  zone: {
    title: "Hardiness zone",
    nowLabel: "Your zone",
    aka: "The USDA Plant Hardiness Zone map",
    what: "A number for how cold your winters get. It's based on the coldest night of each year, averaged over 30 years. Zone 1 (interior Alaska) is the coldest and zone 13 (Puerto Rico) the warmest. Each step up is 10°F warmer. The letter splits each zone into two 5°F halves: \"a\" is the colder half and \"b\" the warmer half. Plant tags list zones, so a tag saying \"zones 4–9\" means the plant can survive winters in any of those zones.",
    extra: () => {
      const z = currentZone();
      if (!z) return "";
      const n = parseInt(z, 10), lo = (n - 1) * 10 - 60;
      return scaleList([[`${n}a`, `Coldest nights ${lo} to ${lo + 5}°F`], [`${n}b`, `Coldest nights ${lo + 5} to ${lo + 10}°F`]], z.endsWith("a") ? 0 : 1);
    },
    now: () => {
      const z = currentZone();
      if (!z) return null;
      const n = parseInt(z, 10), half = z.slice(-1), lo = (n - 1) * 10 - 60 + (half === "b" ? 5 : 0);
      return `You're in zone ${z}: on the coldest night of a typical year it drops to about ${lo} to ${lo + 5}°F. The "${half}" means you're in the ${half === "a" ? "colder" : "warmer"} half of zone ${n}. ${ZONE_PLANTS[Math.min(13, Math.max(1, n))]}`;
    }
  },
  inat: {
    title: "iNaturalist",
    what: "A free app where people share photos of plants and animals they find. Experts and other users help identify each photo. The birds listed here are species with photos people agree on, taken near you during this month in past years. Tap a bird to learn more about it."
  }
});
["normal", "frost", "zone", "inat"].forEach((k) => { if (typeof TERM_ORDER !== "undefined" && !TERM_ORDER.includes(k)) TERM_ORDER.push(k); });

if (lastData) mountAlmanac();

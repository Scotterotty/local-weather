"use strict";
// Your weather: pick a favorite kind of weather, then see
//  - how it forms, and what today's readings (dew point, pressure, humidity, wind) say about it,
//  - a countdown to the next forecast chance, with the forecast's own percentage,
//  - streaks counted ONLY from what actually happened. A day counts after it's over and the
//    readings confirm it. In the US the readings come from the nearest airport weather station
//    (NWS observations, about the last 7 days); before that, and everywhere else, from
//    Open-Meteo's record of past weather (a weather model's best estimate of what happened, not a gauge).
// Depends on helpers from index.html: $, esc, t, wind, units, current, lastData, termBtn, condBtn,
// iconFor, store, getJSON, cToF, pressureTrend, pressureLevel, sunTimes, amount, isCalm; secOpen from almanac.js.

const FAV_KEY = "lw.fav";
const FAV_HIST_KEY = "lw.favHist";
const RAIN_MIN_MM = 0.254;            // 0.01 in, the smallest amount a rain gauge counts
const SNOW_MIN_CM = 0.254;            // 0.1 in of snow
const GUST_KMH = 48.3;                // 30 mph
const WIND_KMH = 32.2;                // 20 mph
const STATION_DAYS = 7;               // NWS keeps about a week of station readings
const MODEL_DAYS = 60;                // how far back to look for streaks

// ---------- reading helpers ----------
const fav = { el: null, key: null, hist: null, loading: false, err: null, picking: false };
const favDeg = (c) => units === "F" ? Math.round(cToF(c)) : Math.round(c);      // a temperature difference or value, no ° sign
const spread = (c) => c.tempC != null && c.dewC != null ? c.tempC - c.dewC : null;  // °C between air and dew point
const spreadTxt = (dC) => `${units === "F" ? Math.round(dC * 9 / 5) : Math.round(dC)}°`;
const trendOf = (c) => pressureTrend(c.pressureHpa, c.pressure3hAgo);
const hpaTxt = (d) => units === "F" ? `${(Math.abs(d) * 0.02953).toFixed(2)} inHg` : `${Math.abs(d).toFixed(1)} hPa`;
const maxPop24 = (d) => Math.max(0, ...d.hourly.map((h) => h.pop || 0));
const forecastSays = (d, re) => d.hourly.some((h) => re.test(h.desc || "")) || re.test(d.days[0]?.desc || "");

// Clue builders. Each returns { term, label, value, text, sign } where sign is +1 (points toward
// the favorite), -1 (points away) or 0 (no strong signal). Returning null skips the clue.
function pressureClue(d, wantFalling) {
  const c = d.current, tr = trendOf(c), lvl = pressureLevel(c.pressureHpa);
  if (!tr && !lvl) return null;
  const value = [lvl, tr?.word].filter(Boolean).join(", ");
  let sign = 0, text;
  if (tr && tr.word !== "steady") {
    const falling = tr.d < 0;
    sign = falling === wantFalling ? 1 : -1;
    text = falling
      ? `Down ${hpaTxt(tr.d)} in 3 hours. Falling pressure means air is rising, cooling and building clouds.`
      : `Up ${hpaTxt(tr.d)} in 3 hours. Rising pressure means air is sinking, which dries it out and clears the sky.`;
  } else if (lvl) {
    sign = lvl === "Low" ? (wantFalling ? 1 : -1) : lvl === "High" ? (wantFalling ? -1 : 1) : 0;
    text = lvl === "Low" ? "Low pressure means rising air, the setup for clouds and storms."
      : lvl === "High" ? "High pressure means sinking air, which usually keeps skies clear and calm."
      : "Steady and near average, so no big change is signaled yet.";
  }
  return { term: "pressure", label: "Pressure", value, text, sign };
}
function spreadClue(d, wantClose) {
  const s = spread(d.current);
  if (s == null) return null;
  const close = s <= 3, far = s >= 11;
  const sign = close ? (wantClose ? 1 : -1) : far ? (wantClose ? -1 : 1) : 0;
  const text = close ? "The air is almost full of water vapor. A little cooling and it condenses into cloud, fog or drops."
    : far ? "The air is dry. Cloud has a hard time forming, and rain often dries up before it lands."
    : "Some moisture, but the air would have to cool a fair amount before clouds or fog form.";
  return { term: "dew", label: "Dew point gap", value: `${t(d.current.tempC)} air, ${t(d.current.dewC)} dew point (${spreadTxt(s)} apart)`, text, sign };
}
function forecastClue(d, re, word) {
  const p = maxPop24(d), says = forecastSays(d, re);
  return { term: "pop", label: "Forecast", value: says ? `${word} in the next 24 hours${p ? `, up to ${p}%` : ""}` : `No ${word.toLowerCase()} in the next 24 hours`,
    text: says ? "Forecasters see it coming. The chance is how often weather like this brings it." : "The forecast doesn't show it yet. The clues above can change before the forecast does.",
    sign: says ? 1 : -1 };
}

// ---------- the kinds of weather ----------
// rule(day) decides whether a finished day counts. day fields: rainMm, snow (bool), thunder, fog,
// clearFrac / cloudyFrac (share of daytime readings), gustKmh, windKmh, src ("station" | "model").
// chance(x) reads one forecast day: { pct } for precipitation types, { says } for sky types.
const FAVS = {
  sunny: {
    name: "Sunny", noun: "sun", plural: "sunny days", one: "sunny day", icon: "Sunny",
    how: "A sunny day needs sinking air. In a high-pressure system, air from high up slowly sinks toward the ground. Sinking air gets squeezed and warms, and warm air can hold more water vapor, so any cloud droplets evaporate. The result is a clear sky that can last for days, until a low-pressure system pushes the high out of the way.",
    rule: "At least three out of four daytime readings show a clear sky or only a few clouds (2/8 of the sky or less), and no measurable rain or snow.",
    test: (x) => x.clearFrac == null ? null : x.clearFrac >= 0.75 && x.rainMm < RAIN_MIN_MM && !x.snow,
    chance: (x) => ({ says: /\b(sunny|clear)\b/i.test(x.desc || "") && !/partly/i.test(x.desc || "") }),
    clues: (d) => [pressureClue(d, false), spreadClue(d, false),
      d.current.humidity != null ? { term: "humidity", label: "Humidity", value: `${Math.round(d.current.humidity)}%`,
        text: d.current.humidity <= 50 ? "Dry air, so clouds struggle to form." : d.current.humidity >= 85 ? "Very moist air. Low clouds or haze can form easily." : "In between.",
        sign: d.current.humidity <= 50 ? 1 : d.current.humidity >= 85 ? -1 : 0 } : null],
    watch: ["Pressure rising after a storm is the classic sign of clearing skies.", "A big gap between temperature and dew point means dry air, and dry air means few clouds.", "Morning fog that burns off by 10 often turns into a bright afternoon."]
  },
  cloudy: {
    name: "Cloudy", noun: "clouds", plural: "cloudy days", one: "cloudy day", icon: "Cloudy",
    how: "A cloud is billions of tiny water droplets or ice crystals, each too small to fall. They form when air cools to its dew point, usually because it's rising: up a mountain, over a front, or in a low-pressure system. Rising air expands and cools about 5.5°F for every 1,000 feet, and once it hits the dew point the water vapor condenses onto specks of dust and salt.",
    rule: "At least three out of four daytime readings show most of the sky covered (5/8 or more: broken or overcast).",
    test: (x) => x.cloudyFrac == null ? null : x.cloudyFrac >= 0.75,
    chance: (x) => ({ says: /\b(cloudy|overcast|gray|grey)\b/i.test(x.desc || "") && !/partly/i.test(x.desc || "") }),
    clues: (d) => [spreadClue(d, true), pressureClue(d, true),
      d.current.humidity != null ? { term: "humidity", label: "Humidity", value: `${Math.round(d.current.humidity)}%`,
        text: d.current.humidity >= 80 ? "Moist air, so it doesn't take much cooling to make cloud." : d.current.humidity <= 40 ? "Dry air. Clouds need a lot of lift to form." : "In between.",
        sign: d.current.humidity >= 80 ? 1 : d.current.humidity <= 40 ? -1 : 0 } : null],
    watch: ["High, wispy cirrus thickening into a milky sheet often means a gray day within 24 hours.", "Falling pressure plus a small dew point gap is a good recipe for low clouds.", "Near the coast, a cool, moist ocean breeze at night often brings gray mornings."]
  },
  rain: {
    name: "Rain", noun: "rain", plural: "rainy days", one: "rainy day", icon: "Rain",
    how: "Cloud droplets are tiny, about a hundredth of a millimeter. To fall as rain, a million of them have to join into one drop. In warm clouds they bump and merge. In most clouds, though, rain starts as snow: ice crystals high up grow by stealing water vapor from the droplets around them, get heavy, and melt into raindrops on the way down. Rising air keeps feeding the cloud, which is why low pressure and fronts bring rain.",
    rule: "A rain gauge measured at least 0.01 inch of rain during the day (midnight to midnight). Days with only a trace, or only snow, don't count.",
    test: (x) => x.rainMm >= RAIN_MIN_MM && !x.snowOnly,
    chance: (x) => ({ pct: mentions(x, /snow|flurr/) && !mentions(x, /rain|shower|drizzle|thunder|t-storm|sleet/) ? 0 : x.pop || 0 }),
    clues: (d) => [pressureClue(d, true), spreadClue(d, true), forecastClue(d, /rain|shower|drizzle|thunder|t-storm/i, "Rain")],
    watch: ["Pressure falling 2 or more hPa (0.06 inHg) in 3 hours often means rain within a day.", "Clouds getting lower and thicker through the day, from wispy to flat and gray.", "A damp, earthy smell and the wind shifting ahead of a front."]
  },
  storms: {
    name: "Thunderstorms", noun: "storms", plural: "storm days", one: "storm day", icon: "Thunderstorms",
    how: "Thunderstorms need three things: moisture, unstable air and a push. Warm, humid air near the ground is lighter than the cooler air above, so once something lifts it (afternoon heating, a cold front, a mountain) it keeps rising on its own, sometimes over 10 miles high. Inside, ice and water collide and build up electric charges until lightning jumps. The lightning heats the air hotter than the sun's surface, and that sudden expansion is thunder.",
    rule: "The weather station reported thunder (or a thunderstorm) at least once during the day.",
    test: (x) => x.thunder,
    chance: (x) => ({ pct: mentions(x, /thunder|t-storm/) ? x.pop || 0 : 0 }),
    clues: (d) => {
      const c = d.current;
      return [
        c.dewC != null ? { term: "dew", label: "Dew point (storm fuel)", value: t(c.dewC),
          text: c.dewC >= 15.5 ? "Muggy air, 60°F or higher. That's plenty of moisture to fuel storms." : c.dewC < 10 ? "Dry air, under 50°F. Storms have little fuel today." : "Some moisture, but storms usually want a dew point of 60°F or more.",
          sign: c.dewC >= 15.5 ? 1 : c.dewC < 10 ? -1 : 0 } : null,
        c.tempC != null ? { term: "temp", label: "Heating", value: t(c.tempC),
          text: c.tempC >= 24 ? "Warm air near the ground rises easily, especially in the afternoon." : c.tempC < 13 ? "Cool air near the ground doesn't rise much on its own." : "Warm enough for some rising air.",
          sign: c.tempC >= 24 ? 1 : c.tempC < 13 ? -1 : 0 } : null,
        pressureClue(d, true),
        forecastClue(d, /thunder|t-storm/i, "Thunderstorms")];
    },
    watch: ["Puffy cumulus clouds growing taller and taller by early afternoon.", "Muggy air: a dew point in the 60s or 70s.", "Count seconds from the flash to the thunder and divide by 5 for the distance in miles."]
  },
  snow: {
    name: "Snow", noun: "snow", plural: "snow days", one: "snow day", icon: "Snow",
    how: "Snowflakes grow inside clouds colder than freezing, when water vapor freezes straight onto a speck of dust. Every flake has six sides because that's how water molecules lock together as ice. For snow to reach the ground, the air has to stay near or below freezing the whole way down. Dry air helps: as some snow evaporates, it cools the air around it, which can turn rain into snow.",
    rule: "The weather station reported snow falling during the day, or the day's record shows at least 0.1 inch of snow.",
    test: (x) => x.snow,
    chance: (x) => ({ pct: mentions(x, /snow|flurr|sleet|wintry/) || (x.snowMm || 0) > 0 ? x.pop || 0 : 0 }),
    clues: (d) => {
      const c = d.current;
      return [
        c.tempC != null ? { term: "temp", label: "Temperature", value: t(c.tempC),
          text: c.tempC <= 1.5 ? "Near or below freezing, cold enough for snow to reach the ground." : c.tempC > 5 ? "Too warm for now. Flakes would melt on the way down." : "Close. A little cooling could turn rain to snow.",
          sign: c.tempC <= 1.5 ? 1 : c.tempC > 5 ? -1 : 0 } : null,
        c.dewC != null ? { term: "dew", label: "Dew point", value: t(c.dewC),
          text: c.dewC <= 0 ? "Below freezing. When snow falls into this air, evaporation cools it even more, which helps snow survive." : "Above freezing, so falling snow is more likely to melt into rain.",
          sign: c.dewC <= 0 ? 1 : -1 } : null,
        pressureClue(d, true),
        forecastClue(d, /snow|flurr|sleet|wintry/i, "Snow")];
    },
    watch: ["Temperature and dew point both at or below 32°F (0°C).", "A thick gray sky with a halo around the sun or moon the day before.", "Falling pressure with cold air already in place."]
  },
  fog: {
    name: "Fog", noun: "fog", plural: "foggy days", one: "foggy day", icon: "Fog",
    how: "Fog is a cloud touching the ground. On clear, calm nights the ground loses heat to the sky and cools the air just above it. When that air cools to its dew point, the water vapor condenses into droplets that hang in the air. Wind would mix in drier air from above, so fog likes calm nights. Near the coast, warm moist air drifting over cold water does the same thing.",
    rule: "The station reported fog with visibility under 5/8 mile (1 km) at least once during the day.",
    test: (x) => x.fog,
    chance: (x) => ({ says: mentions(x, /fog/) }),
    clues: (d) => {
      const c = d.current, s = spread(c);
      return [
        s != null ? { term: "dew", label: "Dew point gap", value: `${spreadTxt(s)} apart`,
          text: s <= 2.5 ? "The air is almost at its dew point. A bit more cooling and fog forms." : s >= 8 ? "The air is dry. It would need to cool a lot before fog forms." : "It could close tonight as the air cools.",
          sign: s <= 2.5 ? 1 : s >= 8 ? -1 : 0 } : null,
        c.windKmh != null ? { term: "wind", label: "Wind", value: isCalm(c.windKmh) ? "Calm" : wind(c.windKmh),
          text: c.windKmh < 8 ? "Calm or light wind lets a cool, damp layer settle near the ground." : c.windKmh > 20 ? "Wind mixes drier air down and breaks fog up." : "A light breeze. Fog can still form if it dies down.",
          sign: c.windKmh < 8 ? 1 : c.windKmh > 20 ? -1 : 0 } : null,
        c.humidity != null ? { term: "humidity", label: "Humidity", value: `${Math.round(c.humidity)}%`,
          text: c.humidity >= 90 ? "Almost 100%, where fog forms." : c.humidity < 70 ? "Too dry for fog right now." : "Getting there.",
          sign: c.humidity >= 90 ? 1 : c.humidity < 70 ? -1 : 0 } : null];
    },
    watch: ["Clear skies, calm wind and a dew point close to the evening temperature.", "A rainy day followed by a clear night: wet ground adds moisture.", "Fog usually burns off by late morning as the sun warms the ground."]
  },
  windy: {
    name: "Windy", noun: "wind", plural: "windy days", one: "windy day", icon: "Windy",
    how: "Wind is air moving from high pressure toward low pressure, like air rushing out of a balloon. The bigger the pressure difference over a short distance, the stronger the wind. That's why fast pressure changes mean wind is coming. Earth's spin bends the flow, so wind circles around highs and lows instead of going straight in. Gusts happen when the wind tumbles over buildings, trees and hills.",
    rule: "A gust of at least 30 mph, or a steady wind of at least 20 mph, at any point during the day.",
    test: (x) => x.gustKmh >= GUST_KMH || x.windKmh >= WIND_KMH,
    chance: (x) => ({ says: mentions(x, /wind|breez|gust/) && windyText(x) }),
    clues: (d) => {
      const c = d.current, tr = trendOf(c);
      return [
        tr ? { term: "pressure", label: "Pressure change", value: tr.word,
          text: Math.abs(tr.d) >= 3.5 ? `Changing ${hpaTxt(tr.d)} in 3 hours. A fast change means a strong push of air.` : Math.abs(tr.d) < 1 ? "Barely changing, so there's little push behind the wind." : "Changing a little.",
          sign: Math.abs(tr.d) >= 3.5 ? 1 : Math.abs(tr.d) < 1 ? -1 : 0 } : null,
        c.gustKmh != null || c.windKmh != null ? { term: c.gustKmh != null ? "gusts" : "wind", label: "Wind now",
          value: [c.windKmh != null ? (isCalm(c.windKmh) ? "Calm" : wind(c.windKmh)) : null, c.gustKmh != null ? `gusts ${wind(c.gustKmh)}` : null].filter(Boolean).join(", "),
          text: (c.gustKmh || 0) >= GUST_KMH || (c.windKmh || 0) >= WIND_KMH ? "Already windy enough to count." : (c.windKmh || 0) < 10 ? "Light for now." : "Breezy.",
          sign: (c.gustKmh || 0) >= GUST_KMH || (c.windKmh || 0) >= WIND_KMH ? 1 : (c.windKmh || 0) < 10 ? -1 : 0 } : null,
        pressureClue(d, true)];
    },
    watch: ["Pressure rising or falling 3.5 hPa (0.10 inHg) or more in 3 hours.", "A cold front: wind shifts and picks up as it passes.", "Clouds racing across the sky."]
  }
};
const FAV_ORDER = ["sunny", "cloudy", "rain", "storms", "snow", "fog", "windy"];

function mentions(x, re) { return re.test([x.desc, x.detail, x.nightDetail].filter(Boolean).join(" ").toLowerCase()); }
// NWS forecaster text like "Gusts as high as 35 mph" or "west wind 15 to 25 mph"
function windyText(x) {
  const s = [x.detail, x.nightDetail].filter(Boolean).join(" ");
  if (!s) return true;                              // Open-Meteo days have no text: trust the short description
  const g = [...s.matchAll(/gusts? as high as (\d+) mph/gi)].map((m) => +m[1]);
  const w = [...s.matchAll(/(\d+) (?:to (\d+) )?mph/gi)].map((m) => +(m[2] || m[1]));
  return Math.max(0, ...g) >= 30 || Math.max(0, ...w) >= 20 || /windy|breezy/i.test(x.desc || "");
}

// ---------- the record: what each finished day was actually like ----------
const favTz = () => lastData?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
function dayKeyIn(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (key, n) => { const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const keyLabel = (key, opts) => new Date(key + "T12:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", ...opts });

// Sky cover from a METAR cloud report: 0 = clear or few clouds (≤2/8), 1 = scattered, 2 = broken/overcast (≥5/8).
const COVER = { SKC: 0, CLR: 0, NCD: 0, NSC: 0, FEW: 0, SCT: 1, BKN: 2, OVC: 2, VV: 2 };
function coverOf(o) {
  const layers = (o.cloudLayers || []).map((l) => COVER[l.amount]).filter((v) => v != null);
  if (layers.length) return Math.max(...layers);
  const s = (o.textDescription || "").toLowerCase();
  if (/overcast|^cloudy|mostly cloudy/.test(s)) return 2;
  if (/partly/.test(s)) return 1;
  if (/clear|sunny|fair/.test(s)) return 0;
  return null;
}
const mmOf = (q) => q?.value == null ? null : /:m$/.test(q.unitCode || "") ? q.value * 1000 : q.value;
const kmhOf = (q) => q?.value == null ? null : /m_s-1/.test(q.unitCode || "") ? q.value * 3.6 : q.value;

// Station readings -> one summary per local day.
function summarizeStation(features, tz, lat, lon) {
  const obs = features.map((f) => f.properties).filter((o) => o?.timestamp).map((o) => ({ ...o, ms: Date.parse(o.timestamp) })).sort((a, b) => a.ms - b.ms);
  // Hourly precipitation: routine reports (same minute every hour, e.g. :53) carry the past hour's total.
  // Extra "special" reports in between carry the amount so far that hour, so keep only the biggest per hour.
  const mins = obs.filter((o) => mmOf(o.precipitationLastHour) != null).map((o) => new Date(o.ms).getUTCMinutes());
  const tally = {}; mins.forEach((m) => (tally[m] = (tally[m] || 0) + 1));
  const routine = +(Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 53);
  const bucketOf = (ms) => Math.floor((ms - routine * 6e4 - 1000) / 36e5);
  const days = new Map();
  const get = (key) => days.get(key) || days.set(key, { key, src: "station", n: 0, nDay: 0, clear: 0, cloudy: 0, buckets: new Map(), snowN: 0, rainWords: 0, thunder: false, fog: false, gustKmh: 0, windKmh: 0 }).get(key);
  for (const o of obs) {
    const x = get(dayKeyIn(o.ms, tz));
    x.n++;
    const words = [o.textDescription, ...(o.presentWeather || []).map((w) => `${w.weather || ""} ${w.rawString || ""}`)].join(" ");
    if (/snow|\bSN\b|\bSG\b|-SN|\+SN/i.test(words)) x.snowN++;
    if (/rain|drizzle|shower|\bRA\b|\bDZ\b|-RA|\+RA/i.test(words)) x.rainWords++;
    if (/thunder|\bTS/i.test(words)) x.thunder = true;
    const visKm = o.visibility?.value != null ? o.visibility.value / 1000 : null;
    if (/fog|\bFG\b/i.test(words) && visKm != null && visKm < 1) x.fog = true;
    x.gustKmh = Math.max(x.gustKmh, kmhOf(o.windGust) || 0);
    x.windKmh = Math.max(x.windKmh, kmhOf(o.windSpeed) || 0);
    const p = mmOf(o.precipitationLastHour);
    if (p != null) { const b = bucketOf(o.ms); x.buckets.set(b, Math.max(x.buckets.get(b) || 0, p)); }
    const sun = sunTimes(lat, lon, new Date(o.ms));
    if (sun.rise && sun.set && o.ms >= sun.rise.getTime() && o.ms <= sun.set.getTime()) {
      const cv = coverOf(o);
      if (cv != null) { x.nDay++; if (cv === 0) x.clear++; if (cv === 2) x.cloudy++; }
    }
  }
  return [...days.values()].map((x) => {
    const rainMm = [...x.buckets.values()].reduce((a, v) => a + v, 0);
    return { key: x.key, src: "station", n: x.n, rainMm, snow: x.snowN >= 2, snowOnly: x.snowN > 0 && !x.rainWords, thunder: x.thunder, fog: x.fog,
      clearFrac: x.nDay >= 4 ? x.clear / x.nDay : null, cloudyFrac: x.nDay >= 4 ? x.cloudy / x.nDay : null, gustKmh: x.gustKmh, windKmh: x.windKmh };
  });
}

// Open-Meteo's past hours (a model's analysis of what happened) -> one summary per local day.
function summarizeModel(d) {
  const h = d.hourly, days = new Map();
  h.time.forEach((s, i) => {
    const key = s.slice(0, 10);
    const x = days.get(key) || days.set(key, { key, src: "model", n: 0, rainMm: 0, snowCm: 0, thunder: false, fog: false, nDay: 0, clear: 0, cloudy: 0, gustKmh: 0, windKmh: 0 }).get(key);
    x.n++;
    x.rainMm += (h.rain?.[i] || 0) + (h.showers?.[i] || 0);
    x.snowCm += h.snowfall?.[i] || 0;
    const code = h.weather_code?.[i];
    if (code >= 95) x.thunder = true;
    if (code === 45 || code === 48) x.fog = true;
    x.gustKmh = Math.max(x.gustKmh, h.wind_gusts_10m?.[i] || 0);
    x.windKmh = Math.max(x.windKmh, h.wind_speed_10m?.[i] || 0);
    if (h.is_day?.[i] && h.cloud_cover?.[i] != null) { x.nDay++; if (h.cloud_cover[i] <= 25) x.clear++; if (h.cloud_cover[i] >= 62.5) x.cloudy++; }
  });
  return [...days.values()].filter((x) => x.n >= 24).map((x) => ({
    key: x.key, src: "model", n: x.n, rainMm: x.rainMm, snow: x.snowCm >= SNOW_MIN_CM, snowOnly: x.snowCm >= SNOW_MIN_CM && x.rainMm < RAIN_MIN_MM,
    thunder: x.thunder, fog: x.fog, clearFrac: x.nDay ? x.clear / x.nDay : null, cloudyFrac: x.nDay ? x.cloudy / x.nDay : null, gustKmh: x.gustKmh, windKmh: x.windKmh
  }));
}

async function loadFavHistory(lat, lon, tz, stationId, stationName) {
  const today = dayKeyIn(Date.now(), tz);
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: tz || "auto", past_days: MODEL_DAYS, forecast_days: 1,
    hourly: "rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,is_day"
  });
  const modelP = getJSON(`https://api.open-meteo.com/v1/forecast?${q}`).then(summarizeModel).catch(() => []);
  let station = [];
  if (stationId && /^[KP][A-Z0-9]{3}$/.test(stationId)) {
    try {
      const start = new Date(Date.now() - (STATION_DAYS + 1) * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
      const r = await getJSON(`https://api.weather.gov/stations/${stationId}/observations?start=${start}&limit=500`);
      const feats = r.features || [];
      const first = Math.min(...feats.map((f) => Date.parse(f.properties?.timestamp)).filter((v) => !isNaN(v)));
      // Keep only finished days the station covered from start to end (not the partly covered first day,
      // and at least 16 reports) so a half-covered day never counts.
      station = summarizeStation(feats, tz, lat, lon)
        .filter((x) => x.key < today && x.key > dayKeyIn(first, tz) && x.n >= 16);
    } catch {}
  }
  const model = (await modelP).filter((x) => x.key < today);
  const byKey = new Map(model.map((x) => [x.key, x]));
  for (const s of station) byKey.set(s.key, s);       // measured readings win over the model
  const days = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  return { at: Date.now(), today, tz, stationId: station.length ? stationId : null, stationName: station.length ? stationName : null, days };
}

// ---------- streaks and countdown ----------
function streakInfo(kind, hist) {
  const f = FAVS[kind], days = hist.days;
  const yes = (x) => { try { const v = f.test(x); return v == null ? null : !!v; } catch { return null; } };
  const yesterday = addDays(hist.today, -1);
  const byKey = new Map(days.map((x) => [x.key, x]));
  let streak = 0;
  for (let k = yesterday; byKey.has(k) && yes(byKey.get(k)); k = addDays(k, -1)) streak++;
  const matches = days.filter((x) => yes(x) === true);
  const last = matches.at(-1)?.key || null;
  let best = 0, run = 0, prev = null;
  for (const x of days) {
    const consecutive = prev && addDays(prev, 1) === x.key;
    run = yes(x) ? (consecutive ? run + 1 : 1) : 0;
    prev = x.key; best = Math.max(best, run);
  }
  const in30 = days.filter((x) => x.key >= addDays(hist.today, -30) && yes(x) === true).length;
  const strip = [];
  for (let i = 14; i >= 1; i--) { const k = addDays(hist.today, -i); const x = byKey.get(k); strip.push({ key: k, x, yes: x ? yes(x) : null }); }
  return { streak, last, best, in30, strip, missingYesterday: !byKey.has(yesterday), firstKey: days[0]?.key };
}

function countdown(kind, d) {
  const f = FAVS[kind], tz = favTz(), today = dayKeyIn(Date.now(), tz);
  const rows = d.days.map((x) => ({ x, c: f.chance(x) }));
  const isPct = rows.some((r) => r.c.pct != null);
  const dayName = (x) => x.key === today ? "today" : x.key === addDays(today, 1) ? "tomorrow" : keyLabel(x.key, { weekday: "long" });
  const inDays = (x) => Math.round((Date.parse(x.key + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5);
  if (isPct) {
    const next = rows.find((r) => r.c.pct >= 30), maybe = rows.find((r) => r.c.pct >= 10);
    return { isPct, rows, next: next && { name: dayName(next.x), pct: next.c.pct, inDays: inDays(next.x), desc: next.x.desc }, maybe: !next && maybe && { name: dayName(maybe.x), pct: maybe.c.pct } };
  }
  const next = rows.find((r) => r.c.says);
  return { isPct, rows, next: next && { name: dayName(next.x), inDays: inDays(next.x), desc: next.x.desc } };
}

// ---------- rendering ----------
function favHtml(d) {
  const kind = store.get(FAV_KEY);
  const f = FAVS[kind];
  const picker = `<div class="chips fav-pick" role="group" aria-label="Pick your favorite weather">${FAV_ORDER.map((k) => `<button type="button" class="chip" data-fav="${k}" aria-pressed="${k === kind}">${iconFor(FAVS[k].icon, true)}${FAVS[k].name}</button>`).join("")}</div>`;
  if (!f || fav.picking) {
    return `<details class="alm-all" data-sec="fav"${secOpen("fav")}>${secSummary("Your weather", f ? esc(f.name) : "Pick your favorite kind of weather")}
      <p class="fav-intro">${f ? "Pick a different favorite." : "What's your favorite kind of weather? Pick one to see how it forms, what today's readings say about it, a countdown to the next chance, and streaks counted from what really happened."}</p>
      ${picker}
      ${f ? `<div class="word-more"><button type="button" id="favCancel">Keep ${esc(f.name.toLowerCase())}</button></div>` : ""}
    </details>`;
  }

  // Countdown
  const cd = countdown(kind, d);
  const nm = f.one;
  let cdText;
  if (cd.isPct) {
    cdText = cd.next ? `Next ${esc(kind === "storms" ? "storm" : f.noun)} chance: <b>${esc(cap(cd.next.name))} (${cd.next.pct}%)</b>${cd.next.inDays > 1 ? ` · in ${cd.next.inDays} days` : ""}`
      : cd.maybe ? `No good chance in the next 7 days. Best is ${esc(cd.maybe.name)} at ${cd.maybe.pct}%.` : "No chance in the forecast for the next 7 days.";
  } else {
    cdText = cd.next ? `Next ${esc(nm)} in the forecast: <b>${esc(cap(cd.next.name))}</b>${cd.next.inDays > 1 ? ` · in ${cd.next.inDays} days` : ""}<span class="fav-sub">Forecast says “${esc(cd.next.desc)}”</span>` : `No ${esc(f.plural)} in the 7-day forecast yet.`;
  }
  const cdRow = `<div class="fav-days">${cd.rows.map(({ x, c }) => {
    const on = cd.isPct ? c.pct >= 30 : c.says, some = cd.isPct ? c.pct > 0 : c.says;
    return `<div class="fav-day${on ? " on" : some ? " some" : ""}"><div class="k">${esc(keyLabel(x.key, { weekday: "short" }))}</div>${iconFor(x.desc, true)}<div class="v">${cd.isPct ? (c.pct ? c.pct + "%" : "–") : (c.says ? "Yes" : "–")}</div></div>`;
  }).join("")}</div>`;
  const pctNote = cd.isPct ? `<p class="fav-note">The % is the forecast ${termBtn("pop", "chance of precipitation")}${kind === "storms" ? " on days thunder is in the forecast. Storms don't get their own %" : kind === "snow" ? " on days snow is in the forecast" : ""}. 30% or more counts as a chance.</p>` : "";

  // Streaks
  let streakBlock;
  if (fav.hist?.days?.length) {
    const s = streakInfo(kind, fav.hist);
    const ago = s.last ? Math.round((Date.parse(fav.hist.today + "T12:00:00Z") - Date.parse(s.last + "T12:00:00Z")) / 864e5) : null;
    const headline = s.streak >= 2 ? `<b>${s.streak} ${esc(f.plural)} in a row</b>`
      : s.streak === 1 ? `<b>Yesterday was a ${esc(nm)}</b>`
      : s.last ? `Last ${esc(nm)}: <b>${esc(keyLabel(s.last, { weekday: "short", month: "short", day: "numeric" }))}</b> · ${ago} days ago`
      : `No ${esc(f.plural)} since ${esc(keyLabel(s.firstKey, { month: "short", day: "numeric" }))}`;
    const facts = [`${s.in30} in the last 30 days`, s.best >= 2 ? `longest run ${s.best} days` : null].filter(Boolean).join(" · ");
    const src = fav.hist.stationId
      ? `Counted from readings measured at ${esc(fav.hist.stationName || fav.hist.stationId)} (${esc(fav.hist.stationId)}) for the past week, and from Open-Meteo's weather records before that.`
      : "Counted from Open-Meteo's records of past weather (a weather model's best estimate of what happened). No airport weather station is reporting nearby.";
    streakBlock = `<div class="fav-streak">
      <div class="fav-head">${headline}</div>
      <div class="fav-sub">${facts}</div>
      <div class="fav-strip" aria-label="The last 14 days">${s.strip.map((p) => `<span class="fav-dot${p.yes ? " yes" : p.yes === false ? "" : " unk"}${p.x?.src === "station" ? " meas" : ""}" title="${esc(keyLabel(p.key, { weekday: "short", month: "short", day: "numeric" }))}: ${p.yes ? "yes" : p.yes === false ? "no" : "no reading"}"></span>`).join("")}<span class="fav-dot today" title="Today counts after midnight"></span></div>
      <div class="fav-legend"><span>2 weeks ago</span><span>Today counts after midnight</span></div>
      <details class="fav-how"><summary>How we decide what counts</summary>
        <p><b>A ${esc(nm)}:</b> ${esc(f.rule)}</p>
        <p>Only finished days count, and only from readings of what happened, never the forecast. A day with missing readings ends a streak instead of guessing.</p>
        <p>${src}</p>
        <p>Weather can be different a few miles away. A quick shower on your street might miss the station, so once in a while your yard and the record won't agree.</p>
      </details>
    </div>`;
  } else {
    streakBlock = `<div class="fav-streak"><div class="fav-sub">${fav.loading ? "Checking what the weather has actually been…" : fav.err ? "Couldn't load past weather right now. Streaks will show on the next refresh." : ""}</div></div>`;
  }

  // Learning
  const clues = (() => { try { return f.clues(d).filter(Boolean); } catch { return []; } })();
  const toward = clues.filter((c) => c.sign > 0).length;
  const clueHtml = clues.length ? `<div class="fav-clues">${clues.map((c) => `
      <div class="fav-clue ${c.sign > 0 ? "up" : c.sign < 0 ? "down" : "flat"}">
        <div class="fav-mark" aria-hidden="true">${c.sign > 0 ? "▲" : c.sign < 0 ? "▼" : "●"}</div>
        <div><div class="k">${termBtn(c.term, esc(c.label))} · <span class="v">${esc(c.value)}</span></div><p>${esc(c.text)}</p>
        <div class="sr">${c.sign > 0 ? `Points toward ${esc(f.noun)}` : c.sign < 0 ? `Points away from ${esc(f.noun)}` : "No strong signal"}</div></div>
      </div>`).join("")}</div>
      <p class="fav-note">${toward} of ${clues.length} clues point toward ${esc(f.noun)} right now. Clues aren't a forecast, but they're what forecasters look at first.</p>` : "";

  // Peek: the favorite, when it's next likely, and the current streak.
  const peekStreak = fav.hist?.days?.length ? (() => { try { const s = streakInfo(kind, fav.hist).streak; return s ? `${s}-day streak` : ""; } catch { return ""; } })() : "";
  const peek = [esc(f.name), cd.next ? `next ${cd.next.inDays > 1 ? `in ${cd.next.inDays} days` : esc(cd.next.name.toLowerCase())}` : "none in the 7-day", peekStreak].filter(Boolean).join(" · ");
  return `<details class="alm-all" data-sec="fav"${secOpen("fav")}>${secSummary("Your weather", peek)}
    <div class="fav-title">${iconFor(f.icon, true).replace('class="icon"', 'class="icon lg"')}<span>${esc(f.name)}</span><button type="button" id="favChange">Change</button></div>
    <div class="fav-cd">${cdText}</div>
    ${cdRow}
    ${pctNote}
    ${streakBlock}
    <details class="alm-sec" data-sec="fav-how"${secOpen("fav-how")}><summary><h3>How ${esc(kind === "sunny" ? "sunny days" : kind === "cloudy" ? "clouds" : kind === "storms" ? "thunderstorms" : f.noun)} ${["sunny", "cloudy", "storms"].includes(kind) ? "form" : "forms"}</h3></summary><p>${esc(f.how)}</p></details>
    ${clueHtml ? `<details class="alm-sec" data-sec="fav-clues"${secOpen("fav-clues")}><summary><h3>What the readings say now</h3></summary>${clueHtml}</details>` : ""}
    <details class="alm-sec" data-sec="fav-watch"${secOpen("fav-watch")}><summary><h3>Signs to watch for</h3></summary><ul class="fav-watch">${f.watch.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>
  </details>`;
}
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

function renderFav() {
  const el = fav.el;
  if (!el || !lastData) return;
  el.innerHTML = favHtml(lastData);
  el.querySelectorAll("[data-fav]").forEach((b) => b.addEventListener("click", () => {
    store.set(FAV_KEY, b.dataset.fav); fav.picking = false; renderFav();
  }));
  $("favChange")?.addEventListener("click", () => { fav.picking = true; renderFav(); });
  $("favCancel")?.addEventListener("click", () => { fav.picking = false; renderFav(); });
}

async function refreshFavHistory() {
  if (!current || !lastData || fav.loading) return;
  const tz = favTz(), c = lastData.current;
  const key = `${current.lat.toFixed(2)},${current.lon.toFixed(2)}`;
  const today = dayKeyIn(Date.now(), tz);
  // Finished days never change, so the record only needs fetching again once a new day has ended
  // (or after a few hours, in case the station was late reporting).
  if (fav.hist && fav.key === key && fav.hist.today === today && Date.now() - fav.hist.at < 3 * 36e5) return;
  const saved = store.get(FAV_HIST_KEY);
  if (saved?.key === key && saved.hist?.today === today && Date.now() - saved.hist.at < 3 * 36e5) { fav.key = key; fav.hist = saved.hist; renderFav(); return; }
  if (fav.key !== key) fav.hist = saved?.key === key ? saved.hist : null;     // show the older record while refreshing
  fav.key = key; fav.loading = true; fav.err = null; renderFav();
  try {
    const hist = await loadFavHistory(current.lat, current.lon, tz, c.stationId, c.stationName);
    if (fav.key !== key) return;
    if (hist.days.length) { fav.hist = hist; store.set(FAV_HIST_KEY, { key, hist }); } else fav.err = true;
  } catch { fav.err = true; }
  fav.loading = false;
  renderFav();
}

function mountFav() {
  const slot = $("favSlot");
  if (!slot) return;
  slot.outerHTML = `<section class="panel fav" id="favPanel" aria-label="Your favorite weather"></section>`;
  fav.el = $("favPanel");
  renderFav();
  if (FAVS[store.get(FAV_KEY)]) refreshFavHistory();
}
// Picking a favorite for the first time starts loading the record.
document.addEventListener("click", (e) => { if (e.target.closest?.("[data-fav]")) setTimeout(refreshFavHistory, 0); });
if (lastData) mountFav();

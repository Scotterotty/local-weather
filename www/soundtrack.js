// Soundtrack for your day: reads the next 24 hours of the forecast, splits it into parts of the day,
// and suggests a style of music that fits each one's weather, temperature and light.
// Needs only the forecast already loaded (no extra requests). Loaded after index.html's main script.

const PARTS = [   // [first hour, last hour, name]
  [5, 11, "morning"], [12, 16, "afternoon"], [17, 21, "evening"], [22, 4, "night"]
];
const partOf = (h) => PARTS.find(([a, b]) => a <= b ? h >= a && h <= b : h >= a || h <= b)[2];

// The sky for a stretch of hours, in one word. Wet or wild weather wins over the most common sky.
function skyKind(desc) {
  const s = (desc || "").toLowerCase();
  if (/thunder|t-storm/.test(s)) return "storm";
  if (/snow|sleet|flurr|ice|freezing/.test(s)) return "snow";
  if (/rain|shower|drizzle/.test(s)) return "rain";
  // Kept in step with WidgetUpdateWorker.kind() on Android, so the app and the background DJ agree.
  if (/fog|haze|smoke|mist|dust/.test(s)) return "fog";
  if (/partly|partial|scattered clouds|few clouds/.test(s)) return "partly";
  if (/cloud|overcast/.test(s) && !/mostly (sunny|clear)/.test(s)) return "cloudy";
  return "clear";
}
const WET = ["storm", "rain", "snow"];

// An hour only counts as stormy/rainy/snowy when it's more likely than not (50%+). "Chance of storms, 35%"
// usually means a mostly dry hour, so it counts as partly cloudy instead (and shows up as "possible" in the text).
function hourSky(h) {
  const k = skyKind(h.desc);
  return WET.includes(k) && (h.pop ?? 100) < 50 ? "partly" : k;
}

function skyOf(hours) {
  const kinds = hours.map(hourSky), share = (x) => kinds.filter((y) => y === x).length / kinds.length;
  if (share("storm") >= 0.25) return "storm";
  if (share("snow") >= 0.3) return "snow";
  if (share("rain") + share("storm") >= 0.3) return "rain";
  if (share("fog") >= 0.5) return "fog";
  const counts = ["cloudy", "partly", "clear"].map((x) => [x, share(x)]).sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

// Right now, what you see out the window wins: the latest observation, unless rain/storms are likely within the hour.
function skyNowFrom(d) {
  const obs = skyKind(d?.current?.desc);
  const soon = (d?.hourly || []).slice(0, 1).map(hourSky)[0];
  return WET.includes(soon) && !WET.includes(obs) ? soon : obs;
}

// Wet weather that's possible but not likely in this stretch, e.g. "storms possible (35%)".
function possibleNote(hours, sky) {
  if (WET.includes(sky)) return "";
  const wet = hours.filter((h) => WET.includes(skyKind(h.desc)) && (h.pop || 0) >= 20);
  if (!wet.length) return "";
  const k = wet.some((h) => skyKind(h.desc) === "storm") ? "storms" : wet.some((h) => skyKind(h.desc) === "snow") ? "snow" : "showers";
  const top = Math.max(...wet.map((h) => h.pop || 0));
  return ` · ${k} ${top >= 50 ? "likely for part of it" : "possible"} (${top}%)`;
}

// Style, a few artists to start with, and why it fits. Keyed by sky, then part of day ("any" = all parts).
const SOUNDTRACKS = {
  storm: {
    any: ["Cinematic post-rock", ["Mogwai", "Godspeed You! Black Emperor", "This Will Destroy You"], "Quiet stretches that break into huge walls of sound, like the storm itself."],
    night: ["Dark ambient", ["Bohren & der Club of Gore", "Lustmord", "Midwife"], "Low, slow and heavy. Good for listening to thunder roll in the dark."]
  },
  rain: {
    morning: ["Ambient post-rock", ["Explosions in the Sky", "Hammock", "Sigur Rós"], "Slow-building guitars for grey light and wet streets."],
    afternoon: ["Downtempo and trip-hop", ["Bonobo", "Massive Attack", "Nujabes"], "Steady beats with room to think while the rain keeps going."],
    evening: ["Late-night jazz", ["Chet Baker", "Miles Davis", "Bill Evans"], "Soft trumpet and piano, made for rain on the window."],
    night: ["Late-night jazz", ["Bohren & der Club of Gore", "Chet Baker", "Bill Evans"], "Slow, smoky and quiet, like the city after rain."]
  },
  snow: {
    any: ["Winter piano", ["Ólafur Arnalds", "Ludovico Einaudi", "Erik Satie"], "Sparse, gentle piano that matches the hush snow puts over everything."],
    evening: ["Glacial ambient", ["Sigur Rós", "Jónsi & Alex", "Stars of the Lid"], "Wide, slow soundscapes from Iceland, where they know snow."]
  },
  fog: {
    any: ["Ambient and minimalism", ["Brian Eno", "Stars of the Lid", "Max Richter"], "Soft-edged music with no hard corners, like the fog."],
    evening: ["Dream pop", ["Cocteau Twins", "Beach House", "Slowdive"], "Hazy, reverb-soaked songs that blur at the edges."]
  },
  cloudy: {
    morning: ["Modern classical", ["Ólafur Arnalds", "Nils Frahm", "Max Richter"], "Calm strings and piano for a soft, grey start."],
    afternoon: ["Indie folk", ["Bon Iver", "Iron & Wine", "Fleet Foxes"], "Warm voices and acoustic guitars against a muted sky."],
    evening: ["Shoegaze", ["Slowdive", "My Bloody Valentine", "Ride"], "Big, blurry guitars that suit a low ceiling of clouds."],
    night: ["Ambient electronic", ["Boards of Canada", "Tycho", "Jon Hopkins"], "Gentle, glowing synths for a dark, quiet night."]
  },
  partly: {
    morning: ["Acoustic and indie folk", ["Nick Drake", "José González", "Novo Amor"], "Light and easy, like sun breaking through now and then."],
    afternoon: ["Impressionist classical", ["Claude Debussy", "Erik Satie", "Maurice Ravel"], "Music written to paint shifting light, just like a sky of sun and clouds."],
    evening: ["Chillwave and downtempo", ["Tycho", "Washed Out", "Khruangbin"], "Warm, sunset-colored grooves to wind down to."],
    night: ["Ambient electronic", ["Boards of Canada", "Jon Hopkins", "Aphex Twin (Selected Ambient Works)"], "Soft synths for a night with a few clouds drifting by."]
  },
  clear: {
    morning: ["Bright Baroque", ["Vivaldi (The Four Seasons)", "Bach (Brandenburg Concertos)", "Handel"], "Lively strings for a clear, sunny start."],
    afternoon: ["Windows-down rock", ["Fleetwood Mac", "The War on Drugs", "Tame Impala"], "Sunny, driving songs made for blue skies."],
    evening: ["Synthwave", ["The Midnight", "FM-84", "Kavinsky"], "Neon '80s synths for a clear sunset (try it with the 80s look)."],
    night: ["Space ambient", ["Brian Eno (Apollo)", "Hammock", "Jon Hopkins"], "Music for looking up at a clear, starry sky."]
  }
};
// Heat and cold nudge the afternoon pick.
const HOT = ["Surf rock and sunny psych", ["Khruangbin", "Allah-Las", "The Growlers"], "Laid-back, reverb-heavy guitars for a hot afternoon."];
const COLD_CLEAR = ["Nordic folk and post-rock", ["Agnes Obel", "Sigur Rós", "Efterklang"], "Crisp and clear, like cold, bright air."];

function pickSoundtrack(sky, part, avgC) {
  if (part === "afternoon" && (sky === "clear" || sky === "partly") && avgC >= 29) return HOT;
  if (part !== "night" && sky === "clear" && avgC <= 4) return COLD_CLEAR;
  const s = SOUNDTRACKS[sky];
  return s[part] || s.any;
}

// "2026-11-17" for the block an hour belongs to (night after midnight belongs to the evening before). The Android
// DJ worker computes the same key, so it can find the card for the block it's in.
function blockDay(time) {
  const d = new Date(time.getTime() - (time.getHours() <= 4 ? 864e5 : 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The next three parts of the day that have at least two forecast hours.
function dayParts(hourly) {
  const groups = [];
  for (const h of hourly) {
    const p = partOf(h.time.getHours());
    // Night runs past midnight, so it's grouped by the evening it starts from.
    const anchor = new Date(h.time.getTime() - (h.time.getHours() <= 4 ? 864e5 : 0)).toDateString();
    const key = p + anchor;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.hours.push(h);
    else groups.push({ key, part: p, hours: [h], anchor, dayKey: blockDay(h.time) });
  }
  const today = new Date().toDateString();
  return groups.filter((g, i) => g.hours.length >= 2 || i === 0).slice(0, 3).map((g) => {
    const isToday = g.anchor === today;
    const name = g.part === "night" ? (isToday ? "Tonight" : "Tomorrow night")
      : `${isToday ? "This" : "Tomorrow"} ${g.part}`;
    return { ...g, name };
  });
}

// The Spotify playlist search for a sky + part of day, e.g. "rainy day Late-night jazz".
// The Weather DJ (dj.js + the Android background worker) uses the same queries.
const SKY_MOOD = { storm: "stormy", rain: "rainy day", snow: "snowy day", fog: "foggy", cloudy: "cloudy day", partly: "", clear: "sunny" };
function moodQuery(sky, part, style) {
  const night = part === "night" || part === "evening";
  const mood = sky === "clear" && night ? "" : SKY_MOOD[sky];
  return `${mood} ${style.replace(/ and /, " ").replace(/ \(.*\)/, "")}`.trim();
}

function soundtrackHtml(d) {
  if (!d?.hourly?.length) return "";
  const parts = dayParts(d.hourly);
  if (!parts.length) return "";
  let peek = "";
  const cards = parts.map((g) => {
    // The part of the day you're in now follows the current conditions; later parts follow the forecast.
    const sky = g === parts[0] && g.hours[0].time - Date.now() < 3600e3 ? skyNowFrom(d) : skyOf(g.hours);
    const temps = g.hours.map((h) => h.tempC).filter((x) => x != null);
    const avgC = temps.length ? temps.reduce((a, x) => a + x, 0) / temps.length : 15;
    const pop = Math.max(0, ...g.hours.map((h) => h.pop || 0));
    const [style, artists, why] = pickSoundtrack(sky, g.part, avgC);
    if (!peek) { peek = `${esc(g.name)}: ${esc(style)}`; window.soundtrackBrief = { name: g.name, style }; }
    const night = g.part === "night" || g.part === "evening";
    const skyWord = { storm: "Storms", rain: "Rain", snow: "Snow", fog: "Fog", cloudy: "Cloudy", partly: night ? "Some clouds" : "Partly sunny", clear: night ? "Clear" : "Sunny" }[sky];
    const weather = `${skyWord}${WET.includes(sky) && pop >= 30 ? ` (${Math.round(pop)}%)` : ""}, around ${t(avgC)}${possibleNote(g.hours, sky)}`;
    // Spotify's playlist search for the style plus the mood. Opens the Spotify app on Android.
    const q = encodeURIComponent(moodQuery(sky, g.part, style));
    return `<div class="track">
      <div class="track-when"><b>${esc(g.name)}</b><span>${esc(weather)}</span></div>
      <div class="track-style">${esc(style)}</div>
      <p>${esc(why)}</p>
      <p class="track-artists">Try ${artists.map(esc).join(", ")}</p>
      <p class="track-pl"></p>
      <p class="track-links"><a class="spotify" data-q="${esc(decodeURIComponent(q))}" data-block="${g.dayKey}/${g.part}" data-sky="${sky}" href="https://open.spotify.com/search/${q}" target="_blank" rel="noopener">Find on Spotify</a><a href="https://music.youtube.com/search?q=${q}" target="_blank" rel="noopener">YouTube Music</a></p>
    </div>`;
  });
  // The part of the day you're in now, with the rest of today and tomorrow one tap away.
  const rows = cards[0] + (cards.length > 1 ? `<details class="track-later" data-sec="music-later"${secOpen("music-later")}><summary>Later: ${parts.slice(1).map((g) => esc(g.name.toLowerCase())).join(", ")}</summary><div class="tracks">${cards.slice(1).join("")}</div></details>` : "");
  return `<section class="panel soundtrack" aria-label="Soundtrack for your day">
    <details class="alm-all" data-sec="music"${secOpen("music")}>
      ${secSummary("Soundtrack for your day", peek)}
      <p class="hint">Music picked to match the weather ahead.</p>
      <div id="djSlot"></div>
      <div class="tracks">${rows}</div>
    </details>
  </section>`;
}

function mountSoundtrack() {
  const slot = $("soundtrackSlot");
  if (!slot) return;
  const html = soundtrackHtml(lastData);
  if (!html) { slot.remove(); return; }
  slot.outerHTML = html;
  if (typeof mountDJ === "function") mountDJ();
  linkPlaylists();
}

// With Spotify connected (Weather DJ), point each Spotify button straight at a real matching playlist instead
// of a search. Picks are cached for the day so the buttons don't change every time the screen refreshes.
async function linkPlaylists() {
  if (typeof djLoad !== "function" || typeof findPlaylist !== "function") return;
  const dj = await djLoad().catch(() => ({}));
  if (!dj.refresh) return;
  const day = new Date().toDateString();
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem("lw.plCache") || "{}"); } catch { }
  if (cache.day !== day) cache = { day };
  const blocks = {};   // what each card picked, so the Weather DJ plays the same playlist in that part of the day
  for (const a of document.querySelectorAll(".track-links a.spotify[data-q]")) {
    const q = a.dataset.q;
    let pl = cache[q];
    if (!pl) {
      const found = await findPlaylist(q).catch(() => null);
      if (!found) continue;
      pl = cache[q] = { id: found.id || found.uri.split(":").pop(), name: found.name };
    }
    blocks[a.dataset.block] = { sky: a.dataset.sky, q, uri: `spotify:playlist:${pl.id}`, name: pl.name };
    a.href = `https://open.spotify.com/playlist/${encodeURIComponent(pl.id)}`;
    a.textContent = "Open playlist on Spotify";
    a.title = pl.name;
    const name = a.closest(".track")?.querySelector(".track-pl");
    if (name) name.textContent = `Playlist: ${pl.name}`;
  }
  try { localStorage.setItem("lw.plCache", JSON.stringify(cache)); } catch { }
  if (Object.keys(blocks).length) await djSave({ blocks }).catch(() => {});
}

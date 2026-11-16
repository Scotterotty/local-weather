// Soundtrack for your day: reads the next 24 hours of the forecast, splits it into parts of the day,
// and suggests a style of music that fits each one's weather, temperature and light.
// Needs only the forecast already loaded (no extra requests). Loaded after index.html's main script.

const PARTS = [   // [first hour, last hour, name]
  [5, 11, "morning"], [12, 16, "afternoon"], [17, 21, "evening"], [22, 4, "night"]
];
const partOf = (h) => PARTS.find(([a, b]) => a <= b ? h >= a && h <= b : h >= a || h <= b)[2];

// The sky for a stretch of hours, in one word. Wet or wild weather wins over the most common sky.
function skyOf(hours) {
  const k = (h) => {
    const s = (h.desc || "").toLowerCase();
    if (/thunder|t-storm/.test(s)) return "storm";
    if (/snow|sleet|flurr|ice|freezing/.test(s)) return "snow";
    if (/rain|shower|drizzle/.test(s)) return "rain";
    if (/fog|haze|smoke|mist/.test(s)) return "fog";
    if (/overcast|^cloudy|mostly cloudy/.test(s)) return "cloudy";
    if (/partly|few clouds/.test(s)) return "partly";
    return "clear";
  };
  const kinds = hours.map(k), share = (x) => kinds.filter((y) => y === x).length / kinds.length;
  const maxPop = Math.max(0, ...hours.map((h) => h.pop || 0));
  if (kinds.includes("storm")) return "storm";
  if (share("snow") >= 0.3) return "snow";
  if (share("rain") >= 0.3 || maxPop >= 55) return "rain";
  if (share("fog") >= 0.5) return "fog";
  const counts = ["cloudy", "partly", "clear"].map((x) => [x, share(x)]).sort((a, b) => b[1] - a[1]);
  return counts[0][0];
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
    else groups.push({ key, part: p, hours: [h], anchor });
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
  const rows = parts.map((g) => {
    const sky = skyOf(g.hours);
    const temps = g.hours.map((h) => h.tempC).filter((x) => x != null);
    const avgC = temps.length ? temps.reduce((a, x) => a + x, 0) / temps.length : 15;
    const pop = Math.max(0, ...g.hours.map((h) => h.pop || 0));
    const [style, artists, why] = pickSoundtrack(sky, g.part, avgC);
    const night = g.part === "night" || g.part === "evening";
    const skyWord = { storm: "Storms", rain: "Rain", snow: "Snow", fog: "Fog", cloudy: "Cloudy", partly: night ? "Some clouds" : "Partly sunny", clear: night ? "Clear" : "Sunny" }[sky];
    const weather = `${skyWord}${pop >= 30 && sky !== "clear" ? ` (${Math.round(pop)}%)` : ""}, around ${t(avgC)}`;
    // Spotify's playlist search for the style plus the mood. Opens the Spotify app on Android.
    const q = encodeURIComponent(moodQuery(sky, g.part, style));
    return `<div class="track">
      <div class="track-when"><b>${esc(g.name)}</b><span>${esc(weather)}</span></div>
      <div class="track-style">${esc(style)}</div>
      <p>${esc(why)}</p>
      <p class="track-artists">Try ${artists.map(esc).join(", ")}</p>
      <p class="track-links"><a class="spotify" href="https://open.spotify.com/search/${q}/playlists" target="_blank" rel="noopener">Playlists on Spotify</a><a href="https://music.youtube.com/search?q=${q}" target="_blank" rel="noopener">YouTube Music</a></p>
    </div>`;
  }).join("");
  return `<section class="panel soundtrack" aria-label="Soundtrack for your day">
    <details class="alm-all" data-sec="music"${typeof secOpen === "function" ? secOpen("music") : " open"}>
      <summary><h2 class="label">Soundtrack for your day</h2></summary>
      <p class="hint">Music picked to match the weather ahead.</p>
      <div class="tracks">${rows}</div>
      <div id="djSlot"></div>
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
}

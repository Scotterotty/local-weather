// Weather DJ: plays a Spotify playlist that fits the weather, and switches it when the weather changes, at the end
// of the current song. Spotify Premium + a personal Spotify developer app (Client ID).
//
// This file does sign-in (PKCE, no secret) and starting/stopping. In the Android app, SpotifyDjWorker checks the
// sky every 15 minutes in the background and does the switching; both share one JSON blob, "lw.dj", stored with
// @capacitor/preferences (the native side reads it from SharedPreferences "CapacitorStorage").
// In a browser, "lw.dj" lives in localStorage, Spotify sends you back to this page's own address, and the
// switching (djWebCheck below, the same rules as the worker) runs while the page is open.

// Scott's Spotify developer app (a Client ID is public; there is no secret with PKCE).
const DJ_CLIENT_ID = "eb808675c00945109229536e4b636184";
const DJ_NATIVE = !!window.Capacitor?.isNativePlatform?.();
// Each redirect has to be listed in the Spotify developer app. The web one is this page's address without
// "index.html" or the query, e.g. https://scotterotty.github.io/local-weather/
const DJ_REDIRECT = DJ_NATIVE ? "com.scotterotty.localweather://spotify" : location.origin + location.pathname.replace(/index\.html$/, "");
const DJ_SCOPES = "user-read-playback-state user-modify-playback-state";
// Same get/set/remove shape as @capacitor/preferences, backed by localStorage in a browser.
const djWebPrefs = {
  async get({ key }) { try { return { value: localStorage.getItem(key) }; } catch { return { value: null }; } },
  async set({ key, value }) { try { localStorage.setItem(key, value); } catch { } },
  async remove({ key }) { try { localStorage.removeItem(key); } catch { } }
};
const djPrefs = () => DJ_NATIVE ? window.Capacitor.Plugins?.Preferences : djWebPrefs;
let djMsg = "";   // last status/error line shown under the buttons

async function djLoad() {
  const p = djPrefs();
  if (!p) return {};
  let o = {};
  try { o = JSON.parse((await p.get({ key: "lw.dj" })).value || "{}"); } catch { }
  if (!o.clientId) o.clientId = DJ_CLIENT_ID;
  return o;
}
async function djSave(patch) {
  const p = djPrefs();
  const cur = await djLoad();          // re-read first: the background worker may have rotated the token
  const next = { ...cur, ...patch };
  await p.set({ key: "lw.dj", value: JSON.stringify(next) });
  return next;
}

// ---------- sign-in (Authorization Code with PKCE) ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function djConnect() {
  const dj = await djLoad();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
  await djSave({ verifier, state });
  const q = new URLSearchParams({ response_type: "code", client_id: dj.clientId, scope: DJ_SCOPES, redirect_uri: DJ_REDIRECT,
    code_challenge_method: "S256", code_challenge: challenge, state });
  location.href = `https://accounts.spotify.com/authorize?${q}`;   // app: opens the phone's browser, comes back via the redirect; web: comes back to this page
}

async function tokenRequest(body) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Spotify sign-in failed (${r.status})`);
  return j;
}

// The Android app saves the redirect's ?code= here when Spotify sends you back. On the web, djCatchRedirect does.
async function djFinishSignIn() {
  const p = djPrefs();
  if (!p) return;
  const raw = (await p.get({ key: "lw.djAuth" })).value;
  if (!raw) return;
  await p.remove({ key: "lw.djAuth" });
  const auth = JSON.parse(raw), dj = await djLoad();
  try {
    if (auth.error) throw new Error(auth.error === "access_denied" ? "Spotify sign-in was cancelled." : auth.error);
    if (!auth.code || auth.state !== dj.state) throw new Error("Sign-in didn't match. Tap Connect again.");
    const t = await tokenRequest({ grant_type: "authorization_code", code: auth.code, redirect_uri: DJ_REDIRECT, client_id: dj.clientId, code_verifier: dj.verifier });
    await djSave({ access: t.access_token, refresh: t.refresh_token, accessExp: Date.now() + t.expires_in * 1000, verifier: null, state: null });
    djMsg = "Connected to Spotify.";
  } catch (e) { djMsg = e.message; }
  renderDJ();
}

async function djToken() {
  let dj = await djLoad();
  if (dj.access && dj.accessExp > Date.now() + 60000) return dj.access;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: dj.refresh, client_id: dj.clientId });
  dj = await djSave({ access: t.access_token, accessExp: Date.now() + t.expires_in * 1000, ...(t.refresh_token ? { refresh: t.refresh_token } : {}) });
  return dj.access;
}
async function spotify(method, path, body) {
  const r = await fetch(`https://api.spotify.com/v1${path}`, {
    method, headers: { Authorization: `Bearer ${await djToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j?.error?.message || `Spotify error ${r.status}`;
    throw Object.assign(new Error(r.status === 403 && /premium/i.test(msg) ? "Spotify says this needs Premium." : msg), { status: r.status });
  }
  return j;
}

// Best playlist for a search: real playlists with enough songs; a little variety among the top few.
async function findPlaylist(query, avoid) {
  const j = await spotify("GET", `/search?${new URLSearchParams({ q: query, type: "playlist", limit: "10" })}`);
  const good = (j?.playlists?.items || []).filter((p) => p && p.uri !== avoid && (p.tracks?.total ?? p.items?.total ?? 30) >= 15);
  return good[Math.floor(Math.random() * Math.min(3, good.length))] || null;
}

// What every sky/part combination should search for, so the background worker uses the same picks as this screen.
function djStyles() {
  const out = {};
  for (const sky of ["storm", "rain", "snow", "fog", "cloudy", "partly", "clear"]) {
    out[sky] = {};
    for (const part of ["morning", "afternoon", "evening", "night"]) out[sky][part] = moodQuery(sky, part, pickSoundtrack(sky, part, 15)[0]);
  }
  return out;
}

// The sky and part of day right now, from the forecast on screen.
function moodNow() {
  const part = partOf(new Date().getHours());
  const sky = skyKind(lastData?.current?.desc);   // what's observed right now, never forecast chances
  return { sky, part };
}

// While nothing is playing, keep the ready-to-play pick in step with the weather and time of day
// (the background switcher only acts while the DJ's playlist is playing).
// The playlist for this part of the day: the one its Soundtrack card shows, if the card was picked for the same
// sky we have now; otherwise a fresh search for this sky + part of day.
async function pickFor(dj, sky, part, avoid) {
  const card = dj.blocks?.[`${blockDay(new Date())}/${part}`];
  if (card?.uri && card.sky === sky && card.uri !== avoid) return { uri: card.uri, name: card.name };
  return findPlaylist(djStyles()[sky][part], avoid);
}

async function djRefreshPick(dj) {
  if (!lastData) return dj;
  const { sky, part } = moodNow();
  // New music when the conditions change, or when morning turns to afternoon, afternoon to evening, and so on.
  if (dj.sky === sky && dj.part === part) return dj;
  const styles = djStyles();
  const pl = await pickFor(dj, sky, part, dj.context).catch(() => null);
  if (!pl) return dj;
  return djSave({ styles, sky, part, mood: `${sky}/${part}`, context: pl.uri, playlistName: pl.name, pending: null, next: null });
}

async function djStart() {
  djMsg = "Starting…"; renderDJ();
  try {
    const { sky, part } = moodNow();
    const styles = djStyles();
    const pl = await pickFor(await djLoad(), sky, part);
    if (!pl) throw new Error("Couldn't find a playlist for this weather. Try again in a moment.");
    const devs = (await spotify("GET", "/me/player/devices"))?.devices || [];
    const dev = devs.find((d) => d.is_active) || devs.find((d) => d.type === "Smartphone") || devs[0];
    if (!dev) throw new Error("Open the Spotify app first (it just needs to be open), then tap Start again.");
    await spotify("PUT", `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, { context_uri: pl.uri });
    spotify("PUT", `/me/player/shuffle?state=true&device_id=${encodeURIComponent(dev.id)}`).catch(() => {});
    await djSave({ on: true, styles, sky, part, mood: `${sky}/${part}`, context: pl.uri, playlistName: pl.name, pending: null, next: null, startedAt: Date.now() });
    djMsg = "";
  } catch (e) { djMsg = e.message; }
  renderDJ();
}
// Play (or resume) the DJ's current playlist without picking a new one; Pause pauses Spotify.
async function pickDevice() {
  const devs = (await spotify("GET", "/me/player/devices"))?.devices || [];
  const dev = devs.find((d) => d.is_active) || devs.find((d) => d.type === "Smartphone") || devs[0];
  if (!dev) throw new Error("Open the Spotify app first (it just needs to be open), then tap Play again.");
  return dev;
}
async function djPlay() {
  try {
    const dj = await djLoad(), p = await spotify("GET", "/me/player").catch(() => null);
    if (p && p.context?.uri === dj.context && !p.is_playing) await spotify("PUT", "/me/player/play");   // resume where it was
    else if (!(p && p.context?.uri === dj.context && p.is_playing)) {
      const dev = await pickDevice();
      await spotify("PUT", `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, { context_uri: dj.context });
      spotify("PUT", `/me/player/shuffle?state=true&device_id=${encodeURIComponent(dev.id)}`).catch(() => {});
    }
    djMsg = "";
  } catch (e) { djMsg = e.message; }
  setTimeout(renderDJ, 600);   // give Spotify a moment before reading the new state
}
async function djPause() {
  try { await spotify("PUT", "/me/player/pause"); djMsg = ""; } catch (e) { djMsg = e.message; }
  setTimeout(renderDJ, 600);
}

async function djStop() { clearTimeout(djSwitchTimer); await djSave({ on: false, next: null }); djMsg = "Weather DJ is off. Your music keeps playing."; renderDJ(); }
async function djForget() { const p = djPrefs(); await p.remove({ key: "lw.dj" }); djMsg = ""; renderDJ(); }

// ---------- UI (inside the Soundtrack panel) ----------
// Same-size drawn icons (the ▶ and ❚❚ characters render at very different sizes on Android).
const DJ_ICON = {
  play: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.2v9.6L10.5 6z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 1.5h2.8v9H2.2zM7 1.5h2.8v9H7z" fill="currentColor"/></svg>`
};
const SKY_NOW = { storm: "the storm", rain: "the rain", snow: "the snow", fog: "haze or fog", cloudy: "cloudy skies", partly: "partly cloudy skies", clear: "clear skies" };
const SKY_WORD = { storm: "stormy", rain: "rainy", snow: "snowy", fog: "hazy or foggy", cloudy: "cloudy", partly: "partly cloudy", clear: "clear" };
async function renderDJ() {
  const el = $("dj");
  if (!el) return;
  let dj = await djLoad();
  let body;
  if (!dj.clientId) {
    body = `<p>Got Spotify Premium? The Weather DJ plays a playlist that fits the weather, and when the sky changes it switches after the current song ends.</p>
      <form class="dj-row" id="djIdForm"><input id="djId" placeholder="Spotify Client ID" autocomplete="off" spellcheck="false" aria-label="Spotify Client ID"><button type="submit">Save</button></form>
      <p class="hint">One-time setup: create a free app at developer.spotify.com with the redirect <code>${DJ_REDIRECT}</code>, then paste its Client ID here.</p>`;
  } else if (!dj.refresh) {
    body = `<p>Connect your Spotify account so the Weather DJ can pick and switch playlists.</p>
      <div class="dj-row"><button type="button" class="dj-go" id="djConnect">Connect Spotify</button></div>`;
  } else if (!dj.on) {
    body = `<p>Plays a playlist for the weather right now on your ${DJ_NATIVE ? "phone's " : ""}Spotify, and switches it when the sky changes (after the song that's playing ends).${DJ_NATIVE ? "" : " In a browser it switches while Sunnyloha is open."}</p>
      <div class="dj-row"><button type="button" class="dj-go" id="djStart">Start Weather DJ</button><button type="button" id="djForget">Disconnect</button></div>`;
  } else {
    const p = await spotify("GET", "/me/player").catch(() => undefined);   // undefined = couldn't reach Spotify
    const playing = !!(p && p.is_playing && p.context?.uri === dj.context);
    // Only re-pick when Spotify clearly isn't playing our playlist. If Spotify couldn't be reached, don't touch it,
    // or the background switcher would stop recognizing the music that's playing.
    if (!playing && p !== undefined) dj = await djRefreshPick(dj);
    const id = (dj.context || "").split(":").pop();
    body = `<p><b>On.</b> ${playing ? "Playing" : "Ready to play"} <b>${esc(dj.playlistName || "a weather playlist")}</b> for ${esc(SKY_NOW[dj.sky] || "the weather right now")}${dj.part ? (dj.part === "night" ? " tonight" : ` this ${esc(dj.part)}`) : ""}.${playing && p.item ? ` Now: ${esc(p.item.name)} · ${esc((p.item.artists || []).map((a) => a.name).join(", "))}.` : ""} Changes with the weather and with the time of day (morning, afternoon, evening, night), after the song that's playing${DJ_NATIVE ? "" : ", while this page is open"}.</p>
      ${dj.lastCheck ? `<p class="hint">Last check ${esc(fmtTime(new Date(dj.lastCheck.at)))}${dj.lastCheck.sky ? `: ${esc(SKY_WORD[dj.lastCheck.sky] || dj.lastCheck.sky)}` : ""}, ${esc(dj.lastCheck.what)}.</p>` : ""}
      <div class="dj-row">${playing ? `<button type="button" class="dj-go dj-pp" id="djPause">${DJ_ICON.pause}Pause</button>` : `<button type="button" class="dj-go dj-pp" id="djPlay">${DJ_ICON.play}Play</button>`}<button type="button" id="djStart">New playlist</button><button type="button" id="djStop">Turn off</button></div>
      ${id ? `<p class="hint"><a href="https://open.spotify.com/playlist/${esc(id)}" target="_blank" rel="noopener">Open this playlist in Spotify</a> to follow or save it.</p>` : ""}`;
  }
  el.innerHTML = `<h3>Weather DJ</h3>${body}${djMsg ? `<p class="dj-msg">${esc(djMsg)}</p>` : ""}`;
  $("djIdForm")?.addEventListener("submit", async (e) => { e.preventDefault(); const v = $("djId").value.trim(); if (!/^[0-9a-f]{32}$/i.test(v)) { djMsg = "That doesn't look like a Client ID (32 letters and numbers)."; return renderDJ(); } djMsg = ""; await djSave({ clientId: v }); renderDJ(); });
  $("djConnect")?.addEventListener("click", djConnect);
  $("djStart")?.addEventListener("click", djStart);
  $("djStop")?.addEventListener("click", djStop);
  $("djPlay")?.addEventListener("click", djPlay);
  $("djPause")?.addEventListener("click", djPause);
  $("djForget")?.addEventListener("click", djForget);
}

function mountDJ() {
  const slot = $("djSlot");
  if (!slot) return;
  slot.outerHTML = `<div class="dj" id="dj"></div>`;
  renderDJ();
}

// ---------- web only: sign-in return and switching while the page is open ----------
// Spotify sends the browser back to this page with ?code=…&state=… (or ?error=…). Save it the same way the Android
// app does, tidy the address, and show the Music tab.
function djCatchRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has("state") || !(q.has("code") || q.has("error"))) return;
  const auth = { code: q.get("code"), state: q.get("state"), error: q.get("error") };
  try { localStorage.setItem("lw.djAuth", JSON.stringify(auth)); } catch { }
  history.replaceState(null, "", location.pathname + "#music");
  if (typeof setTab === "function") setTab("music");
}

// Same rules as SpotifyDjWorker.check()/doSwitch(): only while the DJ's own playlist is playing; a new part of the
// day or rain/snow/storms starting or stopping switches at the end of this song; other sky changes must show up on
// two checks in a row. Uses the observed conditions on screen (never forecast chances).
let djSwitchTimer = 0;
const djWet = (s) => s === "rain" || s === "snow" || s === "storm";
const djLog = (sky, what) => djSave({ lastCheck: { at: Date.now(), sky, what } });
async function djWebCheck() {
  let dj = await djLoad();
  if (!dj.on || !dj.refresh || !lastData) return;
  const p = await spotify("GET", "/me/player").catch(() => undefined);
  if (p === undefined) return;   // couldn't reach Spotify: try again next time
  const ours = !!(p && p.is_playing && p.context?.uri === dj.context);
  const { sky, part } = moodNow();
  const newPart = part !== dj.part;
  if (sky === dj.sky && !newPart) { await djSave({ pending: null }); return djLog(sky, "same as before, no change"); }
  const why = newPart ? `it's now ${part === "night" ? "night" : "the " + part}` : "conditions changed";
  if (!ours) {
    await djRefreshPick(dj);
    dj = await djLoad();
    return djLog(sky, `${why}; nothing playing, so the next Play uses ${dj.playlistName || "a new playlist"}`);
  }
  const sure = newPart || djWet(sky) || djWet(dj.sky);
  if (!sure && dj.pending !== sky) { await djSave({ pending: sky }); return djLog(sky, "conditions changed; confirming on the next check"); }
  const left = (p.item?.duration_ms || 0) - (p.progress_ms || 0) - 1500;
  if (dj.next && dj.next.sky === sky && dj.next.part === part) return djScheduleSwitch(left);   // already lined up (timer lost on reload)
  const pl = await pickFor(dj, sky, part, dj.context).catch(() => null);
  if (!pl) return djLog(sky, `${why}, but no playlist found`);
  await djSave({ next: { uri: pl.uri, name: pl.name, sky, part, track: p.item?.id || "" }, pending: null });
  await djLog(sky, `${why}; switching to ${pl.name} when this song ends`);
  djScheduleSwitch(left);
  renderDJ();
}
function djScheduleSwitch(ms) { clearTimeout(djSwitchTimer); djSwitchTimer = setTimeout(djWebSwitch, Math.max(0, ms)); }
async function djWebSwitch() {
  const dj = await djLoad(), next = dj.next;
  if (!dj.on || !next) return;
  const p = await spotify("GET", "/me/player").catch(() => null);
  if (!(p && p.is_playing && p.context?.uri === dj.context)) { await djSave({ next: null }); return djLog(next.sky, "switch skipped: music was paused or changed"); }   // leave your music alone
  const left = (p.item?.duration_ms || 0) - (p.progress_ms || 0);
  if (p.item && p.item.id === next.track && left > 4000) return djScheduleSwitch(left - 1500);   // same song still going: wait for its end
  try {
    await spotify("PUT", "/me/player/play", { context_uri: next.uri });
    spotify("PUT", "/me/player/shuffle?state=true").catch(() => {});
    await djSave({ context: next.uri, playlistName: next.name, sky: next.sky, part: next.part, mood: `${next.sky}/${next.part}`, next: null });
    await djLog(next.sky, `switched to ${next.name}`);
  } catch (e) { djMsg = e.message; }
  renderDJ();
}

if (!DJ_NATIVE) {
  djCatchRedirect();
  setInterval(() => { djWebCheck().catch(() => {}); }, 5 * 6e4);   // every 5 minutes while the page is open
}
djFinishSignIn();
window.addEventListener("spotifyAuth", djFinishSignIn);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { djFinishSignIn(); renderDJ(); if (!DJ_NATIVE) djWebCheck().catch(() => {}); } });

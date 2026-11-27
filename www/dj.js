// Weather DJ: plays a Spotify playlist that fits the weather, and (on Android) switches it when the weather
// changes, at the end of the current song. Spotify Premium + a personal Spotify developer app (Client ID).
//
// This file does sign-in (PKCE, no secret) and starting/stopping. The Android app's SpotifyDjWorker checks the
// sky every 15 minutes in the background and does the switching. Both share one JSON blob, "lw.dj", stored with
// @capacitor/preferences (the native side reads it from SharedPreferences "CapacitorStorage").

// Scott's Spotify developer app (a Client ID is public; there is no secret with PKCE).
const DJ_CLIENT_ID = "eb808675c00945109229536e4b636184";
const DJ_REDIRECT = "com.scotterotty.localweather://spotify";
const DJ_SCOPES = "user-read-playback-state user-modify-playback-state";
const djPrefs = () => window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.Preferences : null;
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
  location.href = `https://accounts.spotify.com/authorize?${q}`;   // opens in the phone's browser, comes back via the redirect
}

async function tokenRequest(body) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Spotify sign-in failed (${r.status})`);
  return j;
}

// The Android app saves the redirect's ?code= here when Spotify sends you back.
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
// sunday = true gives the Sunday searches (saved as sundayStyles for the background worker).
// With seasonal picks on, these are this season's searches (still classical-only on Sundays).
function djStyles(sunday = false) {
  const out = {};
  for (const sky of ["storm", "rain", "snow", "fog", "cloudy", "partly", "clear"]) {
    out[sky] = {};
    for (const part of ["morning", "afternoon", "evening", "night"]) out[sky][part] = pickQuery(sky, part, picksFor(sky, part, 15, sunday).main);
  }
  return out;
}

// The sky and part of day right now, from the forecast on screen.
function moodNow() {
  const part = partOf(new Date().getHours());
  const sky = skyKind(lastData?.current?.desc);   // what's observed right now, never forecast chances
  return { sky, part, sunday: isSunday() };
}

// While nothing is playing, keep the ready-to-play pick in step with the weather and time of day
// (the background switcher only acts while the DJ's playlist is playing).
// The playlist for this part of the day: the one its Soundtrack card shows, if the card was picked for the same
// sky we have now; otherwise a fresh search for this sky + part of day.
async function pickFor(dj, sky, part, avoid, sunday = isSunday()) {
  const card = dj.blocks?.[`${blockDay(new Date())}/${part}`];
  if (card?.uri && card.sky === sky && !!card.sunday === sunday && card.uri !== avoid) return { uri: card.uri, name: card.name };
  return findPlaylist(djStyles(sunday)[sky][part], avoid);
}

// Which set of searches the DJ should be using: this season's, or the weather-only ones.
const djStyleKey = () => seasonalOn() ? seasonOf() : "weather";
// When seasonal picks are switched on or off, or the season changes (say, the holidays end), save the new searches
// for the background worker and drop the current mood, so the DJ picks new music (after the current song if playing).
async function djSyncStyles() {
  const dj = await djLoad();
  if (!dj.refresh || dj.styleKey === djStyleKey()) return dj;
  return djSave({ styles: djStyles(), sundayStyles: djStyles(true), styleKey: djStyleKey(), ...(dj.styleKey ? { sky: null } : {}) });
}

async function djRefreshPick(dj) {
  if (!lastData) return dj;
  const { sky, part, sunday } = moodNow();
  // New music when the conditions change, when morning turns to afternoon, afternoon to evening, and so on,
  // and when Sunday starts or ends.
  if (dj.sky === sky && dj.part === part && !!dj.sunday === sunday) return dj;
  const styles = djStyles(), sundayStyles = djStyles(true);
  const pl = await pickFor(dj, sky, part, dj.context, sunday).catch(() => null);
  if (!pl) return dj;
  return djSave({ styles, sundayStyles, styleKey: djStyleKey(), sky, part, sunday, mood: `${sky}/${part}`, context: pl.uri, playlistName: pl.name, pending: null, next: null });
}

async function djStart() {
  djMsg = "Starting…"; renderDJ();
  try {
    const { sky, part, sunday } = moodNow();
    const styles = djStyles(), sundayStyles = djStyles(true);
    const pl = await pickFor(await djLoad(), sky, part, undefined, sunday);
    if (!pl) throw new Error("Couldn't find a playlist for this weather. Try again in a moment.");
    await djSave({ on: true, styles, sundayStyles, styleKey: djStyleKey(), sky, part, sunday, mood: `${sky}/${part}`, context: pl.uri, playlistName: pl.name, pending: null, next: null, startedAt: Date.now() });
    djMsg = await playOnPhone(pl.uri) ? "" : DJ_WAKING;
  } catch (e) { djMsg = e.message; }
  renderDJ();
}
// Spotify's list of devices only includes the phone while its Spotify app is awake as a "Connect" device.
// Android puts an idle Spotify to sleep within a minute or so of leaving it, even though it still looks open in
// the recent-apps list, so the list often comes back empty. Ask a few times (it can take a moment to show up),
// then wake Spotify by opening the playlist in it and start playing as soon as the phone shows up.
const DJ_WAKING = "Opening Spotify to wake it up. The music will start in a moment. If it doesn't, come back here and tap Play.";
const djSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function findDevice(tries = 3) {
  for (let i = 0; i < tries; i++) {
    const devs = ((await spotify("GET", "/me/player/devices"))?.devices || []).filter((d) => !d.is_restricted);
    const dev = devs.find((d) => d.is_active) || devs.find((d) => d.type === "Smartphone") || devs[0];
    if (dev) return dev;
    if (i < tries - 1) await djSleep(1500);
  }
  return null;
}
async function playOn(dev, uri) {
  await spotify("PUT", `/me/player/play?device_id=${encodeURIComponent(dev.id)}`, { context_uri: uri });
  spotify("PUT", `/me/player/shuffle?state=true&device_id=${encodeURIComponent(dev.id)}`).catch(() => {});
}
let djWake = null;   // { uri, until } while we're waiting for a woken Spotify to show up
// Plays now if Spotify is reachable (true). Otherwise opens Spotify and keeps trying for a while (false).
async function playOnPhone(uri) {
  const dev = await findDevice();
  if (dev) { await playOn(dev, uri); return true; }
  djWake = { uri, until: Date.now() + 180000 };
  location.href = uri;   // spotify:playlist:… opens the Spotify app on this playlist, which wakes it up
  finishWake();
  return false;
}
// Keep looking for the woken phone. Runs while Spotify is in front if Android lets it, and again when you come back.
let djWaking = false;
async function finishWake() {
  if (djWaking) return;
  djWaking = true;
  try {
    while (djWake && Date.now() < djWake.until) {
      await djSleep(2000);
      const dev = await findDevice(1).catch(() => null);
      if (dev && djWake) {
        const uri = djWake.uri;
        djWake = null;
        await playOn(dev, uri);
        djMsg = "";
        setTimeout(renderDJ, 600);
        return;
      }
    }
    if (djWake) { djWake = null; djMsg = "Spotify didn't answer. Start any song in Spotify for a second, then come back and tap Play."; renderDJ(); }
  } catch (e) { djWake = null; djMsg = e.message; renderDJ(); }
  finally { djWaking = false; }
}

// Play (or resume) the DJ's current playlist without picking a new one; Pause pauses Spotify.
async function djPlay() {
  try {
    const dj = await djLoad(), p = await spotify("GET", "/me/player").catch(() => null);
    djMsg = "";
    if (p && p.context?.uri === dj.context && !p.is_playing) {
      // Resume where it was; if Spotify has gone to sleep since, wake it and start the playlist.
      try { await spotify("PUT", "/me/player/play"); }
      catch (e) { if (e.status !== 404) throw e; if (!await playOnPhone(dj.context)) djMsg = DJ_WAKING; }
    } else if (!(p && p.context?.uri === dj.context && p.is_playing)) {
      if (!await playOnPhone(dj.context)) djMsg = DJ_WAKING;
    }
  } catch (e) { djMsg = e.message; }
  setTimeout(renderDJ, 600);   // give Spotify a moment before reading the new state
}
async function djPause() {
  try { await spotify("PUT", "/me/player/pause"); djMsg = ""; } catch (e) { djMsg = e.message; }
  setTimeout(renderDJ, 600);
}

async function djStop() { await djSave({ on: false, next: null }); djMsg = "Weather DJ is off. Your music keeps playing."; renderDJ(); }
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
  if (dj.refresh) dj = await djSyncStyles().catch(() => dj);
  let body;
  if (!dj.clientId) {
    body = `<p>Got Spotify Premium? The Weather DJ plays a playlist that fits the weather, and when the sky changes it switches after the current song ends.</p>
      <form class="dj-row" id="djIdForm"><input id="djId" placeholder="Spotify Client ID" autocomplete="off" spellcheck="false" aria-label="Spotify Client ID"><button type="submit">Save</button></form>
      <p class="hint">One-time setup: create a free app at developer.spotify.com with the redirect <code>${DJ_REDIRECT}</code>, then paste its Client ID here.</p>`;
  } else if (!dj.refresh) {
    body = `<p>Connect your Spotify account so the Weather DJ can pick and switch playlists.</p>
      <div class="dj-row"><button type="button" class="dj-go" id="djConnect">Connect Spotify</button></div>`;
  } else if (!dj.on) {
    body = `<p>Plays a playlist for the weather right now on your phone's Spotify, and switches it when the sky changes (after the song that's playing ends).</p>
      <div class="dj-row"><button type="button" class="dj-go" id="djStart">Start Weather DJ</button><button type="button" id="djForget">Disconnect</button></div>`;
  } else {
    const p = await spotify("GET", "/me/player").catch(() => undefined);   // undefined = couldn't reach Spotify
    const playing = !!(p && p.is_playing && p.context?.uri === dj.context);
    // Only re-pick when Spotify clearly isn't playing our playlist. If Spotify couldn't be reached, don't touch it,
    // or the background switcher would stop recognizing the music that's playing.
    if (!playing && p !== undefined) dj = await djRefreshPick(dj);
    const id = (dj.context || "").split(":").pop();
    body = `<p><b>On.</b> ${playing ? "Playing" : "Ready to play"} <b>${esc(dj.playlistName || "a weather playlist")}</b> for ${esc(SKY_NOW[dj.sky] || "the weather right now")}${dj.part ? (dj.part === "night" ? " tonight" : ` this ${esc(dj.part)}`) : ""}.${playing && p.item ? ` Now: ${esc(p.item.name)} · ${esc((p.item.artists || []).map((a) => a.name).join(", "))}.` : ""} Changes with the weather and with the time of day (morning, afternoon, evening, night), after the song that's playing.</p>
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
  if (!djPrefs()) { slot.remove(); return; }   // needs the Android app (sign-in comes back to the app)
  slot.outerHTML = `<div class="dj" id="dj"></div>`;
  renderDJ();
}

if (djPrefs()) {
  djFinishSignIn();
  window.addEventListener("spotifyAuth", djFinishSignIn);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { djFinishSignIn(); if (djWake) finishWake(); renderDJ(); } });
}

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
  const sky = skyOf((lastData?.hourly || []).slice(0, 2).length ? lastData.hourly.slice(0, 2) : [{ desc: lastData?.current?.desc || "" }]);
  return { sky, part };
}

// While nothing is playing, keep the ready-to-play pick in step with the weather and time of day
// (the background switcher only acts while the DJ's playlist is playing).
async function djRefreshPick(dj) {
  if (!lastData) return dj;
  const { sky, part } = moodNow();
  if (dj.sky === sky && dj.part === part) return dj;
  const styles = djStyles();
  const pl = await findPlaylist(styles[sky][part], dj.context).catch(() => null);
  if (!pl) return dj;
  return djSave({ styles, sky, part, mood: `${sky}/${part}`, context: pl.uri, playlistName: pl.name, pending: null, next: null });
}

async function djStart() {
  djMsg = "Starting…"; renderDJ();
  try {
    const { sky, part } = moodNow();
    const styles = djStyles();
    const pl = await findPlaylist(styles[sky][part]);
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

async function djStop() { await djSave({ on: false, next: null }); djMsg = "Weather DJ is off. Your music keeps playing."; renderDJ(); }
async function djForget() { const p = djPrefs(); await p.remove({ key: "lw.dj" }); djMsg = ""; renderDJ(); }

// ---------- UI (inside the Soundtrack panel) ----------
// Same-size drawn icons (the ▶ and ❚❚ characters render at very different sizes on Android).
const DJ_ICON = {
  play: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.2v9.6L10.5 6z" fill="currentColor"/></svg>`,
  pause: `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 1.5h2.8v9H2.2zM7 1.5h2.8v9H7z" fill="currentColor"/></svg>`
};
const SKY_WORD = { storm: "stormy", rain: "rainy", snow: "snowy", fog: "foggy", cloudy: "cloudy", partly: "partly cloudy", clear: "clear" };
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
    body = `<p>Plays a playlist for the weather right now on your phone's Spotify, and switches it when the sky changes (after the song that's playing ends).</p>
      <div class="dj-row"><button type="button" class="dj-go" id="djStart">Start Weather DJ</button><button type="button" id="djForget">Disconnect</button></div>`;
  } else {
    const p = await spotify("GET", "/me/player").catch(() => null);
    let playing = !!(p && p.is_playing && p.context?.uri === dj.context);
    if (!playing) dj = await djRefreshPick(dj);
    const id = (dj.context || "").split(":").pop();
    body = `<p><b>On.</b> ${playing ? "Playing" : "Ready to play"} <b>${esc(dj.playlistName || "a weather playlist")}</b> for a ${esc(SKY_WORD[dj.sky] || "")} ${esc(dj.part || "")}.${playing && p.item ? ` Now: ${esc(p.item.name)} · ${esc((p.item.artists || []).map((a) => a.name).join(", "))}.` : ""} Checks the sky about every 15 minutes.</p>
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
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { djFinishSignIn(); renderDJ(); } });
}

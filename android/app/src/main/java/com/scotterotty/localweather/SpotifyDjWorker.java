package com.scotterotty.localweather;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.Calendar;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Weather DJ, background half. Every ~15 minutes: if Spotify is still playing the playlist the DJ started, look at
 * the sky right now. When it has changed (or morning turned into afternoon, etc.), find a playlist for the new
 * weather and switch to it when the current song ends. The web app (dj.js) handles sign-in and the first playlist;
 * both share the JSON in SharedPreferences "CapacitorStorage" / "lw.dj".
 */
public class SpotifyDjWorker extends Worker {
    private static final String PERIODIC = "lw-dj-periodic";
    private static final String SWITCH = "lw-dj-switch";
    private static final String PREFS = "CapacitorStorage";
    private static final String KEY = "lw.dj";

    public SpotifyDjWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // ---------- scheduling ----------
    private static Constraints net() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** Start or stop the 15-minute check to match whether the DJ is on. */
    static void sync(Context ctx) {
        JSONObject dj = load(ctx);
        WorkManager wm = WorkManager.getInstance(ctx);
        if (dj.optBoolean("on")) {
            PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(SpotifyDjWorker.class, 15, TimeUnit.MINUTES).setConstraints(net()).build();
            wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req);
        } else {
            wm.cancelUniqueWork(PERIODIC);
            wm.cancelUniqueWork(SWITCH);
        }
    }

    private static void scheduleSwitch(Context ctx, long delayMs) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(SpotifyDjWorker.class)
            .setInitialDelay(Math.max(0, delayMs), TimeUnit.MILLISECONDS)
            .setInputData(new Data.Builder().putBoolean("switch", true).build())
            .setConstraints(net()).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(SWITCH, ExistingWorkPolicy.REPLACE, req);
    }

    // ---------- shared state ----------
    private static JSONObject load(Context ctx) {
        try {
            String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
            return raw == null ? new JSONObject() : new JSONObject(raw);
        } catch (Exception e) { return new JSONObject(); }
    }

    private static void save(Context ctx, JSONObject dj) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, dj.toString()).apply();
    }

    // ---------- work ----------
    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        JSONObject dj = load(ctx);
        if (!dj.optBoolean("on") || dj.optString("refresh", "").isEmpty()) { sync(ctx); return Result.success(); }
        try {
            if (getInputData().getBoolean("switch", false)) doSwitch(ctx, dj);
            else check(ctx, dj);
            return Result.success();
        } catch (Exception e) {
            return getRunAttemptCount() < 2 ? Result.retry() : Result.success();
        }
    }

    /** Is Spotify playing the DJ's playlist? Returns the player state, or null if not (paused, or you picked something else). */
    private static JSONObject ourPlayback(Context ctx, JSONObject dj) throws Exception {
        Http r = api(ctx, dj, "GET", "/me/player", null);
        if (r.code == 204 || r.body.isEmpty()) return null;
        JSONObject p = new JSONObject(r.body);
        JSONObject c = p.optJSONObject("context");
        if (!p.optBoolean("is_playing") || c == null || !c.optString("uri").equals(dj.optString("context"))) return null;
        return p;
    }

    private static void check(Context ctx, JSONObject dj) throws Exception {
        JSONObject p = ourPlayback(ctx, dj);
        double[] loc = WidgetUpdateWorker.location(ctx);
        if (loc == null) { log(ctx, dj, "", "no location yet"); return; }

        String sky = skyNow(ctx, loc[0], loc[1]);
        String part = partOfDay(Calendar.getInstance().get(Calendar.HOUR_OF_DAY));
        String mood = sky + "/" + part;
        String oldSky = dj.optString("sky", "");
        boolean newPart = !part.equals(dj.optString("part", ""));
        // New music when the conditions outside change, or at a new part of the day (morning, afternoon, evening, night).
        // Forecast chances never change it.
        if (sky.equals(oldSky) && !newPart) { dj.remove("pending"); log(ctx, dj, sky, "same as before, no change"); return; }
        String why = newPart ? "it's now " + ("night".equals(part) ? "night" : "the " + part) : "conditions changed";

        if (p == null) {
            // Nothing of ours is playing: just keep the ready-to-play pick current, so Play starts the right music.
            JSONObject pl = pickFor(ctx, dj, sky, part);
            if (pl == null) { log(ctx, dj, sky, why + ", but no playlist found"); return; }
            dj.put("context", pl.getString("uri"));
            dj.put("playlistName", pl.optString("name"));
            dj.put("sky", sky);
            dj.put("part", part);
            dj.put("mood", mood);
            dj.remove("pending");
            dj.remove("next");
            log(ctx, dj, sky, why + "; nothing playing, so the next Play uses " + pl.optString("name"));
            return;
        }

        // Rain, snow or storms starting or stopping switches right away. A change between sunny, partly cloudy and
        // cloudy has to show up on two checks in a row, so one passing cloud doesn't change the music.
        // A new part of the day, or rain/snow/storms starting or stopping, switches at the end of this song. Other sky
        // changes have to show up on two checks in a row, so one passing cloud doesn't change the music.
        boolean sure = newPart || wet(sky) || wet(oldSky);
        if (!sure && !sky.equals(dj.optString("pending"))) { dj.put("pending", sky); log(ctx, dj, sky, "conditions changed; confirming on the next check"); return; }

        JSONObject pl = pickFor(ctx, dj, sky, part);
        if (pl == null) { log(ctx, dj, sky, why + ", but no playlist found"); return; }

        JSONObject item = p.optJSONObject("item");
        long left = item == null ? 0 : item.optLong("duration_ms") - p.optLong("progress_ms");
        JSONObject next = new JSONObject().put("uri", pl.getString("uri")).put("name", pl.optString("name"))
            .put("sky", sky).put("part", part).put("track", item == null ? "" : item.optString("id"));
        dj.put("next", next);
        dj.remove("pending");
        log(ctx, dj, sky, why + "; switching to " + pl.optString("name") + " when this song ends");
        scheduleSwitch(ctx, left - 1500);   // just before the song ends; doSwitch waits if it's early
    }

    private static void doSwitch(Context ctx, JSONObject dj) throws Exception {
        JSONObject next = dj.optJSONObject("next");
        if (next == null) return;
        JSONObject p = ourPlayback(ctx, dj);
        if (p == null) { dj.remove("next"); log(ctx, dj, next.optString("sky"), "switch skipped: music was paused or changed"); return; }   // leave your music alone
        JSONObject item = p.optJSONObject("item");
        long left = item == null ? 0 : item.optLong("duration_ms") - p.optLong("progress_ms");
        if (item != null && item.optString("id").equals(next.optString("track")) && left > 4000) {
            scheduleSwitch(ctx, left - 1500);   // same song still playing (it was paused for a bit): wait for its end
            return;
        }
        String uri = next.getString("uri");
        Http r = api(ctx, dj, "PUT", "/me/player/play", new JSONObject().put("context_uri", uri).toString());
        if (r.code >= 300) throw new Exception("play " + r.code);
        api(ctx, dj, "PUT", "/me/player/shuffle?state=true", null);
        dj.put("context", uri);
        dj.put("playlistName", next.optString("name"));
        dj.put("sky", next.optString("sky"));
        dj.put("part", next.optString("part"));
        dj.put("mood", next.optString("sky") + "/" + next.optString("part"));
        dj.remove("next");
        log(ctx, dj, next.optString("sky"), "switched to " + next.optString("name"));
    }

    /** Remember the last decision so the app can show it ("Last check 10:15 AM: haze, switching…"). Also saves. */
    private static void log(Context ctx, JSONObject dj, String sky, String what) {
        try { dj.put("lastCheck", new JSONObject().put("at", System.currentTimeMillis()).put("sky", sky).put("what", what)); } catch (Exception ignored) { }
        save(ctx, dj);
    }

    // ---------- weather ----------
    private static boolean wet(String sky) {
        return "rain".equals(sky) || "snow".equals(sky) || "storm".equals(sky);
    }

    /** Same parts of the day as the app's Soundtrack panel. */
    static String partOfDay(int h) {
        if (h >= 5 && h <= 11) return "morning";
        if (h >= 12 && h <= 16) return "afternoon";
        if (h >= 17 && h <= 21) return "evening";
        return "night";
    }

    /** The sky right now (Open-Meteo's current conditions, updated every 15 minutes), in the app's words. */
    private static String skyNow(Context ctx, double lat, double lon) throws Exception {
        // Prefer the widget's latest real station reading (same one the app shows) when it's fresh.
        WidgetUpdateWorker.Snapshot snap = WidgetUpdateWorker.Snapshot.load(ctx);
        if (snap != null && snap.desc != null && !snap.desc.isEmpty() && System.currentTimeMillis() - snap.time < 45 * 60 * 1000L) {
            String k = WidgetUpdateWorker.kind(snap.desc);
            return "mostly".equals(k) ? "clear" : k;
        }
        return skyModel(lat, lon);
    }

    private static String skyModel(double lat, double lon) throws Exception {
        JSONObject c = new JSONObject(http("GET", String.format(Locale.US,
            "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=weather_code,precipitation", lat, lon), null, null).body)
            .getJSONObject("current");
        String k = WidgetUpdateWorker.kind(WidgetUpdateWorker.wmo(c.optInt("weather_code", -1)));
        if ("mostly".equals(k)) k = "clear";
        if (c.optDouble("precipitation", 0) >= 0.2 && !wet(k)) k = "rain";
        return k;
    }

    // ---------- picking ----------
    /** Same key as blockDay() in soundtrack.js: local date, with the small hours counted as the night before. */
    private static String blockDay() {
        Calendar c = Calendar.getInstance();
        if (c.get(Calendar.HOUR_OF_DAY) <= 4) c.add(Calendar.DAY_OF_MONTH, -1);
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** The playlist the app's Soundtrack card picked for this part of the day (if it was picked for this sky), else a search. */
    private static JSONObject pickFor(Context ctx, JSONObject dj, String sky, String part) throws Exception {
        JSONObject blocks = dj.optJSONObject("blocks");
        JSONObject card = blocks == null ? null : blocks.optJSONObject(blockDay() + "/" + part);
        String current = dj.optString("context");
        if (card != null && sky.equals(card.optString("sky")) && !card.optString("uri").isEmpty() && !card.optString("uri").equals(current)) {
            return new JSONObject().put("uri", card.getString("uri")).put("name", card.optString("name"));
        }
        JSONObject styles = dj.optJSONObject("styles");
        JSONObject bySky = styles == null ? null : styles.optJSONObject(sky);
        String query = bySky == null ? null : bySky.optString(part, null);
        return query == null ? null : findPlaylist(ctx, dj, query, current);
    }

    // ---------- Spotify ----------
    private static JSONObject findPlaylist(Context ctx, JSONObject dj, String query, String avoid) throws Exception {
        Http r = api(ctx, dj, "GET", "/search?type=playlist&limit=10&q=" + URLEncoder.encode(query, "UTF-8"), null);
        if (r.code != 200) return null;
        JSONArray items = new JSONObject(r.body).getJSONObject("playlists").getJSONArray("items");
        java.util.List<JSONObject> good = new java.util.ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject pl = items.optJSONObject(i);   // Spotify sometimes returns null entries
            if (pl == null || pl.optString("uri").equals(avoid)) continue;
            JSONObject tr = pl.optJSONObject("tracks");
            if (tr == null) tr = pl.optJSONObject("items");
            if (tr != null && tr.optInt("total", 30) < 15) continue;
            good.add(pl);
            if (good.size() == 3) break;
        }
        return good.isEmpty() ? null : good.get((int) (Math.random() * good.size()));
    }

    private static String token(Context ctx, JSONObject dj) throws Exception {
        if (!dj.optString("access").isEmpty() && dj.optLong("accessExp") > System.currentTimeMillis() + 60000) return dj.getString("access");
        String form = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(dj.getString("refresh"), "UTF-8")
            + "&client_id=" + URLEncoder.encode(dj.getString("clientId"), "UTF-8");
        Http r = http("POST", "https://accounts.spotify.com/api/token", null, form);
        if (r.code != 200) {
            if (r.code == 400) { dj.put("on", false); dj.put("refresh", ""); save(ctx, dj); }   // signed out or app removed: stop
            throw new Exception("token " + r.code);
        }
        JSONObject t = new JSONObject(r.body);
        dj.put("access", t.getString("access_token"));
        dj.put("accessExp", System.currentTimeMillis() + t.optLong("expires_in", 3600) * 1000L);
        if (t.has("refresh_token")) dj.put("refresh", t.getString("refresh_token"));
        save(ctx, dj);
        return dj.getString("access");
    }

    private static Http api(Context ctx, JSONObject dj, String method, String path, String json) throws Exception {
        return http(method, "https://api.spotify.com/v1" + path, "Bearer " + token(ctx, dj), json);
    }

    static class Http { int code; String body = ""; }

    /** body: JSON for api.spotify.com, form-encoded for the token endpoint. */
    private static Http http(String method, String url, String auth, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        c.setRequestMethod(method);
        if (auth != null) c.setRequestProperty("Authorization", auth);
        if ("PUT".equals(method) || "POST".equals(method)) {
            c.setDoOutput(true);
            byte[] bytes = (body == null ? "" : body).getBytes("UTF-8");
            c.setRequestProperty("Content-Type", url.contains("accounts.spotify.com") ? "application/x-www-form-urlencoded" : "application/json");
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream o = c.getOutputStream()) { o.write(bytes); }
        }
        try {
            Http r = new Http();
            r.code = c.getResponseCode();
            InputStream in = r.code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(in, "UTF-8"))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                }
                r.body = sb.toString();
            }
            return r;
        } finally {
            c.disconnect();
        }
    }
}

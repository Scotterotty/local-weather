package com.scotterotty.localweather;

import android.Manifest;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.widget.RemoteViews;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
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
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Fetches weather for the widget. Same sources as the app: NWS first (real station reading
 * if reported in the last 90 minutes, otherwise the hourly forecast), Open-Meteo outside the US.
 */
public class WidgetUpdateWorker extends Worker {
    private static final String PERIODIC = "lw-widget-periodic";
    private static final String NOW = "lw-widget-now";
    private static final String CACHE = "lw-widget";
    // Written by the web app through @capacitor/preferences
    private static final String APP_PREFS = "CapacitorStorage";
    private static final String UA = "LocalWeatherAndroidWidget/1.0 (github.com/Scotterotty/local-weather)";
    private static final long OBS_MAX_AGE_MS = 90 * 60 * 1000L;
    static final int HOURS = 5;
    private static final int[][] HOUR_IDS = {
        {R.id.h0_t, R.id.h0_c, R.id.h0_p}, {R.id.h1_t, R.id.h1_c, R.id.h1_p}, {R.id.h2_t, R.id.h2_c, R.id.h2_p},
        {R.id.h3_t, R.id.h3_c, R.id.h3_p}, {R.id.h4_t, R.id.h4_c, R.id.h4_p}};

    public WidgetUpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    // ---------- scheduling ----------
    private static Constraints net() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    public static void refreshNow(Context ctx) {
        if (!hasWidgets(ctx)) return;
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(WidgetUpdateWorker.class).setConstraints(net()).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req);
    }

    public static void schedulePeriodic(Context ctx) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(WidgetUpdateWorker.class, 30, TimeUnit.MINUTES)
            .setConstraints(net()).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    public static void cancelPeriodic(Context ctx) {
        WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC);
    }

    private static boolean hasWidgets(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        return m.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class)).length > 0;
    }

    // ---------- work ----------
    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        double[] loc = location(ctx);
        if (loc == null) {
            render(ctx, null, "Open the app once to set your location");
            return Result.success();
        }
        try {
            Snapshot s;
            try {
                s = fetchNws(loc[0], loc[1]);
            } catch (Exception nws) {
                s = fetchOpenMeteo(loc[0], loc[1]);
            }
            if (s.place == null) s.place = savedLabel(ctx);
            s.lat = loc[0];
            s.lon = loc[1];
            s.time = System.currentTimeMillis();
            s.save(ctx);
            render(ctx, s, null);
            return Result.success();
        } catch (Exception e) {
            renderCached(ctx);
            return getRunAttemptCount() < 2 ? Result.retry() : Result.success();
        }
    }

    // Prefer the phone's freshest cached fix; fall back to the last location the app used.
    private static double[] location(Context ctx) {
        Location best = null;
        boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (fine || coarse) {
            try {
                LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
                for (String p : lm.getProviders(true)) {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                }
            } catch (SecurityException ignored) { }
        }
        double[] saved = savedLocation(ctx);
        if (best != null && (saved == null || System.currentTimeMillis() - best.getTime() < 6 * 3600 * 1000L)) {
            return new double[]{best.getLatitude(), best.getLongitude()};
        }
        return saved;
    }

    private static double[] savedLocation(Context ctx) {
        try {
            String raw = ctx.getSharedPreferences(APP_PREFS, Context.MODE_PRIVATE).getString("lw.lastLoc", null);
            if (raw == null) return null;
            JSONObject o = new JSONObject(raw);
            return new double[]{o.getDouble("lat"), o.getDouble("lon")};
        } catch (Exception e) { return null; }
    }

    private static String savedLabel(Context ctx) {
        try {
            String raw = ctx.getSharedPreferences(APP_PREFS, Context.MODE_PRIVATE).getString("lw.lastLoc", null);
            String label = raw == null ? null : new JSONObject(raw).optString("label", null);
            return label != null && !label.isEmpty() ? label : "Current location";
        } catch (Exception e) { return "Current location"; }
    }

    private static boolean celsius(Context ctx) {
        String u = ctx.getSharedPreferences(APP_PREFS, Context.MODE_PRIVATE).getString("lw.units", "F");
        return u != null && u.contains("C");
    }

    // ---------- data sources ----------
    private static JSONObject get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", "application/geo+json, application/json");
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            return new JSONObject(sb.toString());
        } finally {
            c.disconnect();
        }
    }

    private static Double num(JSONObject o, String key) {
        JSONObject q = o.optJSONObject(key);
        if (q == null || q.isNull("value")) return null;
        return q.optDouble("value");
    }

    private static double toC(JSONObject period) throws Exception {
        double t = period.getDouble("temperature");
        return "F".equals(period.optString("temperatureUnit", "F")) ? (t - 32) * 5 / 9 : t;
    }

    private static Snapshot fetchNws(double lat, double lon) throws Exception {
        String ll = String.format(Locale.US, "%.4f,%.4f", lat, lon);
        JSONObject p = get("https://api.weather.gov/points/" + ll).getJSONObject("properties");
        Snapshot s = new Snapshot();
        s.source = "NWS";
        JSONObject rl = p.optJSONObject("relativeLocation");
        if (rl != null) {
            JSONObject rp = rl.getJSONObject("properties");
            s.place = rp.optString("city") + ", " + rp.optString("state");
        }

        JSONArray hp = get(p.getString("forecastHourly")).getJSONObject("properties").getJSONArray("periods");
        JSONObject h0 = hp.getJSONObject(0);
        s.tempC = toC(h0);
        s.desc = h0.optString("shortForecast");
        SimpleDateFormat isoH = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US);
        for (int i = 1; i < hp.length() && s.hours.length() < HOURS; i++) {
            JSONObject h = hp.getJSONObject(i);
            Date start = isoH.parse(h.getString("startTime"));
            if (start == null || start.getTime() < System.currentTimeMillis() - 30 * 60 * 1000L) continue;
            Double pop = num(h, "probabilityOfPrecipitation");
            s.hours.put(new JSONObject().put("t", start.getTime()).put("c", toC(h)).put("p", pop == null ? -1 : pop));
        }

        JSONArray fc = get(p.getString("forecast")).getJSONObject("properties").getJSONArray("periods");
        JSONObject f0 = fc.getJSONObject(0);
        if (f0.optBoolean("isDaytime")) {
            s.hiC = toC(f0);
            if (fc.length() > 1) s.loC = toC(fc.getJSONObject(1));
        } else {
            s.loC = toC(f0);
        }

        // Real measurement from the nearest station with a fresh report
        try {
            JSONArray st = get(p.getString("observationStations")).getJSONArray("features");
            SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US);
            for (int i = 0; i < Math.min(3, st.length()); i++) {
                String id = st.getJSONObject(i).getJSONObject("properties").getString("stationIdentifier");
                try {
                    JSONObject o = get("https://api.weather.gov/stations/" + id + "/observations/latest").getJSONObject("properties");
                    Double t = num(o, "temperature");
                    Date when = iso.parse(o.getString("timestamp"));
                    if (t != null && when != null && System.currentTimeMillis() - when.getTime() <= OBS_MAX_AGE_MS) {
                        s.tempC = t;
                        String d = o.optString("textDescription");
                        if (!d.isEmpty()) s.desc = d;
                        s.station = id;
                        break;
                    }
                } catch (Exception ignored) { }
            }
        } catch (Exception ignored) { }
        return s;
    }

    private static String wmo(int code) {
        if (code == 0) return "Clear";
        if (code == 1) return "Mostly clear";
        if (code == 2) return "Partly cloudy";
        if (code == 3) return "Overcast";
        if (code == 45 || code == 48) return "Fog";
        if (code >= 51 && code <= 57) return "Drizzle";
        if (code >= 61 && code <= 67) return "Rain";
        if (code >= 71 && code <= 77) return "Snow";
        if (code >= 80 && code <= 82) return "Rain showers";
        if (code == 85 || code == 86) return "Snow showers";
        if (code >= 95) return "Thunderstorms";
        return "";
    }

    private static Snapshot fetchOpenMeteo(double lat, double lon) throws Exception {
        String url = String.format(Locale.US,
            "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&timezone=auto&forecast_days=1"
                + "&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min"
                + "&hourly=temperature_2m,precipitation_probability&forecast_hours=12", lat, lon);
        JSONObject d = get(url);
        Snapshot s = new Snapshot();
        s.source = "Open-Meteo";
        JSONObject c = d.getJSONObject("current");
        s.tempC = c.getDouble("temperature_2m");
        s.desc = wmo(c.optInt("weather_code", -1));
        JSONObject daily = d.getJSONObject("daily");
        s.hiC = daily.getJSONArray("temperature_2m_max").getDouble(0);
        s.loC = daily.getJSONArray("temperature_2m_min").getDouble(0);
        JSONObject hourly = d.getJSONObject("hourly");
        JSONArray times = hourly.getJSONArray("time"), temps = hourly.getJSONArray("temperature_2m");
        JSONArray pops = hourly.optJSONArray("precipitation_probability");
        long offset = d.optLong("utc_offset_seconds") * 1000L;
        SimpleDateFormat local = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.US);
        local.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        for (int i = 0; i < times.length() && s.hours.length() < HOURS; i++) {
            Date wall = local.parse(times.getString(i));
            if (wall == null) continue;
            long t = wall.getTime() - offset;
            if (t <= System.currentTimeMillis()) continue;
            s.hours.put(new JSONObject().put("t", t).put("c", temps.getDouble(i)).put("p", pops == null || pops.isNull(i) ? -1 : pops.getDouble(i)));
        }
        return s;
    }

    // ---------- rendering ----------
    static void renderCached(Context ctx) {
        Snapshot s = Snapshot.load(ctx);
        render(ctx, s, s == null ? "Loading weather…" : null);
    }

    private static String fmt(Double c, boolean useC) {
        if (c == null) return "–";
        return Math.round(useC ? c : c * 9 / 5 + 32) + "°";
    }

    private static void render(Context ctx, Snapshot s, String message) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class));
        if (ids.length == 0) return;
        boolean useC = celsius(ctx);

        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_weather);
        if (s == null) {
            v.setTextViewText(R.id.w_place, "Local Weather");
            v.setTextViewText(R.id.w_temp, "–");
            v.setTextViewText(R.id.w_desc, message != null ? message : "");
            v.setTextViewText(R.id.w_hilo, "");
            v.setTextViewText(R.id.w_updated, "");
            v.setViewVisibility(R.id.w_hours, android.view.View.GONE);
            v.setTextViewText(R.id.w_sky, "");
        } else {
            v.setTextViewText(R.id.w_place, s.place != null ? s.place : "Current location");
            v.setTextViewText(R.id.w_temp, fmt(s.tempC, useC));
            v.setTextViewText(R.id.w_desc, s.desc != null ? s.desc : "");
            StringBuilder hl = new StringBuilder();
            if (s.hiC != null) hl.append("H ").append(fmt(s.hiC, useC));
            if (s.loC != null) hl.append(hl.length() > 0 ? "  " : "").append("L ").append(fmt(s.loC, useC));
            v.setTextViewText(R.id.w_hilo, hl.toString());
            String when = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(s.time));
            v.setTextViewText(R.id.w_updated, (s.station != null ? s.station + " · " : "") + when);

            // Next few hours
            SimpleDateFormat hourFmt = new SimpleDateFormat("h a", Locale.getDefault());
            int shown = 0;
            for (int i = 0; i < HOURS; i++) {
                JSONObject h = s.hours.optJSONObject(i);
                if (h == null) {
                    v.setTextViewText(HOUR_IDS[i][0], ""); v.setTextViewText(HOUR_IDS[i][1], ""); v.setTextViewText(HOUR_IDS[i][2], "");
                    continue;
                }
                shown++;
                v.setTextViewText(HOUR_IDS[i][0], hourFmt.format(new Date(h.optLong("t"))));
                v.setTextViewText(HOUR_IDS[i][1], fmt(h.optDouble("c"), useC));
                double pop = h.optDouble("p", -1);
                v.setTextViewText(HOUR_IDS[i][2], pop >= 10 ? Math.round(pop) + "%" : "");
            }
            v.setViewVisibility(R.id.w_hours, shown > 0 ? android.view.View.VISIBLE : android.view.View.GONE);

            // Sun and moon, calculated on the phone
            long now = System.currentTimeMillis();
            StringBuilder sky = new StringBuilder();
            if (s.lat != 0 || s.lon != 0) {
                long[] sun = Astro.sun(s.lat, s.lon, now);
                DateFormat tf = DateFormat.getTimeInstance(DateFormat.SHORT);
                if (sun[0] != 0) sky.append("↑ ").append(tf.format(new Date(sun[0]))).append("   ↓ ").append(tf.format(new Date(sun[1]))).append("   ");
            }
            sky.append(Astro.moonLabel(now)).append(" ").append(Astro.moonLitPercent(now)).append("%");
            v.setTextViewText(R.id.w_sky, sky.toString());
        }

        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.w_root, pi);
        m.updateAppWidget(ids, v);
    }

    // ---------- cached result ----------
    static class Snapshot {
        String place, desc, station, source;
        Double tempC, hiC, loC;
        long time;
        double lat, lon;
        JSONArray hours = new JSONArray();

        void save(Context ctx) {
            try {
                JSONObject o = new JSONObject();
                o.put("place", place); o.put("desc", desc); o.put("station", station); o.put("source", source);
                if (tempC != null) o.put("tempC", tempC);
                if (hiC != null) o.put("hiC", hiC);
                if (loC != null) o.put("loC", loC);
                o.put("time", time);
                o.put("lat", lat); o.put("lon", lon); o.put("hours", hours);
                ctx.getSharedPreferences(CACHE, Context.MODE_PRIVATE).edit().putString("snapshot", o.toString()).apply();
            } catch (Exception ignored) { }
        }

        static Snapshot load(Context ctx) {
            try {
                SharedPreferences sp = ctx.getSharedPreferences(CACHE, Context.MODE_PRIVATE);
                String raw = sp.getString("snapshot", null);
                if (raw == null) return null;
                JSONObject o = new JSONObject(raw);
                Snapshot s = new Snapshot();
                s.place = o.optString("place", null); s.desc = o.optString("desc", null);
                s.station = o.isNull("station") ? null : o.optString("station", null);
                s.source = o.optString("source", null);
                s.tempC = o.has("tempC") ? o.getDouble("tempC") : null;
                s.hiC = o.has("hiC") ? o.getDouble("hiC") : null;
                s.loC = o.has("loC") ? o.getDouble("loC") : null;
                s.time = o.optLong("time");
                s.lat = o.optDouble("lat", 0); s.lon = o.optDouble("lon", 0);
                JSONArray hs = o.optJSONArray("hours");
                if (hs != null) s.hours = hs;
                return s;
            } catch (Exception e) { return null; }
        }
    }
}

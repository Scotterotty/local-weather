package com.scotterotty.localweather;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    // Also called by BridgeActivity on a cold start with the launch intent.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (saveSpotifyRedirect(intent) && getBridge() != null) getBridge().triggerWindowJSEvent("spotifyAuth");
    }

    @Override
    public void onPause() {
        super.onPause();
        // The app may have just found a new location or changed units; bring the widget up to date.
        // Fetch directly rather than queueing a job: Battery Saver can hold jobs back for hours.
        if (WidgetUpdateWorker.hasWidgets(this)) WidgetRefreshReceiver.updateAsync(this, null);
        // Weather DJ may have been turned on or off.
        SpotifyDjWorker.sync(this);
    }

    /** Spotify sends you back to com.scotterotty.localweather://spotify?code=...; hand the code to the web app (dj.js). */
    private boolean saveSpotifyRedirect(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"com.scotterotty.localweather".equals(data.getScheme()) || !"spotify".equals(data.getHost())) return false;
        try {
            JSONObject o = new JSONObject();
            o.put("code", data.getQueryParameter("code"));
            o.put("state", data.getQueryParameter("state"));
            o.put("error", data.getQueryParameter("error"));
            getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().putString("lw.djAuth", o.toString()).apply();
            intent.setData(null);   // so a later restart doesn't replay an old sign-in
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}

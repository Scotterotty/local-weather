package com.scotterotty.localweather;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/**
 * Home-screen widget. Network work runs off the UI thread (WidgetUpdateWorker / WidgetRefreshReceiver).
 * onUpdate also fires every 30 minutes from the launcher itself (updatePeriodMillis). That broadcast still
 * arrives when Battery Saver holds back WorkManager jobs and app alarms, so it fetches right here instead of
 * queueing a job that might wait for hours.
 */
public class WeatherWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetUpdateWorker.renderCached(context);   // show the last result immediately
        WidgetUpdateWorker.schedulePeriodic(context);
        WidgetRefreshReceiver.updateAsync(context, goAsync());
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, android.os.Bundle options) {
        WidgetUpdateWorker.renderCached(context);   // resized: re-layout for the new height
    }

    @Override
    public void onEnabled(Context context) {
        WidgetUpdateWorker.schedulePeriodic(context);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetUpdateWorker.cancelPeriodic(context);
        WidgetRefreshReceiver.cancel(context);
    }
}

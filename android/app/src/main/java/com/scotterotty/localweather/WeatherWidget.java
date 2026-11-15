package com.scotterotty.localweather;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Home-screen widget. All work happens in WidgetUpdateWorker so network calls never block the UI thread. */
public class WeatherWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        WidgetUpdateWorker.renderCached(context);   // show the last result immediately
        WidgetUpdateWorker.refreshNow(context);
        WidgetUpdateWorker.schedulePeriodic(context);
    }

    @Override
    public void onEnabled(Context context) {
        WidgetUpdateWorker.schedulePeriodic(context);
    }

    @Override
    public void onDisabled(Context context) {
        WidgetUpdateWorker.cancelPeriodic(context);
    }
}

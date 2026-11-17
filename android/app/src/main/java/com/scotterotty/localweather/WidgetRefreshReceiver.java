package com.scotterotty.localweather;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.widget.RemoteViews;

/**
 * Keeps the widget fresh when Android delays background jobs. Two ways in:
 *  - an alarm every 20 minutes that may fire even while the phone is idle (inexact, no special permission);
 *  - tapping the update time on the widget, which refreshes right away.
 * The fetch runs here directly (goAsync gives up to ~30 s), so it doesn't wait in WorkManager's queue.
 */
public class WidgetRefreshReceiver extends BroadcastReceiver {
    static final String ACTION_ALARM = "com.scotterotty.localweather.WIDGET_ALARM";
    static final String ACTION_TAP = "com.scotterotty.localweather.WIDGET_TAP";
    private static final long EVERY_MS = 20 * 60 * 1000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context ctx = context.getApplicationContext();
        if (ACTION_TAP.equals(intent.getAction())) showUpdating(ctx);
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                WidgetUpdateWorker.update(ctx);
            } catch (Exception ignored) {
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static void showUpdating(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class));
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_weather);
        v.setTextViewText(R.id.w_updated, "Updating…");
        for (int id : ids) m.partiallyUpdateAppWidget(id, v);
    }

    static PendingIntent tapIntent(Context ctx) {
        Intent i = new Intent(ctx, WidgetRefreshReceiver.class).setAction(ACTION_TAP);
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, WidgetRefreshReceiver.class).setAction(ACTION_ALARM);
        return PendingIntent.getBroadcast(ctx, 2, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Set (or move) the next alarm 20 minutes from now. Called after every refresh, so refreshes from any source push it back. */
    static void scheduleNext(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        if (m.getAppWidgetIds(new ComponentName(ctx, WeatherWidget.class)).length == 0) { cancel(ctx); return; }
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + EVERY_MS, alarmIntent(ctx));
    }

    static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(ctx));
    }
}

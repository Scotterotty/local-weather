package com.scotterotty.localweather;

import java.util.Calendar;
import java.util.TimeZone;

/** Sunrise, sunset and moon phase, calculated on the phone (same math as the app). */
final class Astro {
    private static final double RAD = Math.PI / 180;
    static final double SYNODIC = 29.530588853;

    private Astro() { }

    /** {rise, set} as epoch millis for the phone's current local date; 0 when the sun doesn't rise or set. */
    static long[] sun(double lat, double lon, long now) {
        Calendar local = Calendar.getInstance();
        local.setTimeInMillis(now);
        Calendar utcNoon = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        utcNoon.clear();
        utcNoon.set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH), 12, 0, 0);
        double n = Math.round(utcNoon.getTimeInMillis() / 864e5 + 2440587.5 - 2451545);
        double js = n - lon / 360;
        double m = (357.5291 + 0.98560028 * js) % 360;
        double c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
        double l = (m + c + 180 + 102.9372) % 360;
        double jt = 2451545 + js + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * l * RAD);
        double dec = Math.asin(Math.sin(l * RAD) * Math.sin(23.4397 * RAD));
        double cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(dec)) / (Math.cos(lat * RAD) * Math.cos(dec));
        if (cosW > 1 || cosW < -1) return new long[]{0, 0};
        double w = Math.acos(cosW) / RAD;
        return new long[]{toMillis(jt - w / 360), toMillis(jt + w / 360)};
    }

    private static long toMillis(double jd) {
        return Math.round((jd - 2440587.5) * 864e5);
    }

    static double moonAge(long now) {
        double jd = now / 864e5 + 2440587.5;
        return (((jd - 2451550.1) % SYNODIC) + SYNODIC) % SYNODIC;
    }

    static int moonLitPercent(long now) {
        return (int) Math.round((1 - Math.cos(2 * Math.PI * moonAge(now) / SYNODIC)) / 2 * 100);
    }

    /** Name and emoji, e.g. "🌒 Waxing crescent". */
    static String moonLabel(long now) {
        double age = moonAge(now), q = SYNODIC / 4;
        if (age < 1 || age > SYNODIC - 1) return "🌑 New moon";
        if (Math.abs(age - q) < 1) return "🌓 First quarter";
        if (Math.abs(age - 2 * q) < 1) return "🌕 Full moon";
        if (Math.abs(age - 3 * q) < 1) return "🌗 Last quarter";
        if (age < q) return "🌒 Waxing crescent";
        if (age < 2 * q) return "🌔 Waxing gibbous";
        if (age < 3 * q) return "🌖 Waning gibbous";
        return "🌘 Waning crescent";
    }
}

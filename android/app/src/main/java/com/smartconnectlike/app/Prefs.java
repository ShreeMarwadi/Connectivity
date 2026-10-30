package com.smartconnectlike.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.UUID;

public final class Prefs {
    private static final String FILE = "smartconnect";

    private Prefs() {
    }

    private static SharedPreferences sp(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public static String deviceId(Context context) {
        SharedPreferences prefs = sp(context);
        String id = prefs.getString("deviceId", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString("deviceId", id).apply();
        }
        return id;
    }

    public static String deviceName(Context context) {
        String name = sp(context).getString("deviceName", null);
        if (name == null || name.trim().isEmpty()) {
            name = Build.MANUFACTURER + " " + Build.MODEL;
        }
        return name;
    }

    public static void setDeviceName(Context context, String name) {
        sp(context).edit().putString("deviceName", name).apply();
    }
}

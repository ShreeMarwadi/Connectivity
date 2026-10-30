package com.smartconnectlike.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Opens a downloaded file, and for APKs walks the user straight into the system installer.
 * Files land in public Downloads, but the package installer is fed a private cache copy exposed
 * through our FileProvider, which works on every OEM skin (MediaStore URIs are often refused).
 */
public final class Installer {
    public static final String APK_MIME = "application/vnd.android.package-archive";

    private Installer() {
    }

    /** True when the OS lets this app launch the installer UI without a permission detour. */
    public static boolean canInstall(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return activity.getPackageManager().canRequestPackageInstalls();
    }

    /** Sends the user to the "Install unknown apps" screen for this app. */
    public static void askForInstallPermission(Activity activity) {
        Toast.makeText(activity,
                "Allow Connectivity to install apps, then tap Install again.",
                Toast.LENGTH_LONG).show();
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
        } catch (Exception ignored) {
            try {
                activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
            } catch (Exception ignoredToo) {
                /* nothing more we can do */
            }
        }
    }

    /** Launches the installer for a downloaded APK. */
    public static void install(Activity activity, FileSaver.Saved saved) {
        if (!canInstall(activity)) {
            askForInstallPermission(activity);
            return;
        }
        try {
            Uri apk = stage(activity, saved);
            if (apk == null) {
                Toast.makeText(activity, "Saved to " + saved.label + ". Open it from there.",
                        Toast.LENGTH_LONG).show();
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apk, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception err) {
            Toast.makeText(activity, "Saved to " + saved.label + ". Could not open installer: " + err.getMessage(),
                    Toast.LENGTH_LONG).show();
        }
    }

    /** Opens a downloaded file with whatever app handles its type (no-op message when none). */
    public static void open(Activity activity, FileSaver.Saved saved) {
        if (saved.isApk()) {
            install(activity, saved);
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(saved.uri, saved.mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception err) {
            Toast.makeText(activity,
                    "Saved to " + saved.label + ". No app can open this type (" + saved.mime + ").",
                    Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Copies the downloaded file into the app cache and hands back a FileProvider URI.
     * The installer can always read that, unlike public Downloads on many devices.
     */
    private static Uri stage(Context context, FileSaver.Saved saved) throws IOException {
        if (saved.uri == null) return null;
        File dir = new File(context.getCacheDir(), "install");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null) {
            for (File file : old) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
        File target = new File(dir, safeName(saved.name));
        try (InputStream in = context.getContentResolver().openInputStream(saved.uri);
             OutputStream out = new FileOutputStream(target)) {
            if (in == null) throw new IOException("cannot read the saved file");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
        }
        return FileProvider.getUriForFile(context, FileSaver.authority(context), target);
    }

    private static String safeName(String name) {
        String cleaned = name == null ? "update.apk" : name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (cleaned.isEmpty()) cleaned = "update.apk";
        if (!cleaned.toLowerCase(java.util.Locale.US).endsWith(".apk")) cleaned = cleaned + ".apk";
        return cleaned;
    }
}

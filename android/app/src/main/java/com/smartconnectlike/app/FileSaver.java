package com.smartconnectlike.app;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

public final class FileSaver {
    private static final String TAG = "SC-Files";

    public interface Progress {
        void onProgress(long bytes, long total);
    }

    /** Result of a finished transfer: where it landed and how to open it. */
    public static final class Saved {
        public final String name;
        public final String label;
        public final String mime;
        public final Uri uri;

        Saved(String name, String label, String mime, Uri uri) {
            this.name = name;
            this.label = label;
            this.mime = mime;
            this.uri = uri;
        }

        public boolean isApk() {
            return name != null && name.toLowerCase(Locale.US).endsWith(".apk");
        }
    }

    private FileSaver() {
    }

    public static Saved save(Context context, String name, InputStream input, long total, Progress progress)
            throws IOException {
        String safe = sanitize(name);
        String mime = mimeOf(safe);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Connectivity");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);

            Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("Could not create the download entry");
            try (OutputStream out = context.getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Could not open the download file");
                copy(input, out, total, progress);
            } catch (IOException err) {
                try {
                    context.getContentResolver().delete(uri, null, null);
                } catch (Exception ignored) {
                    /* best effort cleanup */
                }
                throw err;
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            context.getContentResolver().update(uri, values, null, null);
            return new Saved(safe, "Downloads/Connectivity/" + safe, mime, uri);
        }

        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Connectivity");
        if (!dir.exists() && !dir.mkdirs()) {
            dir = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Connectivity");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        File target = unique(dir, safe);
        try (OutputStream out = new FileOutputStream(target)) {
            copy(input, out, total, progress);
        }
        Uri uri = FileProvider.getUriForFile(context, authority(context), target);
        return new Saved(target.getName(), target.getAbsolutePath(), mime, uri);
    }

    public static String authority(Context context) {
        return context.getPackageName() + ".files";
    }

    /** Best-effort MIME type from the file name; APKs must be reported as package archives. */
    public static String mimeOf(String name) {
        String ext = extensionOf(name);
        switch (ext) {
            case "apk":
                return "application/vnd.android.package-archive";
            case "pdf":
                return "application/pdf";
            case "zip":
                return "application/zip";
            case "mp4":
                return "video/mp4";
            case "mkv":
                return "video/x-matroska";
            case "webm":
                return "video/webm";
            case "3gp":
                return "video/3gpp";
            case "mp3":
                return "audio/mpeg";
            case "m4a":
                return "audio/mp4";
            case "wav":
                return "audio/wav";
            case "ogg":
                return "audio/ogg";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "txt":
            case "log":
                return "text/plain";
            case "json":
                return "application/json";
            case "doc":
                return "application/msword";
            case "docx":
                return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xls":
                return "application/vnd.ms-excel";
            case "xlsx":
                return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            default:
                break;
        }
        if (!ext.isEmpty()) {
            String guessed = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (guessed != null && !guessed.isEmpty()) return guessed;
        }
        return "application/octet-stream";
    }

    private static String extensionOf(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toLowerCase(Locale.US);
    }

    private static void copy(InputStream input, OutputStream output, long total, Progress progress) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        long written = 0;
        int read;
        int lastPct = -1;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
            written += read;
            if (progress != null && total > 0) {
                int pct = (int) (written * 100 / total);
                if (pct != lastPct) {
                    lastPct = pct;
                    progress.onProgress(written, total);
                }
            }
        }
        output.flush();
        if (progress != null) progress.onProgress(written, total > 0 ? total : written);
    }

    private static File unique(File dir, String name) {
        File target = new File(dir, name);
        if (!target.exists()) return target;
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }
        int index = 1;
        while (target.exists()) {
            target = new File(dir, base + " (" + index + ")" + ext);
            index++;
        }
        return target;
    }

    private static String sanitize(String name) {
        if (name == null || name.trim().isEmpty()) return "file-" + System.currentTimeMillis();
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return cleaned.isEmpty() ? "file-" + System.currentTimeMillis() : cleaned;
    }

    public static String humanSize(long bytes) {
        if (bytes <= 0) return "0 B";
        String[] units = {"B", "KB", "MB", "GB", "TB"};
        double value = bytes;
        int index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index++;
        }
        return String.format(Locale.US, value >= 10 || index == 0 ? "%.0f %s" : "%.1f %s", value, units[index]);
    }

    private static void log(String message) {
        Log.d(TAG, message);
    }
}

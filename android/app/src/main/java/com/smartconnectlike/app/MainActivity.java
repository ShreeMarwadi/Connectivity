package com.smartconnectlike.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.android.material.button.MaterialButton;

import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;

public class MainActivity extends AppCompatActivity implements Core.Listener {
    private static final int REQ_PROJECTION = 100;
    private static final int REQ_FILES = 101;
    private static final int REQ_NOTIFICATIONS = 102;

    private Core core;
    private LinearLayout deviceList;
    private TextView emptyDevices;
    private TextView statusPill;
    private TextView statusLog;
    private TextView deviceNameText;
    private TextView deviceIpText;

    private final List<Device> devices = new ArrayList<>();
    private final OkHttpClient http = new OkHttpClient();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final SimpleDateFormat clock = new SimpleDateFormat("HH:mm:ss", Locale.US);

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        core = Core.get(this);

        deviceList = findViewById(R.id.deviceList);
        emptyDevices = findViewById(R.id.emptyDevices);
        statusPill = findViewById(R.id.statusPill);
        statusLog = findViewById(R.id.statusLog);
        deviceNameText = findViewById(R.id.deviceNameText);
        deviceIpText = findViewById(R.id.deviceIpText);

        statusLog.setText("Ready. Looking for your PC…");
        deviceNameText.setText(core.deviceName);
        deviceIpText.setText("This device · " + NetUtil.localIp());

        deviceNameText.setOnClickListener(v -> showRenameDialog());

        ((MaterialButton) findViewById(R.id.btnMirrorTablet)).setOnClickListener(v -> requestProjection());
        ((MaterialButton) findViewById(R.id.btnViewPc)).setOnClickListener(v -> openMirror("mirror-pc"));
        ((MaterialButton) findViewById(R.id.btnSendFiles)).setOnClickListener(v -> pickFiles());
        ((MaterialButton) findViewById(R.id.btnFilesFromPc)).setOnClickListener(v -> openFiles());
        ((MaterialButton) findViewById(R.id.btnFacecam)).setOnClickListener(v -> openMirror("webcam"));

        core.addListener(this);
        devices.clear();
        devices.addAll(core.discovery.peers());
        renderDevices();
        requestNotificationPermission();
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 300);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateConnectionState();
    }

    @Override
    protected void onDestroy() {
        core.removeListener(this);
        super.onDestroy();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
            }
        }
    }

    @Override
    public void onDevices(List<Device> list) {
        devices.clear();
        devices.addAll(list);
        renderDevices();
    }

    @Override
    public void onConnection(boolean connected, Device device) {
        updateConnectionState();
        if (connected && device != null) log("Paired with " + device.name);
    }

    @Override
    public void onStatus(String text) {
        log(text);
    }

    @Override
    public void onMessage(JSONObject message) {
        String type = message.optString("type");
        if ("request-tablet-screen".equals(type)) {
            log("PC asked for your screen — approve the prompt");
            runOnUiThread(this::requestProjection);
            return;
        }
        if ("open-viewer".equals(type)) {
            // The PC pressed "Show on tablet": open the viewer so the PC can start sending.
            String requested = message.optString("mode");
            String mode = "extend".equals(requested) ? "extend" : "webcam".equals(requested) ? "webcam" : "mirror-pc";
            log("PC started a session (" + mode + ") — opening viewer");
            runOnUiThread(() -> openViewer(mode));
        }
    }

    /**
     * Opens (or reuses, thanks to singleTop) the fullscreen viewer for a PC-initiated session.
     */
    private void openViewer(String mode) {
        if (!core.isConnected()) {
            toast("PC is not connected anymore");
            return;
        }
        Intent intent = new Intent(this, MirrorActivity.class);
        intent.putExtra(MirrorActivity.EXTRA_MODE, mode);
        startActivity(intent);
    }

    private void updateConnectionState() {
        boolean connected = core.isConnected();
        statusPill.setText(connected ? "Connected" : "Searching");
        if (core.connected != null) {
            deviceIpText.setText("This device · " + NetUtil.localIp() + "  →  " + core.connected.name);
        }
    }

    private void renderDevices() {
        deviceList.removeAllViews();
        emptyDevices.setVisibility(devices.isEmpty() ? View.VISIBLE : View.GONE);
        LayoutInflater inflater = LayoutInflater.from(this);
        for (Device device : devices) {
            View row = inflater.inflate(R.layout.row_device, deviceList, false);
            TextView name = row.findViewById(R.id.rowName);
            TextView ip = row.findViewById(R.id.rowIp);
            TextView glyph = row.findViewById(R.id.rowGlyph);
            MaterialButton connect = row.findViewById(R.id.rowConnect);

            name.setText(device.name);
            ip.setText(device.subtitle());
            glyph.setText("🖥");
            boolean active = core.connected != null && core.connected.id.equals(device.id) && core.isConnected();
            connect.setText(active ? "Connected" : "Connect");
            connect.setEnabled(!active);
            connect.setOnClickListener(v -> core.connect(device));
            deviceList.addView(row);
        }
    }

    private void showRenameDialog() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setText(core.deviceName);
        input.setSelection(input.getText().length());
        new AlertDialog.Builder(this)
                .setTitle("Tablet name")
                .setView(input)
                .setPositiveButton("Save", (dialog, which) -> {
                    String name = input.getText().toString().trim();
                    if (!name.isEmpty()) {
                        core.rename(name);
                        deviceNameText.setText(name);
                        log("Renamed to " + name);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void requestProjection() {
        if (!core.isConnected()) {
            toast("Connect to your PC first");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        if (manager == null) {
            toast("Screen capture is not available");
            return;
        }
        startActivityForResult(manager.createScreenCaptureIntent(), REQ_PROJECTION);
    }

    private void openMirror(String mode) {
        if (!core.isConnected()) {
            toast("Connect to your PC first");
            return;
        }
        Intent intent = new Intent(this, MirrorActivity.class);
        intent.putExtra(MirrorActivity.EXTRA_MODE, mode);
        startActivity(intent);
    }

    private void openFiles() {
        if (!core.isConnected()) {
            toast("Connect to your PC first");
            return;
        }
        startActivity(new Intent(this, FilesActivity.class));
    }

    private void pickFiles() {
        if (!core.isConnected()) {
            toast("Connect to your PC first");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(intent, REQ_FILES);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PROJECTION) {
            if (resultCode == Activity.RESULT_OK && data != null) {
                Intent service = new Intent(this, ProjectionService.class)
                        .setAction(ProjectionService.ACTION_START)
                        .putExtra(ProjectionService.EXTRA_RESULT_CODE, resultCode)
                        .putExtra(ProjectionService.EXTRA_DATA, data);
                ContextCompat.startForegroundService(this, service);
                log("Sharing tablet screen — check your PC");
            } else {
                log("Screen sharing cancelled");
            }
            return;
        }
        if (requestCode == REQ_FILES && resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    upload(data.getClipData().getItemAt(i).getUri());
                }
            } else if (data.getData() != null) {
                upload(data.getData());
            }
        }
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? "file-" + System.currentTimeMillis() : last;
    }

    private long sizeOf(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0) return cursor.getLong(index);
            }
        } catch (Exception ignored) {
        }
        return -1;
    }

    private void upload(Uri uri) {
        Device device = core.connected;
        if (device == null) return;
        String name = displayName(uri);
        long size = sizeOf(uri);
        log("Sending " + name + "…");

        io.execute(() -> {
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new IOException("Cannot read the selected file");
                RequestBody body = new RequestBody() {
                    @Override
                    public MediaType contentType() {
                        return MediaType.parse("application/octet-stream");
                    }

                    @Override
                    public long contentLength() {
                        return size;
                    }

                    @Override
                    public void writeTo(@NonNull BufferedSink sink) throws IOException {
                        byte[] buffer = new byte[64 * 1024];
                        long sent = 0;
                        int lastPct = -1;
                        int read;
                        while ((read = input.read(buffer)) != -1) {
                            sink.write(buffer, 0, read);
                            sent += read;
                            if (size > 0) {
                                int pct = (int) (sent * 100 / size);
                                if (pct / 10 != lastPct / 10) {
                                    lastPct = pct;
                                    runOnUiThread(() -> log("Sending " + name + " · " + pct + "%"));
                                }
                            }
                        }
                    }
                };
                Request request = new Request.Builder()
                        .url("http://" + device.ip + ":" + device.http + "/api/upload?name=" + Urls.encode(name))
                        .post(body)
                        .build();
                try (Response response = http.newCall(request).execute()) {
                    if (response.isSuccessful()) {
                        runOnUiThread(() -> {
                            toast("Sent " + name);
                            log("Sent " + name + " to PC");
                        });
                    } else {
                        runOnUiThread(() -> log("Upload failed: HTTP " + response.code()));
                    }
                }
            } catch (Exception err) {
                runOnUiThread(() -> log("Upload failed: " + err.getMessage()));
            }
        });
    }

    private void log(String line) {
        String entry = clock.format(new Date()) + "  " + line;
        runOnUiThread(() -> {
            if (statusLog.getText().toString().startsWith("Ready.")) {
                statusLog.setText(entry);
            } else {
                statusLog.append("\n" + entry);
            }
        });
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}

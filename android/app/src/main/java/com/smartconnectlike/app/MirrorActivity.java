package com.smartconnectlike.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;
import org.webrtc.SurfaceViewRenderer;
import org.webrtc.VideoTrack;

import java.util.UUID;

public class MirrorActivity extends AppCompatActivity implements Core.Listener {
    public static final String EXTRA_MODE = "mode";
    private static final int REQ_CAMERA = 21;

    private Core core;
    private SurfaceViewRenderer renderer;
    private TextView statusView;
    private TextView titleView;
    private TextView hintView;
    private TextView waitView;
    private String mode = "mirror-pc";
    private String session;
    private long lastMove = 0;
    private float downX;
    private float downY;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_mirror);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();

        core = Core.get(this);
        mode = getIntent().getStringExtra(EXTRA_MODE);
        if (mode == null) mode = "mirror-pc";
        session = UUID.randomUUID().toString();

        renderer = findViewById(R.id.remoteView);
        statusView = findViewById(R.id.mirrorStatus);
        titleView = findViewById(R.id.mirrorTitle);
        hintView = findViewById(R.id.touchModeHint);
        waitView = findViewById(R.id.mirrorHint);
        FrameLayout touchLayer = findViewById(R.id.touchLayer);

        titleView.setText(titleFor(mode));
        hintView.setText(mode.equals("extend")
                ? "Touch to click inside the extended display"
                : mode.equals("webcam")
                        ? "Your tablet camera is live on the PC · tap here to flip"
                        : "Tap to click · drag to move the pointer");

        renderer.init(core.rtc.eglContext(), null);
        renderer.setEnableHardwareScaler(true);
        renderer.setMirror(mode.equals("webcam"));

        core.rtc.setListener(new RtcClient.Listener() {
            @Override
            public void onState(String state) {
                runOnUiThread(() -> {
                    statusView.setText(stateLabel(state));
                    // In facecam mode the hint doubles as the flip button, so keep it visible.
                    if ("connected".equals(state) && !mode.equals("webcam")) {
                        hintView.setVisibility(View.GONE);
                    }
                    if ("connected".equals(state) && waitView != null) waitView.setVisibility(View.GONE);
                });
            }

            @Override
            public void onRemoteTrack(VideoTrack track) {
                runOnUiThread(() -> {
                    if (!mode.equals("webcam")) hintView.setVisibility(View.GONE);
                    // The "Waiting for video…" label used to stay on screen forever and
                    // showed up as a watermark in the middle of the extended display.
                    if (waitView != null) waitView.setVisibility(View.GONE);
                    statusView.setText("Live");
                });
            }

            @Override
            public void onLocalTrack(VideoTrack track) {
                runOnUiThread(() -> {
                    if (waitView != null) waitView.setVisibility(View.GONE);
                    if (renderer != null) {
                        track.addSink(renderer);
                    }
                    statusView.setText("Camera live");
                });
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> {
                    statusView.setText("Error");
                    Toast.makeText(MirrorActivity.this, message, Toast.LENGTH_LONG).show();
                });
            }
        });

        core.addListener(this);
        if (mode.equals("webcam")) {
            touchLayer.setVisibility(View.GONE);
            hintView.setOnClickListener(v -> {
                core.rtc.switchCamera();
                Toast.makeText(this, "Switching camera", Toast.LENGTH_SHORT).show();
            });
            renderer.setOnClickListener(v -> {
                core.rtc.switchCamera();
                Toast.makeText(this, "Switching camera", Toast.LENGTH_SHORT).show();
            });
            ensureCameraPermissionThenStart();
        } else {
            core.rtc.prepareViewer(renderer, mode, session);
            sendSessionRequest();
        }

        findViewById(R.id.btnCloseMirror).setOnClickListener(v -> finish());
        touchLayer.setOnTouchListener(this::onTouchPad);
    }

    private void ensureCameraPermissionThenStart() {
        if (checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            startFacecam();
            return;
        }
        requestPermissions(new String[] { android.Manifest.permission.CAMERA }, REQ_CAMERA);
    }

    private void startFacecam() {
        statusView.setText("Opening camera…");
        // Tells the PC that this session is the tablet camera (and clears its open-viewer timer).
        sendSessionRequest();
        core.rtc.startCamera("webcam", true);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_CAMERA) return;
        if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
            startFacecam();
        } else {
            statusView.setText("Camera permission denied");
            Toast.makeText(this, "Allow the camera so the PC can use it", Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Asks the PC to start sending this session. Also used when the PC pushes a new
     * session into the already-open viewer (singleTop + onNewIntent).
     */
    private void sendSessionRequest() {
        JSONObject request = new JSONObject();
        try {
            request.put("type", "session-request");
            request.put("session", session);
            request.put("mode", mode);
            request.put("size", new JSONObject().put("width", 1280).put("height", 800));
        } catch (Exception ignored) {
        }
        core.send(request);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String next = intent.getStringExtra(EXTRA_MODE);
        if (next != null) mode = next;
        if (titleView != null) titleView.setText(titleFor(mode));
        if (hintView != null) {
            hintView.setVisibility(View.VISIBLE);
            hintView.setText(mode.equals("extend")
                    ? "Touch to click inside the extended display"
                    : mode.equals("webcam")
                            ? "Your tablet camera is live on the PC · tap here to flip"
                            : "Tap to click · drag to move the pointer");
        }
        if (mode.equals("webcam")) {
            ensureCameraPermissionThenStart();
            return;
        }
        if (statusView != null) statusView.setText("Waiting for the PC…");
        if (waitView != null) waitView.setVisibility(View.VISIBLE);
        core.rtc.prepareViewer(renderer, mode, session);
        sendSessionRequest();
    }

    private String titleFor(String value) {
        if ("extend".equals(value)) return "Extended display";
        if ("webcam".equals(value)) return "Facecam";
        return "PC screen";
    }

    @SuppressLint("ClickableViewAccessibility")
    private boolean onTouchPad(View view, MotionEvent event) {
        if (!core.isConnected()) return true;
        float width = Math.max(1f, view.getWidth());
        float height = Math.max(1f, view.getHeight());
        float x = Math.min(1f, Math.max(0f, event.getX() / width));
        float y = Math.min(1f, Math.max(0f, event.getY() / height));

        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = x;
                downY = y;
                sendInput("move", x, y, 0);
                sendInput("down", x, y, 0);
                return true;
            case MotionEvent.ACTION_MOVE: {
                long now = System.currentTimeMillis();
                if (now - lastMove > 16) {
                    lastMove = now;
                    sendInput("move", x, y, 0);
                }
                return true;
            }
            case MotionEvent.ACTION_UP: {
                float dx = Math.abs(x - downX);
                float dy = Math.abs(y - downY);
                if (dx > 0.01f || dy > 0.01f) {
                    sendInput("move", x, y, 0);
                }
                sendInput("up", x, y, 0);
                return true;
            }
            case MotionEvent.ACTION_CANCEL: {
                sendInput("up", x, y, 0);
                return true;
            }
            default:
                return false;
        }
    }

    private void sendInput(String type, float x, float y, int button) {
        try {
            JSONObject evt = new JSONObject();
            evt.put("t", type);
            evt.put("x", x);
            evt.put("y", y);
            evt.put("button", button);
            JSONObject message = new JSONObject();
            message.put("type", "input");
            message.put("session", session);
            message.put("event", evt);
            core.send(message);
        } catch (Exception ignored) {
        }
    }

    private String stateLabel(String state) {
        switch (state) {
            case "waiting":
                return "Waiting for the PC…";
            case "connecting":
                return "Connecting video…";
            case "connected":
                return "Live";
            case "reconnecting":
                return "Reconnecting…";
            case "failed":
                return "Connection failed";
            case "stopped":
                return "Stopped";
            default:
                return state;
        }
    }

    @Override
    public void onMessage(JSONObject message) {
        String type = message.optString("type");
        if ("signal".equals(type)) {
            core.rtc.handleSignal(message);
        } else if ("webcam-switch".equals(type) && "webcam".equals(mode)) {
            core.rtc.switchCamera();
        } else if ("session-stop".equals(type)) {
            runOnUiThread(() -> {
                Toast.makeText(this, "Session ended by PC", Toast.LENGTH_SHORT).show();
                finish();
            });
        }
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    protected void onDestroy() {
        try {
            JSONObject stop = new JSONObject();
            stop.put("type", "session-stop");
            stop.put("session", session);
            core.send(stop);
        } catch (Exception ignored) {
        }
        core.removeListener(this);
        core.rtc.stop();
        if (renderer != null) {
            renderer.release();
        }
        super.onDestroy();
    }
}

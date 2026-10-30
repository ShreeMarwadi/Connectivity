package com.smartconnectlike.app;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class SignalClient {
    private static final String TAG = "SC-Signal";

    public interface Listener {
        void onOpen();

        void onClosed(String reason);

        void onMessage(JSONObject message);
    }

    private final OkHttpClient client = new OkHttpClient.Builder()
            .pingInterval(15, TimeUnit.SECONDS)
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build();
    private final Handler main = new Handler(Looper.getMainLooper());

    private WebSocket socket;
    private Listener listener;
    private String url;
    private volatile boolean closing;

    public boolean isOpen() {
        return socket != null && !closing;
    }

    public void connect(String ip, int port, String deviceId, String deviceName, Listener listener) {
        this.listener = listener;
        this.closing = false;
        String query = "?id=" + Urls.encode(deviceId) + "&name=" + Urls.encode(deviceName) + "&kind=tablet";
        this.url = "ws://" + ip + ":" + port + "/ws" + query;
        close();
        this.closing = false;
        this.listener = listener;

        Request request = new Request.Builder().url(url).build();
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                Log.i(TAG, "connected " + url);
                main.post(() -> {
                    if (SignalClient.this.listener != null) SignalClient.this.listener.onOpen();
                });
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                try {
                    JSONObject msg = new JSONObject(text);
                    main.post(() -> {
                        if (SignalClient.this.listener != null) SignalClient.this.listener.onMessage(msg);
                    });
                } catch (Exception err) {
                    Log.w(TAG, "bad message: " + text);
                }
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                Log.i(TAG, "closed " + code + " " + reason);
                main.post(() -> {
                    if (!closing && SignalClient.this.listener != null) SignalClient.this.listener.onClosed(reason);
                });
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                Log.w(TAG, "failure " + t.getMessage());
                main.post(() -> {
                    if (!closing && SignalClient.this.listener != null)
                        SignalClient.this.listener.onClosed(t.getMessage());
                });
            }
        });
    }

    public void send(JSONObject message) {
        WebSocket ws = socket;
        if (ws != null) ws.send(message.toString());
    }

    public void close() {
        closing = true;
        WebSocket ws = socket;
        socket = null;
        if (ws != null) {
            try {
                ws.close(1000, "bye");
            } catch (Exception ignored) {
            }
        }
    }
}

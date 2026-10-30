package com.smartconnectlike.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

public class Core {
    private static final String TAG = "SC-Core";
    private static Core instance;

    public interface Listener {
        default void onDevices(List<Device> devices) {
        }

        default void onConnection(boolean connected, Device device) {
        }

        default void onMessage(JSONObject message) {
        }

        default void onStatus(String text) {
        }
    }

    public static synchronized Core get(Context context) {
        if (instance == null) instance = new Core(context.getApplicationContext());
        return instance;
    }

    public final String deviceId;
    public String deviceName;
    public final Discovery discovery;
    public final RtcClient rtc;
    public SignalClient signal;
    public Device connected;

    private final Context context;
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean manualClose;

    private Core(Context context) {
        this.context = context;
        this.deviceId = Prefs.deviceId(context);
        this.deviceName = Prefs.deviceName(context);
        this.discovery = new Discovery(context, deviceId, deviceName);
        this.discovery.setListener(this::dispatchDevices);
        this.discovery.start();
        this.rtc = new RtcClient(context);
    }

    public void addListener(Listener listener) {
        if (!listeners.contains(listener)) listeners.add(listener);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    public void rename(String name) {
        deviceName = name;
        Prefs.setDeviceName(context, name);
        discovery.setDeviceName(name);
        for (Listener listener : listeners) listener.onStatus("Device renamed to " + name);
    }

    private void dispatchDevices(List<Device> devices) {
        for (Listener listener : listeners) listener.onDevices(devices);
        if (connected == null && !devices.isEmpty()) {
            connect(devices.get(0));
        }
    }

    public void connect(Device device) {
        if (device == null) return;
        if (connected != null && connected.id.equals(device.id) && signal != null && signal.isOpen()) return;

        manualClose = false;
        connected = device;
        signal = new SignalClient();
        rtc.setSignal(signal);
        dispatchStatus("Connecting to " + device.name + "…");

        signal.connect(device.ip, device.ws, deviceId, deviceName, new SignalClient.Listener() {
            @Override
            public void onOpen() {
                device.connected = true;
                dispatchStatus("Connected to " + device.name + " (" + device.ip + ")");
                for (Listener listener : listeners) listener.onConnection(true, device);
            }

            @Override
            public void onClosed(String reason) {
                device.connected = false;
                dispatchStatus("Disconnected: " + reason);
                for (Listener listener : listeners) listener.onConnection(false, device);
                if (!manualClose) retry(device);
            }

            @Override
            public void onMessage(JSONObject message) {
                for (Listener listener : listeners) listener.onMessage(message);
            }
        });
    }

    private void retry(Device device) {
        main.postDelayed(() -> {
            if (!manualClose && (connected == null || connected.id.equals(device.id)) && (signal == null || !signal.isOpen())) {
                connect(device);
            }
        }, 3000);
    }

    public void disconnect() {
        manualClose = true;
        if (signal != null) signal.close();
        signal = null;
        connected = null;
        for (Listener listener : listeners) listener.onConnection(false, null);
    }

    public void send(JSONObject message) {
        SignalClient client = signal;
        if (client != null) {
            client.send(message);
        } else {
            Log.w(TAG, "no signal connection");
        }
    }

    public boolean isConnected() {
        return signal != null && signal.isOpen() && connected != null;
    }

    private void dispatchStatus(String text) {
        for (Listener listener : listeners) listener.onStatus(text);
    }
}

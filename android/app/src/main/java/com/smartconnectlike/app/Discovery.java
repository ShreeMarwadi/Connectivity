package com.smartconnectlike.app;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class Discovery {
    private static final String TAG = "SC-Discovery";
    public static final int PORT = 47777;
    private static final long EXPIRE_MS = 9000L;

    public interface Listener {
        void onDevices(List<Device> devices);
    }

    private final Context context;
    private final String deviceId;
    private String deviceName;
    private final Map<String, Device> peers = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    private DatagramSocket socket;
    private Thread receiver;
    private Thread announcer;
    private volatile boolean running;
    private WifiManager.MulticastLock multicastLock;
    private Listener listener;

    public Discovery(Context context, String deviceId, String deviceName) {
        this.context = context.getApplicationContext();
        this.deviceId = deviceId;
        this.deviceName = deviceName;
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    public void setDeviceName(String name) {
        this.deviceName = name;
    }

    public void start() {
        if (running) return;
        running = true;
        try {
            WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                multicastLock = wifi.createMulticastLock("smartconnect-discovery");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
        } catch (Exception ignored) {
        }

        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress(PORT));
        } catch (Exception err) {
            Log.e(TAG, "bind failed", err);
            running = false;
            return;
        }

        receiver = new Thread(this::receiveLoop, "sc-discovery-rx");
        receiver.setDaemon(true);
        receiver.start();

        announcer = new Thread(this::announceLoop, "sc-discovery-tx");
        announcer.setDaemon(true);
        announcer.start();
    }

    public void stop() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (Exception ignored) {
        }
        socket = null;
        try {
            if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        } catch (Exception ignored) {
        }
    }

    public List<Device> peers() {
        List<Device> list = new ArrayList<>(peers.values());
        Collections.sort(list, Comparator.comparing(a -> a.name));
        return list;
    }

    private void announceLoop() {
        while (running) {
            try {
                sendHello();
            } catch (Exception err) {
                Log.w(TAG, "announce failed: " + err.getMessage());
            }
            for (int i = 0; i < 24 && running; i++) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException ignored) {
                }
            }
            expire();
        }
    }

    private void sendHello() throws Exception {
        JSONObject packet = new JSONObject();
        packet.put("sc", "hello");
        packet.put("v", 1);
        packet.put("id", deviceId);
        packet.put("name", deviceName);
        packet.put("kind", "tablet");
        packet.put("ws", 0);
        packet.put("http", 0);
        packet.put("features", new org.json.JSONArray().put("mirror").put("extend").put("files"));
        byte[] bytes = packet.toString().getBytes(StandardCharsets.UTF_8);
        for (InetAddress address : NetUtil.broadcastAddresses()) {
            try {
                DatagramPacket out = new DatagramPacket(bytes, bytes.length, address, PORT);
                socket.send(out);
            } catch (Exception ignored) {
            }
        }
    }

    private void receiveLoop() {
        byte[] buffer = new byte[4096];
        while (running) {
            try {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                socket.receive(packet);
                String json = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8);
                handlePacket(json, packet.getAddress());
            } catch (Exception err) {
                if (running) Log.w(TAG, "receive failed: " + err.getMessage());
            }
        }
    }

    private void handlePacket(String json, InetAddress from) {
        try {
            JSONObject packet = new JSONObject(json);
            if (!"hello".equals(packet.optString("sc"))) return;
            String id = packet.optString("id");
            if (id.isEmpty() || id.equals(deviceId)) return;
            if (!"desktop".equals(packet.optString("kind"))) return;

            Device device = new Device();
            device.id = id;
            device.name = packet.optString("name", "Computer");
            device.kind = "desktop";
            device.ip = from.getHostAddress();
            device.ws = packet.optInt("ws", 47800);
            device.http = packet.optInt("http", 47801);
            device.lastSeen = System.currentTimeMillis();
            boolean isNew = !peers.containsKey(id);
            peers.put(id, device);
            if (isNew) notifyDevices();
        } catch (Exception err) {
            Log.w(TAG, "bad packet: " + err.getMessage());
        }
    }

    private void expire() {
        long cutoff = System.currentTimeMillis() - EXPIRE_MS;
        boolean changed = false;
        Iterator<Map.Entry<String, Device>> it = peers.entrySet().iterator();
        while (it.hasNext()) {
            if (it.next().getValue().lastSeen < cutoff) {
                it.remove();
                changed = true;
            }
        }
        if (changed) notifyDevices();
    }

    private void notifyDevices() {
        final List<Device> list = peers();
        main.post(() -> {
            if (listener != null) listener.onDevices(list);
        });
    }
}

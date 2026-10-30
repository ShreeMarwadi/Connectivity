package com.smartconnectlike.app;

public class Device {
    public String id = "";
    public String name = "";
    public String kind = "desktop";
    public String ip = "";
    public int ws = 47800;
    public int http = 47801;
    public long lastSeen = 0L;
    public boolean connected = false;

    public String subtitle() {
        return (kind.equals("tablet") ? "Tablet" : "Computer") + " · " + ip;
    }
}

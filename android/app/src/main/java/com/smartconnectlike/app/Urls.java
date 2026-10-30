package com.smartconnectlike.app;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;

public final class Urls {
    private Urls() {
    }

    public static String encode(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (UnsupportedEncodingException err) {
            return "";
        }
    }
}

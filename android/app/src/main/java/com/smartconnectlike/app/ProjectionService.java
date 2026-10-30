package com.smartconnectlike.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class ProjectionService extends Service {
    public static final String ACTION_START = "com.smartconnectlike.app.START";
    public static final String ACTION_STOP = "com.smartconnectlike.app.STOP";
    public static final String EXTRA_RESULT_CODE = "resultCode";
    public static final String EXTRA_DATA = "data";

    private static final int NOTIFICATION_ID = 42;

    private Core core;

    @Override
    public void onCreate() {
        super.onCreate();
        core = Core.get(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        if (ACTION_STOP.equals(intent.getAction())) {
            stopSharing();
            return START_NOT_STICKY;
        }

        startForegroundNow();

        Intent data = intent.getParcelableExtra(EXTRA_DATA);
        if (data == null) {
            stopSharing();
            return START_NOT_STICKY;
        }

        core.rtc.setListener(new RtcClient.Listener() {
            @Override
            public void onState(String state) {
                // Screen sharing runs in the background; the PC shows the result.
            }

            @Override
            public void onRemoteTrack(org.webrtc.VideoTrack track) {
            }

            @Override
            public void onError(String message) {
                stopSharing();
            }
        });
        core.rtc.startScreenShare(data, "mirror-tablet");
        return START_NOT_STICKY;
    }

    private void startForegroundNow() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, App.CHANNEL_ID)
                .setContentTitle(getString(R.string.notif_sharing_title))
                .setContentText(getString(R.string.notif_sharing_text))
                .setSmallIcon(R.drawable.ic_notification)
                .setContentIntent(pending)
                .setOngoing(true)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void stopSharing() {
        core.rtc.stop();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        core.rtc.stop();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}

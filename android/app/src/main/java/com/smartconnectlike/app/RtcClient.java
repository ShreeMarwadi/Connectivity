package com.smartconnectlike.app;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONObject;
import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.MediaStreamTrack;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.RtpTransceiver;
import org.webrtc.ScreenCapturerAndroid;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.SurfaceViewRenderer;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class RtcClient {
    private static final String TAG = "SC-WebRTC";

    public interface Listener {
        void onState(String state);

        void onRemoteTrack(VideoTrack track);

        void onError(String message);
    }

    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Queue<IceCandidate> pendingIce = new ConcurrentLinkedQueue<>();

    private SignalClient signal;
    private Listener listener;
    private PeerConnectionFactory factory;
    private EglBase eglBase;

    private PeerConnection pc;
    private SurfaceViewRenderer renderer;
    private VideoTrack remoteTrack;
    private VideoTrack localTrack;

    private ScreenCapturerAndroid capturer;
    private VideoSource screenSource;
    private SurfaceTextureHelper textureHelper;

    private String session;
    private String mode = "mirror-pc";
    private boolean hasRemoteDescription;
    private volatile boolean stopped;

    public RtcClient(Context context) {
        this.context = context.getApplicationContext();
    }

    public void setSignal(SignalClient signal) {
        this.signal = signal;
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    public EglBase.Context eglContext() {
        ensureFactory();
        return eglBase.getEglBaseContext();
    }

    private synchronized void ensureFactory() {
        if (factory != null) return;
        PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context)
                        .setEnableInternalTracer(false)
                        .createInitializationOptions());
        eglBase = EglBase.create();
        DefaultVideoEncoderFactory encoder = new DefaultVideoEncoderFactory(eglBase.getEglBaseContext(), true, true);
        DefaultVideoDecoderFactory decoder = new DefaultVideoDecoderFactory(eglBase.getEglBaseContext());
        factory = PeerConnectionFactory.builder()
                .setVideoEncoderFactory(encoder)
                .setVideoDecoderFactory(decoder)
                .createPeerConnectionFactory();
    }

    /** Prepares a receive-only session. The desktop sends the offer afterwards. */
    public void prepareViewer(SurfaceViewRenderer view, String mode, String sessionId) {
        this.renderer = view;
        this.mode = mode;
        this.session = sessionId;
        this.stopped = false;
        worker.execute(() -> {
            try {
                ensureFactory();
                closePeer();
                PeerConnection connection = createPeer();
                connection.addTransceiver(
                        MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                        new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY));
                emit("waiting");
            } catch (Exception err) {
                fail(err);
            }
        });
    }

    /** Captures the tablet screen and offers it to the desktop. */
    public void startScreenShare(Intent projectionData, String mode) {
        this.mode = mode;
        this.stopped = false;
        worker.execute(() -> {
            try {
                ensureFactory();
                closePeer();
                this.session = UUID.randomUUID().toString();
                PeerConnection connection = createPeer();

                capturer = new ScreenCapturerAndroid(projectionData, new android.media.projection.MediaProjection.Callback() {
                    @Override
                    public void onStop() {
                        emit("stopped");
                    }
                });
                screenSource = factory.createVideoSource(false);
                textureHelper = SurfaceTextureHelper.create("SC-Capture", eglBase.getEglBaseContext());
                capturer.initialize(textureHelper, context, screenSource.getCapturerObserver());
                capturer.startCapture(1280, 720, 30);

                localTrack = factory.createVideoTrack("screen0", screenSource);
                localTrack.setEnabled(true);
                connection.addTrack(localTrack, Collections.singletonList("screen"));

                SessionDescription offer = awaitOffer(connection);
                if (offer == null) throw new IllegalStateException("Could not create offer");
                awaitSetLocal(connection, offer);
                sendSignal("offer", offer.description);
                emit("sharing");
            } catch (Exception err) {
                fail(err);
            }
        });
    }

    public void handleSignal(JSONObject message) {
        worker.execute(() -> handleSignalBlocking(message));
    }

    private void handleSignalBlocking(JSONObject message) {
        try {
            JSONObject data = message.optJSONObject("data");
            if (data == null) return;
            String kind = data.optString("kind");
            String inbound = message.optString("session", "");
            if (!inbound.isEmpty()) session = inbound;

            if ("offer".equals(kind)) {
                JSONObject sdp = data.optJSONObject("sdp");
                if (sdp == null) return;
                if (pc == null) {
                    PeerConnection connection = createPeer();
                    connection.addTransceiver(
                            MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
                            new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY));
                }
                SessionDescription remote = new SessionDescription(
                        SessionDescription.Type.OFFER,
                        sdp.optString("sdp"));
                if (!awaitSetRemote(pc, remote)) throw new IllegalStateException("setRemote(offer) failed");
                SessionDescription answer = awaitAnswer(pc);
                if (answer == null) throw new IllegalStateException("Could not create answer");
                awaitSetLocal(pc, answer);
                sendSignal("answer", answer.description);
                drainIce();
                emit("connecting");
                return;
            }

            if ("answer".equals(kind)) {
                JSONObject sdp = data.optJSONObject("sdp");
                if (sdp == null || pc == null) return;
                SessionDescription remote = new SessionDescription(
                        SessionDescription.Type.ANSWER,
                        sdp.optString("sdp"));
                awaitSetRemote(pc, remote);
                drainIce();
                emit("connecting");
                return;
            }

            if ("ice".equals(kind)) {
                JSONObject candidate = data.optJSONObject("candidate");
                if (candidate == null) return;
                IceCandidate ice = new IceCandidate(
                        candidate.optString("sdpMid", "0"),
                        candidate.optInt("sdpMLineIndex", 0),
                        candidate.optString("candidate", ""));
                PeerConnection connection = pc;
                if (connection == null || !hasRemoteDescription) {
                    pendingIce.add(ice);
                } else {
                    connection.addIceCandidate(ice);
                }
            }
        } catch (Exception err) {
            fail(err);
        }
    }

    private void drainIce() {
        PeerConnection connection = pc;
        if (connection == null) return;
        IceCandidate ice;
        while ((ice = pendingIce.poll()) != null) {
            try {
                connection.addIceCandidate(ice);
            } catch (Exception ignored) {
            }
        }
    }

    private PeerConnection createPeer() {
        PeerConnection.RTCConfiguration config = new PeerConnection.RTCConfiguration(new ArrayList<>());
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        config.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY;
        config.bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE;

        PeerConnection connection = factory.createPeerConnection(config, new PeerConnection.Observer() {
            @Override
            public void onSignalingChange(PeerConnection.SignalingState state) {
            }

            @Override
            public void onIceConnectionChange(PeerConnection.IceConnectionState state) {
                String name = state.name().toLowerCase();
                if (state == PeerConnection.IceConnectionState.CONNECTED
                        || state == PeerConnection.IceConnectionState.COMPLETED) {
                    emit("connected");
                } else if (state == PeerConnection.IceConnectionState.DISCONNECTED) {
                    emit("reconnecting");
                } else if (state == PeerConnection.IceConnectionState.FAILED) {
                    emit("failed");
                } else {
                    emit(name);
                }
            }

            @Override
            public void onIceConnectionReceivingChange(boolean receiving) {
            }

            @Override
            public void onIceGatheringChange(PeerConnection.IceGatheringState state) {
            }

            @Override
            public void onIceCandidate(IceCandidate candidate) {
                try {
                    JSONObject payload = new JSONObject();
                    payload.put("candidate", candidate.sdp);
                    payload.put("sdpMid", candidate.sdpMid);
                    payload.put("sdpMLineIndex", candidate.sdpMLineIndex);
                    sendSignal("ice", payload);
                } catch (Exception ignored) {
                }
            }

            @Override
            public void onIceCandidatesRemoved(IceCandidate[] candidates) {
            }

            @Override
            public void onAddStream(MediaStream stream) {
            }

            @Override
            public void onRemoveStream(MediaStream stream) {
            }

            @Override
            public void onDataChannel(DataChannel dataChannel) {
            }

            @Override
            public void onRenegotiationNeeded() {
            }

            @Override
            public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {
                MediaStreamTrack track = receiver.track();
                if (track instanceof VideoTrack) {
                    remoteTrack = (VideoTrack) track;
                    SurfaceViewRenderer view = renderer;
                    if (view != null) {
                        remoteTrack.addSink(view);
                        if (listener != null) {
                            final VideoTrack finalTrack = remoteTrack;
                            view.post(() -> listener.onRemoteTrack(finalTrack));
                        }
                    }
                }
            }
        });
        this.pc = connection;
        this.hasRemoteDescription = false;
        return connection;
    }

    private void sendSignal(String kind, String sdp) {
        try {
            JSONObject data = new JSONObject();
            data.put("kind", kind);
            data.put("sdp", new JSONObject().put("type", kind).put("sdp", sdp));
            sendEnvelope(data);
        } catch (Exception ignored) {
        }
    }

    private void sendSignal(String kind, JSONObject payload) {
        try {
            JSONObject data = new JSONObject();
            data.put("kind", kind);
            if ("ice".equals(kind)) {
                data.put("candidate", payload);
            } else {
                data.put("sdp", payload);
            }
            sendEnvelope(data);
        } catch (Exception ignored) {
        }
    }

    private void sendEnvelope(JSONObject data) {
        SignalClient client = signal;
        if (client == null) return;
        try {
            JSONObject message = new JSONObject();
            message.put("type", "signal");
            message.put("session", session == null ? "" : session);
            message.put("mode", mode);
            message.put("data", data);
            client.send(message);
        } catch (Exception ignored) {
        }
    }

    private SessionDescription awaitOffer(PeerConnection connection) throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<SessionDescription> result = new AtomicReference<>();
        connection.createOffer(new SdpAdapter() {
            @Override
            public void onCreateSuccess(SessionDescription sdp) {
                result.set(sdp);
                latch.countDown();
            }

            @Override
            public void onCreateFailure(String error) {
                Log.e(TAG, "createOffer failed " + error);
                latch.countDown();
            }
        }, new MediaConstraints());
        latch.await(6, TimeUnit.SECONDS);
        return result.get();
    }

    private SessionDescription awaitAnswer(PeerConnection connection) throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<SessionDescription> result = new AtomicReference<>();
        connection.createAnswer(new SdpAdapter() {
            @Override
            public void onCreateSuccess(SessionDescription sdp) {
                result.set(sdp);
                latch.countDown();
            }

            @Override
            public void onCreateFailure(String error) {
                Log.e(TAG, "createAnswer failed " + error);
                latch.countDown();
            }
        }, new MediaConstraints());
        latch.await(6, TimeUnit.SECONDS);
        return result.get();
    }

    private boolean awaitSetLocal(PeerConnection connection, SessionDescription sdp) throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<Boolean> ok = new AtomicReference<>(false);
        connection.setLocalDescription(new SdpAdapter() {
            @Override
            public void onSetSuccess() {
                ok.set(true);
                latch.countDown();
            }

            @Override
            public void onSetFailure(String error) {
                Log.e(TAG, "setLocal failed " + error);
                latch.countDown();
            }
        }, sdp);
        latch.await(6, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(ok.get());
    }

    private boolean awaitSetRemote(PeerConnection connection, SessionDescription sdp) throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<Boolean> ok = new AtomicReference<>(false);
        connection.setRemoteDescription(new SdpAdapter() {
            @Override
            public void onSetSuccess() {
                ok.set(true);
                latch.countDown();
            }

            @Override
            public void onSetFailure(String error) {
                Log.e(TAG, "setRemote failed " + error);
                latch.countDown();
            }
        }, sdp);
        latch.await(6, TimeUnit.SECONDS);
        hasRemoteDescription = Boolean.TRUE.equals(ok.get());
        return hasRemoteDescription;
    }

    public void stop() {
        stopped = true;
        worker.execute(() -> {
            try {
                if (capturer != null) {
                    capturer.stopCapture();
                    capturer.dispose();
                    capturer = null;
                }
                if (localTrack != null) {
                    localTrack.dispose();
                    localTrack = null;
                }
                if (screenSource != null) {
                    screenSource.dispose();
                    screenSource = null;
                }
                if (textureHelper != null) {
                    textureHelper.dispose();
                    textureHelper = null;
                }
                if (remoteTrack != null && renderer != null) {
                    remoteTrack.removeSink(renderer);
                }
                remoteTrack = null;
                closePeer();
                emit("idle");
            } catch (Exception err) {
                Log.w(TAG, "stop failed", err);
            }
        });
    }

    private void closePeer() {
        PeerConnection connection = pc;
        pc = null;
        hasRemoteDescription = false;
        pendingIce.clear();
        if (connection != null) {
            try {
                connection.close();
                connection.dispose();
            } catch (Exception ignored) {
            }
        }
    }

    private void emit(String state) {
        if (listener != null) listener.onState(state);
    }

    private void fail(Exception err) {
        Log.e(TAG, "rtc error", err);
        if (listener != null) listener.onError(err.getMessage() == null ? err.toString() : err.getMessage());
    }

    private abstract static class SdpAdapter implements SdpObserver {
        @Override
        public void onCreateSuccess(SessionDescription sdp) {
        }

        @Override
        public void onSetSuccess() {
        }

        @Override
        public void onCreateFailure(String error) {
        }

        @Override
        public void onSetFailure(String error) {
        }
    }
}

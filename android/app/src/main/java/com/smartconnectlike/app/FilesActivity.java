package com.smartconnectlike.app;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.google.android.material.button.MaterialButton;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class FilesActivity extends AppCompatActivity {
    private final OkHttpClient http = new OkHttpClient();
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final List<FileItem> files = new ArrayList<>();

    private ListView listView;
    private ProgressBar loading;
    private TextView empty;
    private FileAdapter adapter;
    private String baseUrl;

    private static class FileItem {
        String name;
        String url;
        long size;
        String mime = "application/octet-stream";
        FileSaver.Saved saved;
        boolean failed;
        int progress = -1;
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_files);

        listView = findViewById(R.id.filesList);
        loading = findViewById(R.id.filesLoading);
        empty = findViewById(R.id.filesEmpty);
        adapter = new FileAdapter();
        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> {
            FileItem file = files.get(position);
            if (file.progress >= 0 && file.progress < 100) return;
            if (file.saved != null) {
                Installer.open(this, file.saved);
            } else {
                download(file);
            }
        });

        findViewById(R.id.btnCloseFiles).setOnClickListener(v -> finish());

        Device device = Core.get(this).connected;
        if (device == null) {
            empty.setText("Connect to your PC first.");
            loading.setVisibility(View.GONE);
            return;
        }
        baseUrl = "http://" + device.ip + ":" + device.http;
        load();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (adapter != null) adapter.notifyDataSetChanged();
    }

    private void load() {
        loading.setVisibility(View.VISIBLE);
        empty.setVisibility(View.GONE);
        io.execute(() -> {
            try {
                Request request = new Request.Builder().url(baseUrl + "/api/files").build();
                try (Response response = http.newCall(request).execute()) {
                    String body = response.body() == null ? "" : response.body().string();
                    JSONObject json = new JSONObject(body);
                    JSONArray array = json.optJSONArray("files");
                    List<FileItem> parsed = new ArrayList<>();
                    if (array != null) {
                        for (int i = 0; i < array.length(); i++) {
                            JSONObject item = array.getJSONObject(i);
                            FileItem file = new FileItem();
                            file.name = item.optString("name", "file");
                            file.size = item.optLong("size", 0);
                            file.mime = FileSaver.mimeOf(file.name);
                            file.url = baseUrl + item.optString("url", "");
                            parsed.add(file);
                        }
                    }
                    runOnUiThread(() -> {
                        files.clear();
                        files.addAll(parsed);
                        adapter.notifyDataSetChanged();
                        loading.setVisibility(View.GONE);
                        empty.setVisibility(files.isEmpty() ? View.VISIBLE : View.GONE);
                        if (files.isEmpty()) empty.setText("Nothing shared yet. Add files on the PC.");
                    });
                }
            } catch (Exception err) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    empty.setVisibility(View.VISIBLE);
                    empty.setText("Could not reach the PC: " + err.getMessage());
                });
            }
        });
    }

    private void download(FileItem file) {
        if (file.progress >= 0 && file.progress < 100) return;
        file.progress = 0;
        file.failed = false;
        adapter.notifyDataSetChanged();
        io.execute(() -> {
            try {
                Request request = new Request.Builder().url(file.url).build();
                try (Response response = http.newCall(request).execute()) {
                    if (!response.isSuccessful() || response.body() == null) {
                        throw new IllegalStateException("HTTP " + response.code());
                    }
                    long total = response.body().contentLength();
                    if (total <= 0) total = file.size;
                    try (InputStream input = response.body().byteStream()) {
                        FileSaver.Saved saved = FileSaver.save(this, file.name, input, total, (bytes, size) -> {
                            int pct = size > 0 ? (int) (bytes * 100 / size) : 0;
                            if (pct != file.progress) {
                                file.progress = pct;
                                runOnUiThread(() -> adapter.notifyDataSetChanged());
                            }
                        });
                        file.saved = saved;
                        file.mime = saved.mime;
                        file.progress = 100;
                        runOnUiThread(() -> {
                            adapter.notifyDataSetChanged();
                            if (saved.isApk()) {
                                Toast.makeText(this, "APK saved to " + saved.label, Toast.LENGTH_SHORT).show();
                                Installer.install(this, saved);
                            } else {
                                Toast.makeText(this, "Saved to " + saved.label, Toast.LENGTH_LONG).show();
                                Installer.open(this, saved);
                            }
                        });
                    }
                }
            } catch (Exception err) {
                file.progress = -1;
                file.failed = true;
                runOnUiThread(() -> {
                    adapter.notifyDataSetChanged();
                    Toast.makeText(this, "Download failed: " + err.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private static String iconFor(String name) {
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot >= 0 && dot < name.length() - 1) ext = name.substring(dot + 1).toLowerCase(Locale.US);
        switch (ext) {
            case "apk":
                return "📦";
            case "pdf":
                return "📕";
            case "zip":
            case "rar":
            case "7z":
            case "tar":
            case "gz":
                return "🗜";
            case "mp4":
            case "mkv":
            case "webm":
            case "avi":
            case "mov":
            case "3gp":
                return "🎬";
            case "mp3":
            case "m4a":
            case "wav":
            case "ogg":
            case "flac":
                return "🎵";
            case "png":
            case "jpg":
            case "jpeg":
            case "gif":
            case "webp":
            case "bmp":
                return "🖼";
            case "doc":
            case "docx":
            case "txt":
            case "md":
            case "log":
                return "📝";
            case "xls":
            case "xlsx":
            case "csv":
                return "📊";
            default:
                return "📄";
        }
    }

    private static String typeLabel(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        return name.substring(dot + 1).toUpperCase(Locale.US);
    }

    private class FileAdapter extends BaseAdapter {
        @Override
        public int getCount() {
            return files.size();
        }

        @Override
        public Object getItem(int position) {
            return files.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View view = convertView;
            if (view == null) {
                view = LayoutInflater.from(FilesActivity.this).inflate(R.layout.row_file, parent, false);
            }
            FileItem file = files.get(position);
            TextView icon = view.findViewById(R.id.fileIcon);
            TextView name = view.findViewById(R.id.fileName);
            TextView size = view.findViewById(R.id.fileSize);
            MaterialButton get = view.findViewById(R.id.fileGet);

            icon.setText(iconFor(file.name));
            name.setText(file.name);
            String type = typeLabel(file.name);
            String meta = FileSaver.humanSize(file.size);
            size.setText(type.isEmpty() ? meta : type + " · " + meta);

            boolean busy = file.progress >= 0 && file.progress < 100;
            if (busy) {
                get.setText(file.progress + "%");
                get.setEnabled(false);
            } else if (file.saved != null) {
                if (file.saved.isApk()) {
                    get.setText(Installer.canInstall(FilesActivity.this) ? "Install" : "Allow");
                } else {
                    get.setText("Open");
                }
                get.setEnabled(true);
            } else {
                get.setText(file.failed ? "Retry" : "Get");
                get.setEnabled(true);
            }

            get.setOnClickListener(v -> {
                if (file.saved != null) {
                    Installer.open(FilesActivity.this, file.saved);
                } else {
                    download(file);
                }
            });
            return view;
        }
    }
}

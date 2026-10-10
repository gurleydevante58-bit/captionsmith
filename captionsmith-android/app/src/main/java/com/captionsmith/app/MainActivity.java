package com.captionsmith.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Captionsmith: the caption editor runs in a WebView from files bundled inside the app
 * (served at https://appassets.androidplatform.net so the browser features it needs work).
 * Native parts: the file picker, saving exports to the phone, and keeping the screen on.
 */
public class MainActivity extends Activity {
    private static final String START = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int PICK_FILE = 42;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true; // open outside links in the phone's browser
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                boolean wantsVideo = false;
                for (String t : params.getAcceptTypes()) if (t != null && t.startsWith("video")) wantsVideo = true;
                pick.setType(wantsVideo ? "video/*" : "*/*");
                try {
                    startActivityForResult(Intent.createChooser(pick, wantsVideo ? "Choose a video" : "Choose a file"), PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "CaptionsmithAndroid");

        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(START);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // let the page autosave before Android may stop the app
        web.evaluateJavascript("try{saveNow()}catch(e){}", null);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /** Called from the web app as window.CaptionsmithAndroid */
    private class Bridge {
        private final Map<String, OutputStream> outs = new HashMap<>();
        private final Map<String, Uri> uris = new HashMap<>();
        private final Map<String, String> names = new HashMap<>();

        /** Start a file in Movies/Captionsmith (videos) or Download/Captionsmith (everything else). */
        @JavascriptInterface
        public String begin(String name, String mime) {
            try {
                boolean video = mime != null && mime.startsWith("video/");
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_DOWNLOADS) + "/Captionsmith");
                v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                Uri collection = video
                        ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
                ContentResolver r = getContentResolver();
                Uri uri = r.insert(collection, v);
                if (uri == null) return "";
                String id = UUID.randomUUID().toString();
                outs.put(id, r.openOutputStream(uri));
                uris.put(id, uri);
                names.put(id, (video ? "Movies" : "Download") + "/Captionsmith/" + name);
                return id;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void append(String id, String base64) throws Exception {
            OutputStream o = outs.get(id);
            if (o == null) throw new IllegalStateException("file not open");
            o.write(Base64.decode(base64, Base64.DEFAULT));
        }

        @JavascriptInterface
        public String finish(String id) throws Exception {
            OutputStream o = outs.remove(id);
            if (o != null) o.close();
            Uri uri = uris.remove(id);
            if (uri != null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(uri, v, null, null);
            }
            String n = names.remove(id);
            return n == null ? "your phone" : n;
        }

        @JavascriptInterface
        public void abort(String id) {
            try { OutputStream o = outs.remove(id); if (o != null) o.close(); } catch (Exception ignored) { }
            Uri uri = uris.remove(id);
            if (uri != null) try { getContentResolver().delete(uri, null, null); } catch (Exception ignored) { }
            names.remove(id);
        }

        /** Keep the screen on while exporting (the phone pauses hidden apps). */
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}

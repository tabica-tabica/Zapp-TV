package com.tabica.zapptv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Zapp TV no Android TV: uma WebView em tela cheia rodando o bundle de TV
 * (assets/www, gerado por scripts/build-android.mjs). Mesmo modelo dos apps
 * da LG e da Samsung: o app é a página, carregada de arquivo local.
 */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // TV não pode dormir no meio de um filme (sem toque na tela, o sistema
        // acha que ninguém está usando)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        // localStorage/IndexedDB: login, listas, progresso, cache de logos
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // Prévia ao vivo toca sozinha (sem gesto: na TV não existe toque)
        s.setMediaPlaybackRequiresUserGesture(false);
        // Página vem de file:// e conversa com o painel (http, outra origem).
        // Sem isto o fetch/XHR esbarra no CORS do painel — o mesmo "Load
        // failed" que o app desktop teve. Os apps de TV (Tizen/webOS) também
        // rodam de arquivo local sem essa trava.
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        // O layout de TV é desenhado pra 1920px de largura: o index.html pede
        // width=1920 e a WebView reduz pra caber na tela (1080p em densidade
        // 2x daria só 960px de CSS)
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);

        web.setBackgroundColor(0xFF05070D);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Ponte(), "ZappAndroid");
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        setContentView(web);
        web.requestFocus();
        web.loadUrl("file:///android_asset/www/index.html");
    }

    /**
     * Voltar do controle: a Activity recebe antes da página (a WebView não o
     * entrega pro JavaScript). Vira o keydown que o app já entende como
     * Voltar (XF86Back/10009, o mesmo do Tizen) — e é o app que decide sair
     * (ZappAndroid.sair) quando está na Home.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && web != null) {
                web.evaluateJavascript(
                        "window.dispatchEvent(new KeyboardEvent('keydown',"
                                + "{key:'XF86Back',keyCode:10009,which:10009,bubbles:true}))",
                        null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** window.ZappAndroid — ver src/services/androidApp.ts */
    private class Ponte {
        @JavascriptInterface
        public void sair() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        /** Trailer do YouTube etc.: manda pro app do sistema. */
        @JavascriptInterface
        public boolean abrir(String url) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            }
        }
    }
}

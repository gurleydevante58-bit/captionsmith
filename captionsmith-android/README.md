# Captionsmith (Android)

Video caption editor: generate or type captions, edit timing, style and animate them,
then export a burned-in video or SRT. Android 10 or newer.

## Get the APK without a computer (GitHub builds it for you)
1. Put this project in a GitHub repository (the files at the top level: `app/`, `gradle/`, `.github/`, …).
2. GitHub runs **Actions → Build APK** automatically (about 5 minutes).
3. Open the repository's **Releases** page on your phone and download `Captionsmith.apk`.
4. Open it and allow "Install unknown apps" for your browser/Files app when Android asks.

New builds are signed with the same key (`app/captionsmith.keystore`), so they install over the
old version and keep your projects. That key's password is in `app/build.gradle`, so it's fine for
personal use but make a private key before publishing to the Play Store.

## Build on a computer instead
Open the folder in Android Studio and press Run, or run `./gradlew assembleRelease`.
The APK appears in `app/build/outputs/apk/release/`.

## What's inside
- `app/src/main/assets/www/index.html` – the whole editor (runs in a WebView, offline).
- `MainActivity.java` – the Android shell: file picker, saving exports to
  `Movies/Captionsmith` (videos) and `Download/Captionsmith` (subtitles), keeping the screen on.

## Internet use
Only for: caption fonts (Google Fonts, first use), the on-device Whisper model download
(Hugging Face, first use), and OpenAI transcription if you choose it with your own API key.
Videos and projects stay on the phone.

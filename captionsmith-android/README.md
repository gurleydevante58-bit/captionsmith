# Cutline (Android)

A phone video editor for Shorts, with an auto-caption screen built in. Android 10 or newer.

**Edit screen** (opens first)
- Tracks: video (magnetic, with transitions between clips), overlays (pictures, cut-outs, clips), text, effects and audio.
- Transitions: flash, zoom punch, dissolve, dip to black, whip pan, push in four directions, slide over, zoom out, spin, glitch, blur, wipe, iris. Each option previews live.
- Effects track (VFX): shake, handheld, zoom punch, beat pulse, zoom blur, flash, strobe, light leak, sparkles, RGB split, glitch, VHS, film grain, vignette, cinema bars, blur, black & white, retro warm, vivid, invert, speed lines, mirror.
- Per clip: Ken Burns zoom/pan, intro animation, speed, volume, filters, brightness/contrast/saturation, motion blur, sharpen, fill or fit with a blurred background.
- Text: word-by-word highlight, pop-each-word and typewriter modes, seven style presets.
- Audio: 12 built-in sound effects (generated in the app, no downloads), music from the phone with log fades.
- Beats: finds the tempo of your music, marks beats on the ruler, snaps edits to them, and can move every cut onto the beat.
- **Fact Short** template: applies the FactBites-style pacing (flash + bass hit on the reveal, zoom-blur punches with whooshes, slow zooms on stills, pop-in overlays, yellow highlight captions).
- **1-Click Automate**: cuts silences out of clips, adds whooshes and slide-ins to text, balances music under voice, and optionally snaps cuts to beats.
- Export records the timeline to MP4 (or WebM on phones without an MP4 recorder) and saves it to `Movies/Cutline`. **Add captions** sends the export straight to the Captions screen.

**Captions screen**: generate or type captions, edit timing, style and animate them, then export a burned-in video or SRT.

## Get the APK without a computer (GitHub builds it for you)
1. Push to this repository. GitHub runs **Actions → Build APK** automatically (about 2 minutes).
2. Open the repository's **Releases** page on your phone and download `Cutline.apk`.
3. Open it and allow "Install unknown apps" for your browser/Files app when Android asks.

New builds are signed with the same key (`app/captionsmith.keystore`) and keep the same app ID, so they install over the
old Captionsmith app and keep your caption projects. That key's password is in `app/build.gradle`, so it's fine for
personal use but make a private key before publishing to the Play Store.

## Build on a computer instead
Open the folder in Android Studio and press Run, or run `./gradlew assembleRelease`.
The APK appears in `app/build/outputs/apk/release/`.

## What's inside
- `app/src/main/assets/www/editor.html` – the Edit screen (runs in a WebView, offline).
- `app/src/main/assets/www/index.html` – the Captions screen.
- `app/src/main/assets/www/recfix.js` – shared code that rewrites recorded videos with their true length.
- `MainActivity.java` – the Android shell: file picker (several files at once), saving exports to
  `Movies/Cutline` (videos) and `Download/Cutline` (subtitles), keeping the screen on, Back between screens.

## Internet use
Only for: fonts (Google Fonts, first use), the on-device Whisper model download (Hugging Face, first use),
and OpenAI transcription if you choose it with your own API key. Videos and projects stay on the phone.

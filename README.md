# Voice Ideas for Amazfit Bip 6

A Zepp OS 5 / API_LEVEL 4.2 mini app that records a voice idea on the watch, saves the file locally, then asks the phone Side Service to send it to a server via HTTP POST.

## Typical Zepp OS structure

A Zepp OS Mini Program project usually contains:

- `app.json`: app manifest, target API, pages, Side Service, permissions.
- `page/`: code executed on the watch. The Bip 6 target detected by the local CLI is `pamir`, screen `390x450`, max API `4.2`.
- `data-widget/`: shortcut widget shown in tiles/widgets that opens the main page.
- `app-side/`: Side Service executed on the phone through the Zepp app.
- `setting/`: settings screen shown on the phone in the Zepp app.
- `shared/` or small adapters: messaging code or shared contracts.
- `package.json`: local scripts around the Zepp `zeus` CLI.

This scaffold follows that structure. Network calls are only made in `app-side/`, because the watch should not be assumed to call the Internet directly.

## Linux commands

Install the Zepp OS CLI:

```bash
npm install -g @zeppos/zeus-cli
```

Install local project dependencies:

```bash
npm install
```

Check that the CLI is available:

```bash
zeus --version
```

Build the project:

```bash
npm run build
```

Start development mode:

```bash
npm run dev
```

Generate a preview/test QR if your CLI version supports it:

```bash
npm run preview
```

## Server configuration

Edit `app-side/config.js`:

```js
export const SERVER_UPLOAD_URL = 'https://your-server.example/api/voice-ideas'
```

These values can also be changed from the Zepp app on the phone, in the `Voice Ideas` app settings:

- `Server upload URL`
- `Debug URL`
- `Recipient email`

The Side Service uses phone settings if they exist; otherwise it falls back to defaults in `app-side/config.js`.
`Recipient email` is sent to the server with each recording in the `recipientEmail` field, allowing the same server endpoint to serve multiple watches.

The server must accept `multipart/form-data` with:

- `audio`: OPUS audio file.
- `createdAt`: creation timestamp.
- `recipientEmail`: optional recipient email address.

In JSON/base64 mode, the server also receives `recipientEmail` with `audioBase64`.

A defensive Express example is provided in `server-example/`. It returns `400 MISSING_AUDIO` instead of crashing with `500` when no file is received.

### Server-side transcription and email

The example server can now automatically process each received idea:

1. save the raw Zepp file;
2. convert the Zepp Opus stream into a real `.ogg` file;
3. convert `.ogg` to 16 kHz mono WAV with `ffmpeg`;
4. run local transcription with `whisper.cpp`;
5. save a `.txt` file;
6. send the transcription by email with the `.ogg` as an attachment.

Install server dependencies:

```bash
cd server-example
npm install
```

Install `ffmpeg` and `whisper.cpp`:

```bash
sudo dnf install -y ffmpeg
```

Install whisper.cpp and the GGML small or medium model (around 1.5 GB):

Go to https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.1 and download the Linux `whisper-cli` binary.

You also need to download a GGML model, for example `ggml-small.bin` or `ggml-medium.bin`. The `download-ggml-model.sh` script included in the project can do this automatically.

```bash
sudo bash ./models/download-ggml-model.sh small
```

Minimum environment variables:

```bash
export FFMPEG_BIN="ffmpeg"
export WHISPER_CPP_BIN="/opt/whisper.cpp/build/bin/whisper-cli"
export WHISPER_CPP_MODEL="/opt/whisper.cpp/models/ggml-small.bin"
export WHISPER_CPP_LANGUAGE="en"
export WHISPER_CPP_TIMEOUT_MS="120000"
export VOICE_IDEAS_KEEP_FILES="false"

export SMTP_HOST="smtp.example.com"
export SMTP_PORT="587"
export SMTP_SECURE="false"
export SMTP_USER="user@example.com"
export SMTP_PASS="password"
export SMTP_FROM="Voice Ideas <user@example.com>"
export MAIL_TO="you@example.com"

export VOICE_IDEAS_UPLOAD_DIR="/var/vhosts/nodejs/voice-ideas-server/sounds"
```

Start the server:

```bash
npm start
```

The server replies quickly to the watch with `processing: true`, then performs conversion, transcription, and email sending in the background. Transcription or SMTP errors appear in server logs without blocking the watch.
After a successful email send, the server removes the raw `.opus`, `.ogg`, intermediate `.wav`, and `.txt` files. To keep them for debugging, use `VOICE_IDEAS_KEEP_FILES=true`.

To test local transcription manually:

```bash
ffmpeg -y -i sounds/2026-07-03_22-19-51-idea.ogg -ar 16000 -ac 1 -c:a pcm_s16le /tmp/idea.wav
/opt/whisper.cpp/build/bin/whisper-cli -m /opt/whisper.cpp/models/ggml-small.bin -f /tmp/idea.wav -l en -otxt -of /tmp/idea
cat /tmp/idea.txt
```

## API points to verify in your SDK

The exact names below depend on the installed Zepp OS Mini Program SDK version:

- `@zos/media`: this scaffold uses the official API `create(id.RECORDER)`, `setFormat(codec.OPUS, { target_file })`, `start()`, and `stop()`.
- Side Service bridge: this project uses `MessageBuilder` and chunked JSON/base64 uploads from the watch, because `TransferFile` did not reliably trigger `onReceivedFile` on the tested Bip 6.
- HTTP upload: the phone Side Service reconstructs the audio and posts JSON containing `audioBase64` to the server.
- Widget: `data-widget/voice-ideas/index.js` is only a shortcut to `page/index` via `@zos/router`. It does not start the microphone directly.

If a name differs, the closest official alternatives are:

- Audio recording: official `@zos/media` module.
- Network upload: app-side Side Service + Zepp-documented app-side `fetch`/HTTP API.
- Watch/phone bridge: `BasePage#request`/`BaseSideService`, or the official app-side service API documented for your SDK version.

## Local validation performed

Validation command used:

```bash
zeus --version
```

Observed version:

```text
zeus: v1.9.1
zpm: v3.4.1
```

Successful build:

```bash
npm run build
```

The generated package is in `dist/`.

Manifest note: the CLI local cache identifies Bip 6 with internal name `pamir`, screen `390x450`, max API `4.2`. The manifest keeps the packager v3 format accepted by `zeus` (`st: "s"`, `dw: 390`); directly adding Bip 6 `deviceSource` entries to `platforms` breaks icon packaging with `zeus v1.9.1`.

## Watch testing with Zepp Developer Mode

1. Open the Zepp app on the phone paired with the Amazfit Bip 6.
2. Enable Developer Mode in Zepp developer options.
3. Keep the watch connected to the phone over Bluetooth.
4. From this folder, run:

```bash
npm run build
zeus preview -s
```

5. Scan the QR code or select the target watch depending on what `zeus` shows.
6. Open `Voice Ideas` on the watch.
7. Tap `Record`.
8. Tap `Stop`.
9. Check `zeus` logs for:
   - local file creation;
   - Side Service call;
   - server HTTP response.

## Implemented flow

1. `page/index.js` shows the button and manages UI state.
2. `page/recorder.js` starts and stops recording via `@zos/media`.
3. `data-widget/voice-ideas/index.js` shows a shortcut that opens the main page.
4. The file is created in the mini app local sandbox.
5. `page/side-service.js` reads the file and sends it to the phone Side Service in chunks.
6. `app-side/index.js` reconstructs the audio and posts it to `SERVER_UPLOAD_URL`.


## Screenshots

![Screenshot 1](screenshots/IMG_3401.PNG)
![Screenshot 2](screenshots/IMG_3396.PNG)
![Screenshot 3](screenshots/IMG_3397.PNG)
![Screenshot 4](screenshots/IMG_3398.PNG)
![Screenshot 5](screenshots/IMG_3399.PNG)
![Screenshot 6](screenshots/IMG_3400.PNG)

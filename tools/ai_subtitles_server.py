#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local AI subtitle bridge for the K-line player.

Run it with any Python that has faster-whisper installed:

  <venv>/Scripts/python.exe tools/ai_subtitles_server.py --model-dir <whisper-model-dir>

The browser posts raw audio bytes to http://127.0.0.1:8765/transcribe and gets
JSON segments back.  It is intentionally a local-only helper: no uploads, no
telemetry, no file retention.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import traceback
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import numpy as np

DEFAULT_MODEL_DIR = Path(os.environ.get("KLP_WHISPER_MODEL", "")) if os.environ.get("KLP_WHISPER_MODEL") else None

MODEL = None
ARGS = None


def ffmpeg_path():
    if ARGS.ffmpeg:
        return ARGS.ffmpeg
    if os.environ.get("KLP_FFMPEG"):
        return os.environ["KLP_FFMPEG"]
    local = Path(__file__).resolve().parent.parent / "ffbin" / "ffmpeg.exe"
    if local.exists():
        return str(local)
    return "ffmpeg"


def decode_16k(path):
    """Decode any ffmpeg-readable audio to 16 kHz mono float32.

    This avoids the faster-whisper / PyAV version mismatch in the existing
    project venv (av 19 no longer accepts metadata_errors=).
    """
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    out.close()
    try:
        subprocess.run(
            [ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y",
             "-i", path, "-ar", "16000", "-ac", "1", out.name],
            check=True,
        )
        with wave.open(out.name, "rb") as w:
            sr = w.getframerate()
            sw = w.getsampwidth()
            ch = w.getnchannels()
            raw = w.readframes(w.getnframes())
        if sw != 2:
            raise RuntimeError("unexpected ffmpeg sample width: %s" % sw)
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if ch > 1:
            audio = audio.reshape(-1, ch).mean(axis=1)
        return audio, sr
    finally:
        try:
            os.unlink(out.name)
        except OSError:
            pass


def load_model():
    global MODEL
    from faster_whisper import WhisperModel

    model_dir = Path(ARGS.model_dir).expanduser() if ARGS.model_dir else DEFAULT_MODEL_DIR
    if not model_dir.exists():
        raise SystemExit(
            "Whisper model cache not found: %s\n"
            "Pass --model-dir or download Systran/faster-whisper-base first." % model_dir
        )
    print("[ai-subtitles] loading %s from %s ..." % (ARGS.model, model_dir), flush=True)
    MODEL = WhisperModel(
        ARGS.model,
        device=ARGS.device,
        compute_type=ARGS.compute_type,
        download_root=str(model_dir),
    )
    print("[ai-subtitles] model ready", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "KLineSubtitleBridge/1.0"

    def log_message(self, fmt, *args):
        print("[ai-subtitles] " + (fmt % args), flush=True)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._json(200, {
                "ok": True,
                "service": "kline-ai-subtitles",
                "model": ARGS.model,
                "language": ARGS.language or "auto",
            })
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/transcribe":
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                self._json(400, {"ok": False, "error": "empty body"})
                return
            if length > ARGS.max_bytes:
                self._json(413, {"ok": False, "error": "audio too large"})
                return
            data = self.rfile.read(length)
            filename = self.headers.get("X-Filename", "audio.bin")
            suffix = Path(filename).suffix or ".bin"
            query = parse_qs(parsed.query)
            language = (query.get("language", [""])[0] or ARGS.language or None)
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
                f.write(data)
                tmp_path = f.name
            try:
                try:
                    audio, sample_rate = decode_16k(tmp_path)
                    # faster-whisper expects a numpy array already at 16 kHz.
                    segments, info = MODEL.transcribe(
                        audio,
                        language=language,
                        vad_filter=True,
                        beam_size=1,
                        word_timestamps=True,
                    )
                except Exception:
                    # Fall back to faster-whisper's own decoder when ffmpeg is unavailable.
                    traceback.print_exc()
                    segments, info = MODEL.transcribe(
                        tmp_path,
                        language=language,
                        vad_filter=True,
                        beam_size=1,
                        word_timestamps=True,
                    )
                def words_of(seg):
                    out = []
                    for w in (getattr(seg, "words", None) or []):
                        txt = (w.word or "").strip()
                        if not txt:
                            continue
                        out.append({
                            "start": round(float(w.start), 2),
                            "end": round(float(w.end), 2),
                            "word": txt,
                        })
                    return out

                out = [
                    {
                        "start": round(float(s.start), 2),
                        "end": round(float(s.end), 2),
                        "text": s.text.strip(),
                        "words": words_of(s),
                    }
                    for s in segments
                ]
                self._json(200, {
                    "ok": True,
                    "segments": out,
                    "language": getattr(info, "language", language),
                    "duration": round(float(getattr(info, "duration", 0) or 0), 2),
                    "model": ARGS.model,
                })
            finally:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        except Exception as exc:
            traceback.print_exc()
            self._json(500, {"ok": False, "error": str(exc)})


def main():
    global ARGS
    parser = argparse.ArgumentParser(description="Local faster-whisper subtitle bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="base")
    parser.add_argument("--model-dir", default=str(DEFAULT_MODEL_DIR) if DEFAULT_MODEL_DIR else None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default=None, help="e.g. zh, ja, en; empty = auto")
    parser.add_argument("--ffmpeg", default=None, help="path to ffmpeg.exe")
    parser.add_argument("--max-bytes", type=int, default=200 * 1024 * 1024)
    ARGS = parser.parse_args()
    load_model()
    server = ThreadingHTTPServer((ARGS.host, ARGS.port), Handler)
    print("[ai-subtitles] listening on http://%s:%d" % (ARGS.host, ARGS.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[ai-subtitles] bye", flush=True)


if __name__ == "__main__":
    main()

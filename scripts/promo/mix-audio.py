"""
Add the voiceover and music bed to the recorded demo video.

Run after `npm run promo:video`, which writes the silent video and the
scene cues (store/promo/video/apq-debugger-demo-cues.json):

    python scripts/promo/mix-audio.py --models <dir with kokoro-v1.0.onnx and voices-v1.0.bin>

Requirements (use a virtualenv): `pip install kokoro-onnx soundfile numpy`,
plus ffmpeg on PATH. Model files (Apache-2.0) come from the kokoro-onnx
"model-files-v1.0" GitHub release.

Narration: Kokoro TTS, one line per cue from scripts/promo/narration.json,
placed just after its caption appears and sped up slightly when a line
would run into the next scene. Music: an original bed synthesized here
(no samples), ducked under the voice. The mix is normalised to -16 LUFS
and muxed into the video in place, keeping the video stream untouched.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VIDEO_DIR = os.path.join(ROOT, "store", "promo", "video")
VIDEO = os.path.join(VIDEO_DIR, "apq-debugger-demo.mp4")
CUES = os.path.join(VIDEO_DIR, "apq-debugger-demo-cues.json")
NARRATION = os.path.join(os.path.dirname(__file__), "narration.json")

SR = 48000
LEAD_IN = 0.35  # seconds between a caption appearing and the voice starting
GAP = 0.45  # minimum silence before the next line
MAX_SPEED = 1.18


def video_duration(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]
    )
    return float(out.strip())


def resample(signal, src_rate, dst_rate):
    if src_rate == dst_rate:
        return signal
    n = int(round(len(signal) * dst_rate / src_rate))
    x_old = np.linspace(0.0, 1.0, len(signal), endpoint=False)
    x_new = np.linspace(0.0, 1.0, n, endpoint=False)
    return np.interp(x_new, x_old, signal).astype(np.float32)


def build_voice(models, cues, lines, voice, duration):
    from kokoro_onnx import Kokoro

    tts = Kokoro(
        os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin")
    )
    track = np.zeros(int(duration * SR) + SR, dtype=np.float32)
    report = []
    for i, (cue, line) in enumerate(zip(cues, lines)):
        start = cue["t"] + LEAD_IN
        end = cues[i + 1]["t"] if i + 1 < len(cues) else duration - 0.6
        room = max(end - start - GAP, 1.0)
        speed = 1.0
        samples, rate = tts.create(line, voice=voice, speed=speed, lang="en-us")
        length = len(samples) / rate
        if length > room:
            speed = min(MAX_SPEED, length / room * 1.02)
            samples, rate = tts.create(line, voice=voice, speed=speed, lang="en-us")
            length = len(samples) / rate
        clip = resample(np.asarray(samples, dtype=np.float32), rate, SR)
        at = int(start * SR)
        track[at : at + len(clip)] += clip[: len(track) - at]
        overrun = length - room
        report.append((i, start, length, room, speed, overrun))
    return track[: int(duration * SR)], report


def note_hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def envelope(n, attack, release, rate=SR):
    env = np.ones(n, dtype=np.float32)
    a = min(int(attack * rate), n)
    r = min(int(release * rate), n - a)
    if a:
        env[:a] = np.linspace(0, 1, a)
    if r:
        env[n - r :] *= np.linspace(1, 0, r)
    return env


def build_music(duration, seed=7):
    """An original, soft four-chord bed in D major (~76 bpm)."""
    rng = np.random.default_rng(seed)
    n_total = int(duration * SR) + SR
    left = np.zeros(n_total, dtype=np.float32)
    right = np.zeros(n_total, dtype=np.float32)

    beat = 60 / 76
    chord_len = beat * 8  # two bars per chord
    # Dmaj7, Bm7, Gmaj7, A6 (MIDI notes, mid register)
    chords = [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 66]]
    roots = [38, 35, 31, 33]

    t_chord = 0.0
    k = 0
    while t_chord < duration:
        idx = k % len(chords)
        n = int((chord_len + 1.5) * SR)  # overlap into the next chord
        t = np.arange(n, dtype=np.float32) / SR
        start = int(t_chord * SR)
        stop = min(start + n, n_total)
        span = stop - start

        # Pad: two slightly detuned sines per chord tone, slow swell.
        pad = np.zeros(n, dtype=np.float32)
        for note in chords[idx]:
            f = note_hz(note)
            for cents in (-4, 4):
                fd = f * 2 ** (cents / 1200)
                pad += np.sin(2 * np.pi * fd * t + rng.uniform(0, 6.28)).astype(np.float32)
        pad *= envelope(n, 1.4, 1.6) * 0.035

        # Bass: root, soft attack, a little second harmonic.
        fb = note_hz(roots[idx])
        bass = (np.sin(2 * np.pi * fb * t) + 0.25 * np.sin(4 * np.pi * fb * t)).astype(np.float32)
        bass *= envelope(n, 0.25, 1.4) * 0.07

        left[start:stop] += (pad + bass)[:span]
        right[start:stop] += (pad + bass)[:span]

        # Arpeggio: eighth-note plucks over the chord, an octave up, panned.
        step = beat / 2
        tones = chords[idx] + [chords[idx][1] + 12]
        for j in range(16):
            ts = t_chord + j * step
            if ts >= duration:
                break
            f = note_hz(tones[j % len(tones)] + 12)
            m = int(0.9 * SR)
            tt = np.arange(m, dtype=np.float32) / SR
            pluck = (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)).astype(
                np.float32
            )
            pluck *= np.exp(-tt * 5.5).astype(np.float32) * 0.022
            s = int(ts * SR)
            e = min(s + m, n_total)
            pan = 0.3 if j % 2 else 0.7
            left[s:e] += pluck[: e - s] * (1 - pan) * 1.4
            right[s:e] += pluck[: e - s] * pan * 1.4

        t_chord += chord_len
        k += 1

    # Gentle low-pass (soft roll-off above ~3 kHz) and a stereo echo for space.
    def smooth(x, cutoff=3000.0):
        spectrum = np.fft.rfft(x)
        freqs = np.fft.rfftfreq(len(x), 1 / SR)
        spectrum *= 1 / (1 + (freqs / cutoff) ** 4)
        return np.fft.irfft(spectrum, n=len(x)).astype(np.float32)

    left, right = smooth(left), smooth(right)
    d = int(0.33 * SR)
    left[d:] += 0.28 * right[:-d]
    right[d:] += 0.28 * left[:-d]

    n = int(duration * SR)
    fade = envelope(n, 2.0, 3.5)
    stereo = np.stack([left[:n] * fade, right[:n] * fade], axis=1)
    stereo /= max(np.abs(stereo).max(), 1e-6)
    return (stereo * 0.5).astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--models", required=True, help="dir with kokoro-v1.0.onnx and voices-v1.0.bin")
    parser.add_argument("--keep", help="also write the intermediate WAVs to this dir")
    args = parser.parse_args()

    with open(CUES, encoding="utf-8") as fh:
        cues = json.load(fh)
    with open(NARRATION, encoding="utf-8") as fh:
        narration = json.load(fh)
    lines = narration["lines"]
    if len(lines) != len(cues):
        sys.exit(f"narration.json has {len(lines)} lines but there are {len(cues)} cues")

    duration = video_duration(VIDEO)
    voice, report = build_voice(args.models, cues, lines, narration["voice"], duration)
    for i, start, length, room, speed, overrun in report:
        flag = f"  OVERRUN {overrun:+.2f}s" if overrun > 0.05 else ""
        print(f"line {i + 1:2d} @ {start:6.2f}s  {length:5.2f}s / {room:5.2f}s  speed {speed:.2f}{flag}")
    music = build_music(duration)

    work = args.keep or tempfile.mkdtemp(prefix="apq-demo-audio-")
    os.makedirs(work, exist_ok=True)
    voice_wav = os.path.join(work, "voice.wav")
    music_wav = os.path.join(work, "music.wav")
    sf.write(voice_wav, voice, SR)
    sf.write(music_wav, music, SR)

    silent = os.path.join(work, "silent.mp4")
    subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", VIDEO, "-an", "-c:v", "copy", silent])

    graph = (
        "[1:a]aformat=channel_layouts=stereo,volume=1.0,asplit=2[v1][vkey];"
        "[2:a]volume=0.14[m];"
        "[m][vkey]sidechaincompress=threshold=0.015:ratio=10:attack=25:release=450:makeup=1[mduck];"
        "[v1][mduck]amix=inputs=2:duration=first:normalize=0,"
        "loudnorm=I=-16:TP=-1.5:LRA=11[a]"
    )
    subprocess.check_call(
        [
            "ffmpeg", "-v", "error", "-y",
            "-i", silent, "-i", voice_wav, "-i", music_wav,
            "-filter_complex", graph,
            "-map", "0:v", "-map", "[a]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart", "-shortest",
            VIDEO,
        ]
    )
    print(f"Mixed audio -> {os.path.relpath(VIDEO, ROOT)}")


if __name__ == "__main__":
    main()

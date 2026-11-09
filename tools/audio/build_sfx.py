# Game-ready sound effects cut from the user's source files (assets/audio/source, see PROVENANCE.json).
#   python3 tools/audio/build_sfx.py <out dir>      (needs ffmpeg + numpy)
# Blaster.mp3 is a library of ~166 separate shots: each sound is found from its loudness envelope (80 ms of quiet ends
# a sound), scored for a blaster "pew" (fast attack, short body, falling pitch sweep, little tail) and the picks below
# were chosen from the top candidates' spectrograms. Each gun gets its own family of shots:
#   Empire carbine  S_Blaster_Fire_01..03   shot #107 (t=190.07 s): bright crack, steep sweep down from ~3.5 kHz
#   Alliance rifle  S_AllyRifle_Fire_01..03 shots #73/#74 (t=125.84/126.84 s): deeper (~0.6-0.8 kHz), heavier body
# Lightsaber: S_Saber_On (ignition), S_Saber_Off (ignition reversed and shortened = retract), S_Saber_Hum (seamless
# 4 s loop from the steadiest stretch of the hum recording), S_Saber_Swing_01..03, S_Saber_Clash (blocks, deflections).
import numpy as np, subprocess, wave, sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(HERE, '..', '..', 'assets', 'audio', 'source')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'assets', 'audio', 'game')
SR = 48000; os.makedirs(OUT, exist_ok=True)
def load(name):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, name), '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768
def save(name, x, peak=0.89):
    x = x - np.mean(x[:64]) * 0                      # (no DC offset in these sources)
    x = x / max(1e-6, np.abs(x).max()) * peak
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    return dict(name=name, seconds=round(len(x) / SR, 3))
def fades(x, fin=0.002, fout=0.08):
    x = x.copy(); a = int(fin * SR); b = int(fout * SR)
    if a: x[:a] *= np.linspace(0, 1, a)
    if b: x[-b:] *= np.linspace(1, 0, b) ** 2
    return x
def trim_sound(x, start_s, max_s, gate_db=-40):
    """the sound starting near start_s: from its first sample above the gate to where it stays below it (capped)"""
    s = x[int(start_s * SR): int((start_s + max_s + 0.2) * SR)]
    env = np.convolve(np.abs(s), np.ones(240) / 240, 'same'); pk = env.max(); g = pk * 10 ** (gate_db / 20)
    on = np.nonzero(env > g)[0]; a = max(0, on[0] - 48); b = min(len(s), on[-1], int(max_s * SR) + a)
    return s[a:b]
def resample(x, ratio):   # pitch/speed variant (ratio > 1 = higher, shorter)
    n = int(len(x) / ratio); return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
made = []
# ---- blasters ----
lib = load('Blaster.mp3')
emp = fades(trim_sound(lib, 190.068, 0.55), fout=0.12)
made += [save('S_Blaster_Fire_01', emp), save('S_Blaster_Fire_02', fades(resample(emp, 1.045), fout=0.1)), save('S_Blaster_Fire_03', fades(resample(emp, 0.955), fout=0.12))]
a1 = fades(trim_sound(lib, 125.839, 0.6), fout=0.14); a2 = fades(trim_sound(lib, 126.837, 0.6), fout=0.14)
made += [save('S_AllyRifle_Fire_01', a1), save('S_AllyRifle_Fire_02', a2), save('S_AllyRifle_Fire_03', fades(resample(a1, 0.96), fout=0.14))]
# ---- lightsaber ----
ign = load('freesound_community-lightsaber-ignition-6816.mp3')
on = fades(trim_sound(ign, 0.0, 1.6, -50), fin=0.003, fout=0.25)
made.append(save('S_Saber_On', on, 0.8))
off = on[: int(0.75 * SR)][::-1].copy(); off = fades(resample(off, 1.15), fin=0.05, fout=0.06)   # retract: the ignition reversed, quicker
made.append(save('S_Saber_Off', off, 0.7))
hum = load('freesound_community-saber-hummingwav-14651.mp3')
# steadiest 4 s (least loudness variation), then a seamless loop: the last 0.4 s cross-fades into the start
L = 4 * SR; hop = SR // 10; best = None
env = np.sqrt(np.convolve(hum ** 2, np.ones(4800) / 4800, 'same'))
for a in range(SR, len(hum) - L - SR, hop):
    e = env[a: a + L]; v = np.std(20 * np.log10(e + 1e-6))
    if best is None or v < best[0]: best = (v, a)
a = best[1]; X = int(0.4 * SR); seg = hum[a: a + L + X].copy()
w_ = np.sin(np.linspace(0, np.pi / 2, X)) ** 2
loop = seg[:L].copy(); loop[:X] = seg[:X] * w_ + seg[L:L + X] * (1 - w_)
made.append(dict(save('S_Saber_Hum', loop, 0.6), loop=True, from_s=round(a / SR, 2), loudness_std_db=round(float(best[0]), 2)))
sw = load('freesound_community-swing3-94210.mp3')
s1 = fades(trim_sound(sw, 0.0, 1.1, -34), fin=0.004, fout=0.2)
made += [save('S_Saber_Swing_01', s1, 0.8), save('S_Saber_Swing_02', fades(resample(s1, 1.12), fout=0.15), 0.8), save('S_Saber_Swing_03', fades(resample(s1, 0.92), fout=0.2), 0.8)]
made.append(save('S_Saber_Swing', s1, 0.8))      # name the web preview and older code use
cl = load('freesound_community-lightsaber-clash-88733.mp3')
made += [save('S_Saber_Clash', fades(trim_sound(cl, 0.0, 1.0, -40), fout=0.25), 0.9), save('S_Saber_Clash_Short', fades(trim_sound(cl, 0.0, 0.45, -40), fout=0.12), 0.9)]
json.dump({'source': 'assets/audio/source (PROVENANCE.json)', 'sample_rate': SR, 'sounds': made}, open(os.path.join(OUT, 'sfx.json'), 'w'), indent=1)
for m in made: print(m)

# Blaster sounds, physically modelled on how the classic film blaster sound was made: a hammer striking a
# taut steel guy-wire. Bending waves on a stiff wire are dispersive (speed ~ sqrt(frequency)), so the highs
# arrive first and the pitch sweeps down into the familiar "pew"; reflections from the wire ends come back
# more and more smeared, giving the ringing "pew-ew-ew" tail. No samples or recordings are used.
import numpy as np, wave, sys

SR = 48000

def dispersive_wire(D, dur, echoes=4, decay=0.42, lo=180.0, hi=9000.0, tilt=1.0, seed=0):
    """Impulse through a dispersive wire: group delay tau(f) = D*(2k+1)/sqrt(f) for the k-th pass."""
    n = int(SR * dur); n2 = 1 << int(np.ceil(np.log2(n * 2)))
    f = np.fft.rfftfreq(n2, 1 / SR); f[0] = 1.0
    rng = np.random.default_rng(seed)
    # hammer + wire spectrum: band-limited, gently tilted, with slight per-mode roughness
    band = (1 / (1 + (lo / f) ** 4)) * (1 / (1 + (f / hi) ** 4)) * (f / 1000.0) ** (-0.35 * tilt)
    band *= 1 + 0.25 * rng.standard_normal(f.size)
    out = np.zeros(n2)
    for k in range(echoes):
        m = 2 * k + 1                       # path length in wire lengths: strike point -> anchor -> back
        phase = 2 * np.pi * (2 * D * m * np.sqrt(f))   # integral of tau(f) df
        X = band * (decay ** k) * np.exp(-1j * phase) * np.exp(-f / (hi * (1.6 - 0.25 * k)))
        out += np.fft.irfft(X, n2)
    y = out[:n]
    return y / (np.abs(y).max() + 1e-9)

def envelope(n, attack=0.0015, release=0.12):
    t = np.arange(n) / SR
    return np.minimum(1, t / attack) * np.minimum(1, (t[-1] - t) / release + 0.0)

def blaster(path, D, seed, dur=0.55, body_hz=(2200, 260), bright=1.0):
    y = dispersive_wire(D, dur, seed=seed, tilt=1.0 / bright)
    n = len(y); t = np.arange(n) / SR
    # a faint tonal core that follows the same sweep (gives the shot its "laser" focus)
    f0, f1 = body_hz
    inst = f1 + (f0 - f1) * np.exp(-t / 0.045)
    core = np.sin(2 * np.pi * np.cumsum(inst) / SR) * np.exp(-t / 0.07) * 0.22
    x = y + core
    # tape-style saturation and a short slap from a nearby surface
    x = np.tanh(2.2 * x) / np.tanh(2.2)
    d = int(0.027 * SR); x[d:] += 0.18 * x[:-d]
    x *= envelope(n)
    x /= np.abs(x).max() * 1.06
    write(path, x)

def impact(path, seed):
    n = int(SR * 0.35); t = np.arange(n) / SR; rng = np.random.default_rng(seed)
    zap = dispersive_wire(0.55, 0.35, echoes=2, decay=0.3, lo=400, hi=7000, seed=seed) * 0.6
    sizzle = rng.standard_normal(n) * np.exp(-t / 0.06) * 0.5
    sizzle = np.convolve(sizzle, np.ones(6) / 6, 'same')
    thump = np.sin(2 * np.pi * (90 + 120 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.05) * 0.8
    x = np.tanh(1.8 * (zap + sizzle + thump)); x *= envelope(n, 0.0008, 0.08); x /= np.abs(x).max() * 1.06
    write(path, x)

def write(path, x):
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()); w.close()

def explosion(path, seed):
    n = int(SR * 2.2); t = np.arange(n) / SR; rng = np.random.default_rng(seed)
    noise = rng.standard_normal(n)
    # low-passed noise body (cumulative smoothing) for the boom, brighter crack on top
    boom = np.convolve(noise, np.ones(220) / 220, 'same') * 9.0 * np.exp(-t / 0.55)
    crack = noise * np.exp(-t / 0.035) * 0.9
    thump = np.sin(2 * np.pi * (38 + 70 * np.exp(-t / 0.06)) * t) * np.exp(-t / 0.35) * 1.2
    debris = np.zeros(n)
    for _ in range(40):   # falling debris ticks
        k = int(SR * rng.uniform(0.25, 1.9)); L = int(SR * 0.012)
        if k + L < n: debris[k:k + L] += rng.standard_normal(L) * np.exp(-np.arange(L) / (SR * 0.003)) * rng.uniform(0.05, 0.25)
    x = np.tanh(1.6 * (boom + crack + thump + debris)); x *= envelope(n, 0.0005, 0.4); x /= np.abs(x).max() * 1.05
    write(path, x)

def saber_hum(path):
    """Loopable hum: low motor fundamental with harmonics and a slight electrical buzz (no recordings)."""
    dur = 2.0; n = int(SR * dur); t = np.arange(n) / SR
    f0 = 90.0   # integer cycles in 2 s -> seamless loop
    x = (np.sin(2*np.pi*f0*t) + 0.5*np.sin(2*np.pi*2*f0*t+0.3) + 0.25*np.sin(2*np.pi*3*f0*t+1.1) + 0.12*np.sin(2*np.pi*4*f0*t))
    buzz = np.sign(np.sin(2*np.pi*f0*t)) * 0.08 * (1 + 0.3*np.sin(2*np.pi*3*t))
    x = (x + buzz) * (1 + 0.06*np.sin(2*np.pi*1.5*t)); x /= np.abs(x).max() * 1.6
    write(path, x)

def saber_swing(path, seed):
    n = int(SR * 0.55); t = np.arange(n) / SR; u = t / t[-1]
    amp = np.sin(np.pi * u) ** 1.5
    f = 90 * (1 + 0.55 * np.sin(np.pi * u))          # doppler-like rise and fall
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + 0.6*np.sin(2*ph+0.4) + 0.3*np.sin(3*ph)) * amp
    rng = np.random.default_rng(seed); x += rng.standard_normal(n) * 0.05 * amp
    x /= np.abs(x).max() * 1.1; write(path, x)

def saber_hit(path, seed):
    n = int(SR * 0.45); t = np.arange(n) / SR; rng = np.random.default_rng(seed)
    crackle = rng.standard_normal(n) * (rng.random(n) < 0.08) * np.exp(-t / 0.15) * 1.5
    sizzle = np.convolve(rng.standard_normal(n), np.ones(4) / 4, 'same') * np.exp(-t / 0.12)
    tone = np.sin(2 * np.pi * (180 + 600 * np.exp(-t / 0.03)) * t) * np.exp(-t / 0.08) * 0.8
    x = np.tanh(2.0 * (crackle + sizzle + tone)); x *= envelope(n, 0.0005, 0.1); x /= np.abs(x).max() * 1.05
    write(path, x)

if __name__ == '__main__':
    o = sys.argv[1]
    blaster(f'{o}/S_Blaster_Fire_01.wav', D=2.4, seed=1)
    blaster(f'{o}/S_Blaster_Fire_02.wav', D=2.15, seed=2, body_hz=(2500, 300), bright=1.1)
    blaster(f'{o}/S_Blaster_Fire_03.wav', D=2.7, seed=3, body_hz=(2000, 230), bright=0.92)
    impact(f'{o}/S_Blaster_Impact.wav', 4)
    explosion(f'{o}/S_Explosion.wav', 5)
    saber_hum(f'{o}/S_Saber_Hum.wav')
    saber_swing(f'{o}/S_Saber_Swing.wav', 6)
    saber_hit(f'{o}/S_Saber_Hit.wav', 7)
    print('ok')

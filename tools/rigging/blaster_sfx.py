# Procedural blaster shot: fast descending FM "pew" + metallic ring (no samples, no third-party audio)
import numpy as np,wave,sys
def make(path,seed,f0=2600,f1=180,dur=0.42,ring=0.5):
    sr=44100; t=np.arange(int(sr*dur))/sr; rng=np.random.default_rng(seed)
    f=f1+(f0-f1)*np.exp(-t*11)                      # exponential pitch drop
    ph=2*np.pi*np.cumsum(f)/sr
    mod=np.sin(ph*2.01+3.5*np.sin(ph*0.5))          # FM growl
    body=np.sin(ph+2.2*mod)*np.exp(-t*7.5)
    ringf=np.sin(2*np.pi*(3100+rng.uniform(-80,80))*t+1.4*np.sin(2*np.pi*47*t))*np.exp(-t*16)*ring
    click=rng.normal(0,1,len(t))*np.exp(-t*220)*0.5
    x=body+ringf+click; x*=np.minimum(1,t/0.002)
    # soft saturation + light "spring" echo
    x=np.tanh(1.8*x); d=int(0.031*sr); y=x.copy(); y[d:]+=0.28*x[:-d]; y/=np.abs(y).max()*1.08
    w=wave.open(path,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((y*32767).astype('<i2').tobytes()); w.close()
o=sys.argv[1]
make(f'{o}/S_Blaster_Fire_01.wav',1); make(f'{o}/S_Blaster_Fire_02.wav',2,2400,200,0.4); make(f'{o}/S_Blaster_Fire_03.wav',3,2800,160,0.45)
make(f'{o}/S_Blaster_Impact.wav',4,900,60,0.3,0.2)
print('ok')

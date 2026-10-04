// GENERATED from the HQPTuner repo (engine-enums.json, config-form-6.0.4 fixture, *-plain-names.json, filters.json,
// shapers.json, settings.json). Strings verbatim; do not hand-edit. Option: {v: engine name, label: plain short title,
// group?: plain-name family (optgroup), man?: the option's manual prose}. Filters and shapers in engine order;
// DSD-source decoding in the config form's order. MAN = settings.json tooltips (manual copy).

export const CATALOG = {
 "pcmFilters": [
  {
   "v": "none",
   "label": "No resampling",
   "group": "Misc",
   "man": "No sample rate conversion happens. Only sample depth is changed as needed."
  },
  {
   "v": "IIR",
   "label": "Analog-style · Very steep",
   "group": "Analog-style",
   "man": "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A really steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Small amount of passband ripple is also present. Medium attenuation. The IIR filter is applied in the time domain."
  },
  {
   "v": "IIR2",
   "label": "Analog-style · Steep",
   "group": "Analog-style",
   "man": "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Medium attenuation. No passband ripple. The IIR filter is applied in the time domain."
  },
  {
   "v": "FIR",
   "label": "Conventional · Classic · Base",
   "group": "Conventional",
   "man": "Typical \"oversampling\" digital filter, generally suitable for most uses (slight pre- and post-ringing), but best on classical music recorded in a real-world acoustic environment such as a concert hall. This is the most ordinary filter type, usually present in hardware. This filter is applied in the time domain. Average amount of pre- and post-ringing."
  },
  {
   "v": "asymFIR",
   "label": "Conventional · Classic · Asymmetric",
   "group": "Conventional",
   "man": "Asymmetric FIR, good for jazz/blues and other music containing transients recorded in a real-world acoustic environment. Otherwise same as FIR, but with shorter pre-ringing and longer post-ringing. Modifies phase response, but not as much as minimum phase FIR."
  },
  {
   "v": "minphaseFIR",
   "label": "Conventional · Classic · Minimum",
   "group": "Conventional",
   "man": "Minimum phase FIR, good for pop/rock/electronic music containing strong transients such as drums and percussion, where the recording is made in a studio using multi-track equipment. No pre-ringing, but somewhat long post-ringing."
  },
  {
   "v": "FFT",
   "label": "Conventional · Brickwall · Frequency domain",
   "group": "Conventional",
   "man": "Technically good steep \"brickwall\" filter, but might have some side effects (pre-ringing) on material containing strong transients. This filter is similar to FIR, but it is applied in the frequency domain and is quite efficient from a performance point of view while having a rather long impulse response. The length of this filter can be configured separately in the FFT filter length setting."
  },
  {
   "v": "poly-sinc-lp",
   "label": "Poly-sinc · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter. Very high quality linear phase resampling filter that can perform most of the typical conversion ratios. Good phase response, but has some amount of pre-ringing. See \"FIR\" for further details."
  },
  {
   "v": "poly-sinc-mp",
   "label": "Poly-sinc · Minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter, otherwise similar to poly-sinc. Altered phase response, but no pre-ringing. See minphaseFIR for further details."
  },
  {
   "v": "poly-sinc-short-lp",
   "label": "Poly-sinc · Short linear",
   "group": "Polyphase sinc",
   "man": "Otherwise similar to poly-sinc, but shorter pre- and post-ringing at the expense of filtering quality (not as sharp roll-off)."
  },
  {
   "v": "poly-sinc-short-mp",
   "label": "Poly-sinc · Short minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-short. Otherwise similar to poly-sinc-mp, but shorter post-ringing. Most optimal transient reproduction."
  },
  {
   "v": "poly-sinc-long-lp",
   "label": "Poly-sinc · Long linear",
   "group": "Polyphase sinc",
   "man": "Otherwise similar to poly-sinc, but longer pre- and post-ringing with improved filtering quality (faster roll-off)."
  },
  {
   "v": "poly-sinc-long-ip",
   "label": "Poly-sinc · Long intermediate",
   "group": "Polyphase sinc",
   "man": "Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing, and improved filtering quality (faster roll-off)."
  },
  {
   "v": "poly-sinc-long-mp",
   "label": "Poly-sinc · Long minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-long. Otherwise similar to poly-sinc-mp, but longer post-ringing with improved filtering quality (faster roll-off)."
  },
  {
   "v": "poly-sinc-hb",
   "label": "Poly-sinc · Half-band · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase half-band filter with steep roll-off and high attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-hb-xs",
   "label": "Poly-sinc · Half-band · X-short linear",
   "group": "Polyphase sinc",
   "man": "Extremely short linear phase polyphase half-band filter with slow roll-off and low attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-hb-s",
   "label": "Poly-sinc · Half-band · Short linear",
   "group": "Polyphase sinc",
   "man": "Short linear phase polyphase half-band filter with slow roll-off and average attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-hb-m",
   "label": "Poly-sinc · Half-band · Medium linear",
   "group": "Polyphase sinc",
   "man": "Medium linear phase polyphase half-band filter with average roll-off and medium attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-hb-l",
   "label": "Poly-sinc · Half-band · Long linear",
   "group": "Polyphase sinc",
   "man": "Long linear phase polyphase half-band filter with fast roll-off and high attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-ext",
   "label": "Poly-sinc · Extended · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with sharper roll-off and somewhat lower stop-band attenuation, while being roughly equal in length to poly-sinc."
  },
  {
   "v": "poly-sinc-ext2",
   "label": "Poly-sinc · Extended v2 · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with sharp roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure."
  },
  {
   "v": "poly-sinc-ext2-short",
   "label": "Poly-sinc · Extended v2 · Short linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with slow roll-off and high stop-band attenuation for extended frequency response. Optimal frequency response and harmonic structure."
  },
  {
   "v": "poly-sinc-ext2-medium",
   "label": "Poly-sinc · Extended v2 · Medium linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with fast roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure."
  },
  {
   "v": "poly-sinc-ext2-long",
   "label": "Poly-sinc · Extended v2 · Long linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with very fast roll-off and very high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure."
  },
  {
   "v": "poly-sinc-ext2-xla",
   "label": "Poly-sinc · Extended v2 · X-long linear, apod",
   "group": "Polyphase sinc",
   "man": "Very steep 8x longer version of poly-sinc-ext2-long."
  },
  {
   "v": "poly-sinc-ext2-xl",
   "label": "Poly-sinc · Extended v2 · X-long linear",
   "group": "Polyphase sinc",
   "man": "Very steep 8x longer non-apodizing version of poly-sinc-ext2-long. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-ext2-hires-lp",
   "label": "Poly-sinc · Extended v2 · Hi-res linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-ext2-hires-ip",
   "label": "Poly-sinc · Extended v2 · Hi-res intermediate",
   "group": "Polyphase sinc",
   "man": "Intermediate phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-ext2-hires-mp",
   "label": "Poly-sinc · Extended v2 · Hi-res minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-mqa/mp3-lp",
   "label": "Poly-sinc · MQA/MP3 · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter optimized for playing back MQA- or MP3-encoded content in order to clean up high frequency noise added by the MQA or MP3 encoding. Also suitable for upsampling PCM sources of ≥ 88.2 kHz sampling rate, especially for hi-res PCM recordings of ≥ 176.4 kHz sampling rate. Very short ringing. Early slow roll-off."
  },
  {
   "v": "poly-sinc-mqa/mp3-mp",
   "label": "Poly-sinc · MQA/MP3 · Minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-mqa."
  },
  {
   "v": "poly-sinc-xtr-lp",
   "label": "Poly-sinc · Extreme · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-xtr-mp",
   "label": "Poly-sinc · Extreme · Minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-xtr-short-lp",
   "label": "Poly-sinc · Extreme · Short linear",
   "group": "Polyphase sinc",
   "man": "Short linear phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-xtr-short-mp",
   "label": "Poly-sinc · Extreme · Short minimum",
   "group": "Polyphase sinc",
   "man": "Short minimum phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-gauss-short",
   "label": "Poly-sinc · Gauss · Short linear",
   "group": "Polyphase sinc",
   "man": "Short Gaussian polyphase sinc filter. Optimal time-frequency response."
  },
  {
   "v": "poly-sinc-gauss-medium",
   "label": "Poly-sinc · Gauss · Medium linear",
   "group": "Polyphase sinc",
   "man": "Gaussian polyphase sinc filter. Optimal time-frequency response."
  },
  {
   "v": "poly-sinc-gauss-long",
   "label": "Poly-sinc · Gauss · Long linear",
   "group": "Polyphase sinc",
   "man": "Long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response."
  },
  {
   "v": "poly-sinc-gauss-xla",
   "label": "Poly-sinc · Gauss · X-long linear, apod",
   "group": "Polyphase sinc",
   "man": "Apodizing extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response."
  },
  {
   "v": "poly-sinc-gauss-xl",
   "label": "Poly-sinc · Gauss · X-long linear",
   "group": "Polyphase sinc",
   "man": "Extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response."
  },
  {
   "v": "poly-sinc-gauss-hires-lp",
   "label": "Poly-sinc · Gauss · Hi-res linear",
   "group": "Polyphase sinc",
   "man": "Linear phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-gauss-hires-ip",
   "label": "Poly-sinc · Gauss · Hi-res intermediate",
   "group": "Polyphase sinc",
   "man": "Intermediate phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-gauss-hires-mp",
   "label": "Poly-sinc · Gauss · Hi-res minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-gauss-halfband",
   "label": "Poly-sinc · Gauss half-band · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase half-band Gaussian filter. Slightly leaky around Nyquist, but extremely high attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-gauss-halfband-s",
   "label": "Poly-sinc · Gauss half-band · Short linear",
   "group": "Polyphase sinc",
   "man": "Short linear phase half-band Gaussian filter. Leaky around Nyquist, but high attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "ASRC",
   "label": "Asynchronous, any rate",
   "group": "Misc",
   "man": "Special type of filter, slightly similar to FIR, but with a possibility of asynchronous operation for conversions from any rate to any other rate. Computationally heavy. Not recommended."
  },
  {
   "v": "polynomial-1",
   "label": "Interpolation · Polynomial · No ringing",
   "group": "Interpolation",
   "man": "Polynomial interpolation. No apparent pre- or post-ringing. Frequency response rolls off slowly in the top octave. Poor stop-band rejection and will thus leak a fairly high amount of ultrasonic distortion. These types of filters are sometimes referred to as \"non-ringing\" by some manufacturers. Not recommended."
  },
  {
   "v": "polynomial-2",
   "label": "Interpolation · Polynomial · One cycle",
   "group": "Interpolation",
   "man": "Similar to polynomial-1, but higher stop-band rejection and only one cycle of pre- and post-ringing. Not recommended."
  },
  {
   "v": "minringFIR-lp",
   "label": "Conventional · Min ringing · Linear",
   "group": "Conventional",
   "man": "Minimum ringing FIR. Uses a special algorithm to create a linear phase filter that minimizes ringing while providing better frequency response and attenuation than polynomial interpolators. Performance and ringing between polynomial and poly-sinc-short."
  },
  {
   "v": "minringFIR-mp",
   "label": "Conventional · Min ringing · Minimum",
   "group": "Conventional",
   "man": "Minimum phase variant of minringFIR."
  },
  {
   "v": "closed-form",
   "label": "Interpolation · Closed form · Base",
   "group": "Interpolation",
   "man": "Closed form interpolation with a high number of taps."
  },
  {
   "v": "closed-form-fast",
   "label": "Interpolation · Closed form · Low CPU load",
   "group": "Interpolation",
   "man": "Closed form interpolation with lower CPU load, but also lower precision. Output precision tuned to match about 24-bit PCM."
  },
  {
   "v": "closed-form-M",
   "label": "Interpolation · Closed form · 1M taps",
   "group": "Interpolation",
   "man": "Closed form interpolation with one million taps."
  },
  {
   "v": "sinc-S",
   "label": "Sinc · Extended v2 · Short",
   "group": "Pure sinc",
   "man": "Sinc filter with adaptive number of taps. Number of taps is 4096x conversion ratio. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla."
  },
  {
   "v": "sinc-M",
   "label": "Sinc · Extended v2 · Constant length",
   "group": "Pure sinc",
   "man": "Sinc filter with one million taps. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla."
  },
  {
   "v": "sinc-Mx",
   "label": "Sinc · Extended v2 · Constant time",
   "group": "Pure sinc",
   "man": "Constant time version of sinc-M. Filter length is constant in time, with one million taps at 16x PCM output rates. Variant of poly-sinc-ext2-xla. (65536x conversion ratio)"
  },
  {
   "v": "sinc-MG",
   "label": "Sinc · Gauss · Constant time",
   "group": "Pure sinc",
   "man": "Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xl. (65536x conversion ratio)"
  },
  {
   "v": "sinc-MGa",
   "label": "Sinc · Gauss · Constant time, apod",
   "group": "Pure sinc",
   "man": "Apodizing Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xla. (65536x conversion ratio)"
  },
  {
   "v": "sinc-L",
   "label": "Sinc · X-long",
   "group": "Pure sinc",
   "man": "Sinc filter with adaptive number of taps. Number of taps is 131070x conversion ratio. Extremely sharp roll-off and average attenuation."
  },
  {
   "v": "sinc-Ls",
   "label": "Sinc · Short",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps (4096x conversion ratio)."
  },
  {
   "v": "sinc-Lm",
   "label": "Sinc · Medium",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps (16384x conversion ratio)."
  },
  {
   "v": "sinc-Ll",
   "label": "Sinc · Long",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps (65536x conversion ratio)."
  },
  {
   "v": "sinc-Lh",
   "label": "Sinc · Medium with high attenuation",
   "group": "Pure sinc",
   "man": "High attenuation sinc filter with adaptive number of taps (16384x ratio). Significantly better quality than sinc-L at 1/8th of the load."
  },
  {
   "v": "sinc-short",
   "label": "Sinc · Rate-flexible · Short",
   "group": "Pure sinc",
   "man": "Short average attenuation sinc filter with adaptive number of taps."
  },
  {
   "v": "sinc-medium",
   "label": "Sinc · Rate-flexible · Medium",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps."
  },
  {
   "v": "sinc-long",
   "label": "Sinc · Rate-flexible · Long",
   "group": "Pure sinc",
   "man": "Long average attenuation sinc filter with adaptive number of taps."
  },
  {
   "v": "sinc-long-h",
   "label": "Sinc · Rate-flexible · Long with high attenuation",
   "group": "Pure sinc",
   "man": "Long high attenuation sinc filter with adaptive number of taps."
  }
 ],
 "sdmFilters": [
  {
   "v": "IIR",
   "label": "Analog-style · Very steep",
   "group": "Analog-style",
   "man": "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A really steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Small amount of passband ripple is also present. Medium attenuation. The IIR filter is applied in the time domain."
  },
  {
   "v": "IIR2",
   "label": "Analog-style · Steep",
   "group": "Analog-style",
   "man": "Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Medium attenuation. No passband ripple. The IIR filter is applied in the time domain."
  },
  {
   "v": "FIR",
   "label": "Conventional · Classic · Base",
   "group": "Conventional",
   "man": "Typical \"oversampling\" digital filter, generally suitable for most uses (slight pre- and post-ringing), but best on classical music recorded in a real-world acoustic environment such as a concert hall. This is the most ordinary filter type, usually present in hardware. This filter is applied in the time domain. Average amount of pre- and post-ringing."
  },
  {
   "v": "asymFIR",
   "label": "Conventional · Classic · Asymmetric",
   "group": "Conventional",
   "man": "Asymmetric FIR, good for jazz/blues and other music containing transients recorded in a real-world acoustic environment. Otherwise same as FIR, but with shorter pre-ringing and longer post-ringing. Modifies phase response, but not as much as minimum phase FIR."
  },
  {
   "v": "minphaseFIR",
   "label": "Conventional · Classic · Minimum",
   "group": "Conventional",
   "man": "Minimum phase FIR, good for pop/rock/electronic music containing strong transients such as drums and percussion, where the recording is made in a studio using multi-track equipment. No pre-ringing, but somewhat long post-ringing."
  },
  {
   "v": "FFT",
   "label": "Conventional · Brickwall · Frequency domain",
   "group": "Conventional",
   "man": "Technically good steep \"brickwall\" filter, but might have some side effects (pre-ringing) on material containing strong transients. This filter is similar to FIR, but it is applied in the frequency domain and is quite efficient from a performance point of view while having a rather long impulse response. The length of this filter can be configured separately in the FFT filter length setting."
  },
  {
   "v": "poly-sinc-lp",
   "label": "Poly-sinc · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter. Very high quality linear phase resampling filter that can perform most of the typical conversion ratios. Good phase response, but has some amount of pre-ringing. See \"FIR\" for further details."
  },
  {
   "v": "poly-sinc-mp",
   "label": "Poly-sinc · Minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter, otherwise similar to poly-sinc. Altered phase response, but no pre-ringing. See minphaseFIR for further details."
  },
  {
   "v": "poly-sinc-short-lp",
   "label": "Poly-sinc · Short linear",
   "group": "Polyphase sinc",
   "man": "Otherwise similar to poly-sinc, but shorter pre- and post-ringing at the expense of filtering quality (not as sharp roll-off)."
  },
  {
   "v": "poly-sinc-short-mp",
   "label": "Poly-sinc · Short minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-short. Otherwise similar to poly-sinc-mp, but shorter post-ringing. Most optimal transient reproduction."
  },
  {
   "v": "poly-sinc-long-lp",
   "label": "Poly-sinc · Long linear",
   "group": "Polyphase sinc",
   "man": "Otherwise similar to poly-sinc, but longer pre- and post-ringing with improved filtering quality (faster roll-off)."
  },
  {
   "v": "poly-sinc-long-ip",
   "label": "Poly-sinc · Long intermediate",
   "group": "Polyphase sinc",
   "man": "Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing, and improved filtering quality (faster roll-off)."
  },
  {
   "v": "poly-sinc-long-mp",
   "label": "Poly-sinc · Long minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-long. Otherwise similar to poly-sinc-mp, but longer post-ringing with improved filtering quality (faster roll-off)."
  },
  {
   "v": "poly-sinc-hb",
   "label": "Poly-sinc · Half-band · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase half-band filter with steep roll-off and high attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-hb-xs-2s",
   "label": "Poly-sinc · Half-band · X-short linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Extremely short linear phase polyphase half-band filter with slow roll-off and low attenuation. Only suitable for highest technical quality source materials.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-hb-s-2s",
   "label": "Poly-sinc · Half-band · Short linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Short linear phase polyphase half-band filter with slow roll-off and average attenuation. Only suitable for highest technical quality source materials.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-hb-m-2s",
   "label": "Poly-sinc · Half-band · Medium linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Medium linear phase polyphase half-band filter with average roll-off and medium attenuation. Only suitable for highest technical quality source materials.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-hb-l-2s",
   "label": "Poly-sinc · Half-band · Long linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Long linear phase polyphase half-band filter with fast roll-off and high attenuation. Only suitable for highest technical quality source materials.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-ext",
   "label": "Poly-sinc · Extended · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with sharper roll-off and somewhat lower stop-band attenuation, while being roughly equal in length to poly-sinc."
  },
  {
   "v": "poly-sinc-ext2",
   "label": "Poly-sinc · Extended v2 · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with sharp roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-ext2-short",
   "label": "Poly-sinc · Extended v2 · Short linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with slow roll-off and high stop-band attenuation for extended frequency response. Optimal frequency response and harmonic structure. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-ext2-medium",
   "label": "Poly-sinc · Extended v2 · Medium linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with fast roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-ext2-long",
   "label": "Poly-sinc · Extended v2 · Long linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with very fast roll-off and very high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-ext2-xla",
   "label": "Poly-sinc · Extended v2 · X-long linear, apod",
   "group": "Polyphase sinc",
   "man": "Very steep 8x longer version of poly-sinc-ext2-long. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-ext2-xl",
   "label": "Poly-sinc · Extended v2 · X-long linear",
   "group": "Polyphase sinc",
   "man": "Very steep 8x longer non-apodizing version of poly-sinc-ext2-long. Processing is two stages with a minimum 16x intermediate rate. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-ext2-hires-lp",
   "label": "Poly-sinc · Extended v2 · Hi-res linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-ext2-hires-ip",
   "label": "Poly-sinc · Extended v2 · Hi-res intermediate",
   "group": "Polyphase sinc",
   "man": "Intermediate phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-ext2-hires-mp",
   "label": "Poly-sinc · Extended v2 · Hi-res minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-mqa/mp3-lp",
   "label": "Poly-sinc · MQA/MP3 · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter optimized for playing back MQA- or MP3-encoded content in order to clean up high frequency noise added by the MQA or MP3 encoding. Also suitable for upsampling PCM sources of ≥ 88.2 kHz sampling rate, especially for hi-res PCM recordings of ≥ 176.4 kHz sampling rate. Very short ringing. Early slow roll-off."
  },
  {
   "v": "poly-sinc-mqa/mp3-mp",
   "label": "Poly-sinc · MQA/MP3 · Minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-mqa."
  },
  {
   "v": "poly-sinc-xtr-lp",
   "label": "Poly-sinc · Extreme · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-xtr-mp",
   "label": "Poly-sinc · Extreme · Minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-xtr-short-lp",
   "label": "Poly-sinc · Extreme · Short linear",
   "group": "Polyphase sinc",
   "man": "Short linear phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-xtr-short-mp",
   "label": "Poly-sinc · Extreme · Short minimum",
   "group": "Polyphase sinc",
   "man": "Short minimum phase polyphase sinc filter with extreme roll-off and attenuation."
  },
  {
   "v": "poly-sinc-lp-2s",
   "label": "Poly-sinc · Linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter. Very high quality linear phase resampling filter that can perform most of the typical conversion ratios. Good phase response, but has some amount of pre-ringing. See \"FIR\" for further details.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-mp-2s",
   "label": "Poly-sinc · Minimum, 2-stage",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter, otherwise similar to poly-sinc. Altered phase response, but no pre-ringing. See minphaseFIR for further details.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-short-lp-2s",
   "label": "Poly-sinc · Short linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Otherwise similar to poly-sinc, but shorter pre- and post-ringing at the expense of filtering quality (not as sharp roll-off).",
   "twoStage": true
  },
  {
   "v": "poly-sinc-short-mp-2s",
   "label": "Poly-sinc · Short minimum, 2-stage",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-short. Otherwise similar to poly-sinc-mp, but shorter post-ringing. Most optimal transient reproduction.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-long-lp-2s",
   "label": "Poly-sinc · Long linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Otherwise similar to poly-sinc, but longer pre- and post-ringing with improved filtering quality (faster roll-off).",
   "twoStage": true
  },
  {
   "v": "poly-sinc-long-ip-2s",
   "label": "Poly-sinc · Long intermediate, 2-stage",
   "group": "Polyphase sinc",
   "man": "Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing, and improved filtering quality (faster roll-off).",
   "twoStage": true
  },
  {
   "v": "poly-sinc-long-mp-2s",
   "label": "Poly-sinc · Long minimum, 2-stage",
   "group": "Polyphase sinc",
   "man": "Minimum phase variant of poly-sinc-long. Otherwise similar to poly-sinc-mp, but longer post-ringing with improved filtering quality (faster roll-off).",
   "twoStage": true
  },
  {
   "v": "poly-sinc-hb-2s",
   "label": "Poly-sinc · Half-band · Linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase half-band filter with steep roll-off and high attenuation. Only suitable for highest technical quality source materials.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-xtr-lp-2s",
   "label": "Poly-sinc · Extreme · Linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Linear phase polyphase sinc filter with extreme roll-off and attenuation.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-xtr-mp-2s",
   "label": "Poly-sinc · Extreme · Minimum, 2-stage",
   "group": "Polyphase sinc",
   "man": "Minimum phase polyphase sinc filter with extreme roll-off and attenuation.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-xtr-short-lp-2s",
   "label": "Poly-sinc · Extreme · Short linear, 2-stage",
   "group": "Polyphase sinc",
   "man": "Short linear phase polyphase sinc filter with extreme roll-off and attenuation.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-xtr-short-mp-2s",
   "label": "Poly-sinc · Extreme · Short minimum, 2-stage",
   "group": "Polyphase sinc",
   "man": "Short minimum phase polyphase sinc filter with extreme roll-off and attenuation.",
   "twoStage": true
  },
  {
   "v": "poly-sinc-gauss-short",
   "label": "Poly-sinc · Gauss · Short linear",
   "group": "Polyphase sinc",
   "man": "Short Gaussian polyphase sinc filter. Optimal time-frequency response. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-gauss-medium",
   "label": "Poly-sinc · Gauss · Medium linear",
   "group": "Polyphase sinc",
   "man": "Gaussian polyphase sinc filter. Optimal time-frequency response. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-gauss-long",
   "label": "Poly-sinc · Gauss · Long linear",
   "group": "Polyphase sinc",
   "man": "Long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-gauss-xla",
   "label": "Poly-sinc · Gauss · X-long linear, apod",
   "group": "Polyphase sinc",
   "man": "Apodizing extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-gauss-xl",
   "label": "Poly-sinc · Gauss · X-long linear",
   "group": "Polyphase sinc",
   "man": "Extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "poly-sinc-gauss-hires-lp",
   "label": "Poly-sinc · Gauss · Hi-res linear",
   "group": "Polyphase sinc",
   "man": "Linear phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-gauss-hires-ip",
   "label": "Poly-sinc · Gauss · Hi-res intermediate",
   "group": "Polyphase sinc",
   "man": "Intermediate phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-gauss-hires-mp",
   "label": "Poly-sinc · Gauss · Hi-res minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA."
  },
  {
   "v": "poly-sinc-gauss-halfband",
   "label": "Poly-sinc · Gauss half-band · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase half-band Gaussian filter. Slightly leaky around Nyquist, but extremely high attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "poly-sinc-gauss-halfband-s",
   "label": "Poly-sinc · Gauss half-band · Short linear",
   "group": "Polyphase sinc",
   "man": "Short linear phase half-band Gaussian filter. Leaky around Nyquist, but high attenuation. Only suitable for highest technical quality source materials."
  },
  {
   "v": "polynomial-1",
   "label": "Interpolation · Polynomial · No ringing",
   "group": "Interpolation",
   "man": "Polynomial interpolation. No apparent pre- or post-ringing. Frequency response rolls off slowly in the top octave. Poor stop-band rejection and will thus leak a fairly high amount of ultrasonic distortion. These types of filters are sometimes referred to as \"non-ringing\" by some manufacturers. Not recommended."
  },
  {
   "v": "polynomial-2",
   "label": "Interpolation · Polynomial · One cycle",
   "group": "Interpolation",
   "man": "Similar to polynomial-1, but higher stop-band rejection and only one cycle of pre- and post-ringing. Not recommended."
  },
  {
   "v": "minringFIR-lp",
   "label": "Conventional · Min ringing · Linear",
   "group": "Conventional",
   "man": "Minimum ringing FIR. Uses a special algorithm to create a linear phase filter that minimizes ringing while providing better frequency response and attenuation than polynomial interpolators. Performance and ringing between polynomial and poly-sinc-short."
  },
  {
   "v": "minringFIR-mp",
   "label": "Conventional · Min ringing · Minimum",
   "group": "Conventional",
   "man": "Minimum phase variant of minringFIR."
  },
  {
   "v": "closed-form",
   "label": "Interpolation · Closed form · Base",
   "group": "Interpolation",
   "man": "Closed form interpolation with a high number of taps."
  },
  {
   "v": "closed-form-fast",
   "label": "Interpolation · Closed form · Low CPU load",
   "group": "Interpolation",
   "man": "Closed form interpolation with lower CPU load, but also lower precision. Output precision tuned to match about 24-bit PCM."
  },
  {
   "v": "closed-form-16M",
   "label": "Interpolation · Closed form · 16M taps",
   "group": "Interpolation",
   "man": "Closed form interpolation with 16 million taps."
  },
  {
   "v": "sinc-S",
   "label": "Sinc · Extended v2 · Short",
   "group": "Pure sinc",
   "man": "Sinc filter with adaptive number of taps. Number of taps is 4096x conversion ratio. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla."
  },
  {
   "v": "sinc-M",
   "label": "Sinc · Extended v2 · Constant length",
   "group": "Pure sinc",
   "man": "Sinc filter with one million taps. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla."
  },
  {
   "v": "sinc-Mx",
   "label": "Sinc · Extended v2 · Constant time",
   "group": "Pure sinc",
   "man": "Constant time version of sinc-M. Filter length is constant in time, with one million taps at 16x PCM output rates. Variant of poly-sinc-ext2-xla. (65536x conversion ratio)"
  },
  {
   "v": "sinc-MG",
   "label": "Sinc · Gauss · Constant time",
   "group": "Pure sinc",
   "man": "Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xl. (65536x conversion ratio)"
  },
  {
   "v": "sinc-MGa",
   "label": "Sinc · Gauss · Constant time, apod",
   "group": "Pure sinc",
   "man": "Apodizing Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xla. (65536x conversion ratio)"
  },
  {
   "v": "sinc-L",
   "label": "Sinc · X-long",
   "group": "Pure sinc",
   "man": "Sinc filter with adaptive number of taps. Number of taps is 131070x conversion ratio. Extremely sharp roll-off and average attenuation."
  },
  {
   "v": "sinc-Ls",
   "label": "Sinc · Short",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps (4096x conversion ratio)."
  },
  {
   "v": "sinc-Lm",
   "label": "Sinc · Medium",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps (16384x conversion ratio)."
  },
  {
   "v": "sinc-Ll",
   "label": "Sinc · Long",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps (65536x conversion ratio)."
  },
  {
   "v": "sinc-Lh",
   "label": "Sinc · Medium with high attenuation",
   "group": "Pure sinc",
   "man": "High attenuation sinc filter with adaptive number of taps (16384x ratio). Significantly better quality than sinc-L at 1/8th of the load."
  },
  {
   "v": "sinc-short",
   "label": "Sinc · Rate-flexible · Short",
   "group": "Pure sinc",
   "man": "Short average attenuation sinc filter with adaptive number of taps. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "sinc-medium",
   "label": "Sinc · Rate-flexible · Medium",
   "group": "Pure sinc",
   "man": "Average attenuation sinc filter with adaptive number of taps. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "sinc-long",
   "label": "Sinc · Rate-flexible · Long",
   "group": "Pure sinc",
   "man": "Long average attenuation sinc filter with adaptive number of taps. Processing is two stages with a minimum 16x intermediate rate."
  },
  {
   "v": "sinc-long-h",
   "label": "Sinc · Rate-flexible · Long with high attenuation",
   "group": "Pure sinc",
   "man": "Long high attenuation sinc filter with adaptive number of taps. Processing is two stages with a minimum 16x intermediate rate."
  }
 ],
 "dithers": [
  {
   "v": "none",
   "label": "Rounding only",
   "group": "None",
   "man": "No noise-shaping or dithering, only rounding. Mostly suitable for testing cases together with none filter selection, where bit-perfect output is needed. Not recommended."
  },
  {
   "v": "NS1",
   "label": "Noise shaping · 1st order, ≥4x",
   "group": "Noise shaping",
   "man": "Simple first order noise-shaping. Sample values are rounded and the quantization error is shaped in such a way that the error energy is pushed to the higher frequencies. Suitable mostly for 176.4/192 kHz upsampling. Use of \"NS1\" with equipment sensitive to ultrasonic noise is not recommended."
  },
  {
   "v": "NS4",
   "label": "Noise shaping · 4th order, ≥2x",
   "group": "Noise shaping",
   "man": "Fourth order noise-shaping. Similar in shape to the \"shaped\" dither. Suitable for all rates ≥ 88.2 kHz."
  },
  {
   "v": "NS5",
   "label": "Noise shaping · 5th order, ≥8x",
   "group": "Noise shaping",
   "man": "Fifth order noise-shaping. Fairly aggressive noise-shaping designed for 8x and 16x rates (352.8/384/705.6/768 kHz). Not recommended for rates below 192 kHz. Especially good for PCM1704 at those highest rates."
  },
  {
   "v": "NS9",
   "label": "Noise shaping · 9th order, ≥4x",
   "group": "Noise shaping",
   "man": "Ninth order noise-shaping. Very aggressive noise-shaping designed especially for 4x rates (176.4/192 kHz) and recommended for these rates. Especially good for older 16-bit, 4x-rate-capable multibit DACs like TDA154x etc."
  },
  {
   "v": "LNS15",
   "label": "Noise shaping · 15th order linear, ≥16x",
   "group": "Noise shaping",
   "man": "15th order linear noise-shaping. Smooth noise-shaping slope designed especially for 16x rates (705.6/768 kHz) and recommended for these higher PCM rates. Can be also used at 8x rates (352.8/384 kHz), but not recommended for rates below."
  },
  {
   "v": "RPDF",
   "label": "Additive · Rectangular, ≥24-bit output",
   "group": "Additive",
   "man": "Rectangular Probability Density Function. White noise dither. Computationally lightweight, but only suitable for 24-bit or higher output hardware."
  },
  {
   "v": "TPDF",
   "label": "Additive · Triangular, any rate",
   "group": "Additive",
   "man": "Triangular Probability Density Function. This is the industry standard simple dither mechanism. Suitable for any rate and recommended if the playback rate is 44.1/48 kHz. Recommended for general purpose use."
  },
  {
   "v": "Gauss1",
   "label": "Additive · Gauss, ≤2x",
   "group": "Additive",
   "man": "Gaussian Probability Density Function. High quality flat frequency dither recommended for rates ≤ 96 kHz where noise-shaping is not suitable."
  },
  {
   "v": "shaped",
   "label": "Additive · Frequency shaped, ≥2x",
   "group": "Additive",
   "man": "Shaped dither. Noise used in this dither has a shaped frequency distribution to lower the audibility of the dither noise. Suitable for playback rates ≥ 88.2/96 kHz."
  }
 ],
 "modulators": [
  {
   "v": "DSD5",
   "label": "Fixed · 5th order · Rate adaptive",
   "group": "Fixed",
   "man": "Rate adaptive fifth order one-bit delta-sigma modulator."
  },
  {
   "v": "DSD5v2",
   "label": "Fixed · 5th order · Revised",
   "group": "Fixed",
   "man": "Revised fifth order one-bit delta-sigma modulator."
  },
  {
   "v": "DSD5v2 256+fs",
   "label": "Fixed · 5th order · Revised, DSD256+",
   "group": "Fixed",
   "man": "Revised fifth order one-bit delta-sigma modulator optimized for rates ≥ 10.24 MHz."
  },
  {
   "v": "DSD5EC",
   "label": "Fixed · 5th order · Rate adaptive, EC",
   "group": "Fixed",
   "man": "Rate adaptive fifth order one-bit delta-sigma modulator with extended compensation."
  },
  {
   "v": "ASDM5",
   "label": "Adaptive · 5th order · Base",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator."
  },
  {
   "v": "ASDM5EC",
   "label": "Adaptive · 5th order · EC",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation."
  },
  {
   "v": "ASDM5ECv2",
   "label": "Adaptive · 5th order · v2, EC",
   "group": "Adaptive",
   "man": "Second generation of ASDM5EC with minor improvements."
  },
  {
   "v": "ASDM5ECv3",
   "label": "Adaptive · 5th order · v3, EC",
   "group": "Adaptive",
   "man": "Third generation of ASDM5EC with minor improvements."
  },
  {
   "v": "ASDM5EC-ul",
   "label": "Adaptive · 5th order · Ultralight, EC",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Ultralight version."
  },
  {
   "v": "ASDM5EC-light",
   "label": "Adaptive · 5th order · Light, EC",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Light version."
  },
  {
   "v": "ASDM5EC-fast",
   "label": "Adaptive · 5th order · Transient optimized, EC",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Transient and load optimized version."
  },
  {
   "v": "ASDM5EC-super",
   "label": "Adaptive · 5th order · Super, EC",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Super version."
  },
  {
   "v": "ASDM5EC-ul 512+fs",
   "label": "Adaptive · 5th order · Ultralight, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Ultralight version."
  },
  {
   "v": "ASDM5EC-light 512+fs",
   "label": "Adaptive · 5th order · Light, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Light version."
  },
  {
   "v": "ASDM5EC-fast 512+fs",
   "label": "Adaptive · 5th order · Transient optimized, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Transient and load optimized version."
  },
  {
   "v": "ASDM5EC-super 512+fs",
   "label": "Adaptive · 5th order · Super, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Super version."
  },
  {
   "v": "DSD7",
   "label": "Fixed · 7th order · Base",
   "group": "Fixed",
   "man": "Seventh order one-bit delta-sigma modulator."
  },
  {
   "v": "DSD7 256+fs",
   "label": "Fixed · 7th order · DSD256+",
   "group": "Fixed",
   "man": "Seventh order one-bit delta-sigma modulator optimized for rates ≥ 10.24 MHz."
  },
  {
   "v": "ASDM7",
   "label": "Adaptive · 7th order · Base",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator."
  },
  {
   "v": "ASDM7EC",
   "label": "Adaptive · 7th order · EC",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation."
  },
  {
   "v": "ASDM7ECv2",
   "label": "Adaptive · 7th order · v2, EC",
   "group": "Adaptive",
   "man": "Second generation of ASDM7EC with minor improvements."
  },
  {
   "v": "ASDM7ECv3",
   "label": "Adaptive · 7th order · v3, EC",
   "group": "Adaptive",
   "man": "Third generation of ASDM7EC with minor improvements."
  },
  {
   "v": "ASDM7EC-ul",
   "label": "Adaptive · 7th order · Ultralight, EC",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Ultralight version."
  },
  {
   "v": "ASDM7EC-light",
   "label": "Adaptive · 7th order · Light, EC",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Light version."
  },
  {
   "v": "ASDM7EC-fast",
   "label": "Adaptive · 7th order · Transient optimized, EC",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Transient and load optimized version."
  },
  {
   "v": "ASDM7EC-super",
   "label": "Adaptive · 7th order · Super, EC",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Super version."
  },
  {
   "v": "ASDM7EC-ul 512+fs",
   "label": "Adaptive · 7th order · Ultralight, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Ultralight version."
  },
  {
   "v": "ASDM7EC-light 512+fs",
   "label": "Adaptive · 7th order · Light, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Light version."
  },
  {
   "v": "ASDM7EC-fast 512+fs",
   "label": "Adaptive · 7th order · Transient optimized, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Transient and load optimized version."
  },
  {
   "v": "ASDM7EC-super 512+fs",
   "label": "Adaptive · 7th order · Super, EC, DSD512+",
   "group": "Adaptive",
   "man": "Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Super version."
  },
  {
   "v": "AMSDM7 512+fs",
   "label": "Adaptive · 7th order · Pseudo-multi-bit, DSD512+",
   "group": "Adaptive",
   "man": "Special adaptive seventh order \"pseudo-multi-bit\" modulator optimized for rates ≥ 20.48 MHz."
  },
  {
   "v": "AMSDM7EC 512+fs",
   "label": "Adaptive · 7th order · Pseudo-multi-bit, EC, DSD512+",
   "group": "Adaptive",
   "man": "Special adaptive seventh order \"pseudo-multi-bit\" modulator with extended compensation for rates ≥ 20.48 MHz."
  },
  {
   "v": "AHM5EC4B",
   "label": "Hybrid · 5th order · 4-bit, DSD1024+",
   "group": "Hybrid",
   "man": "Fifth order 4-bit hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz. Utilizes 1024x and higher output rates for improved performance with most bit-perfect D/A conversions."
  },
  {
   "v": "AHM7EC4B",
   "label": "Hybrid · 7th order · 4-bit, DSD1024+",
   "group": "Hybrid",
   "man": "Seventh order 4-bit hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz. Utilizes 1024x and higher output rates for improved performance with most bit-perfect D/A conversions."
  },
  {
   "v": "AHM5EC8B",
   "label": "Hybrid · 5th order · 8-bit, DSD1024+",
   "group": "Hybrid",
   "man": "Fifth order 8-bit hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz. Bandwidth optimized to provide enough flat noise floor bandwidth for practically all hi-res content."
  },
  {
   "v": "AHM7EC8B",
   "label": "Hybrid · 7th order · 8-bit, DSD1024+",
   "group": "Hybrid",
   "man": "Seventh order 8-bit hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz. Bandwidth optimized to provide enough flat noise floor bandwidth for practically all hi-res content."
  }
 ],
 "noiseFilters": [
  {
   "v": "standard",
   "label": "Dedicated · Base",
   "group": "Dedicated",
   "man": "Standard noise filter will be applied. Recommended."
  },
  {
   "v": "low",
   "label": "Dedicated · Low ƒc",
   "group": "Dedicated",
   "man": "Similar to standard, but has a lower corner frequency and results in an almost flat noise profile in the ultrasonic range. Recommended."
  },
  {
   "v": "high-order",
   "label": "Dedicated · Modern sources",
   "group": "Dedicated",
   "man": "High-order noise filter designed for material created with high-order modulators. Recommended."
  },
  {
   "v": "sac",
   "label": "Averaging · Sliding",
   "group": "Averaging",
   "man": "Sliding average converter."
  },
  {
   "v": "wec",
   "label": "Averaging · Weighted",
   "group": "Averaging",
   "man": "Weighted element converter."
  },
  {
   "v": "wec2",
   "label": "Averaging · Weighted, non-ringing linear",
   "group": "Averaging",
   "man": "Weighted element converter. Optimized to closely match DSD/SACD specification. Non-ringing linear phase. Recommended."
  },
  {
   "v": "slow-lp",
   "label": "Roll-off ladder · Slow linear",
   "group": "Roll-off ladder",
   "man": "Slow roll-off linear phase filter."
  },
  {
   "v": "slow-mp",
   "label": "Roll-off ladder · Slow minimum",
   "group": "Roll-off ladder",
   "man": "Slow roll-off minimum phase filter."
  },
  {
   "v": "medium",
   "label": "Roll-off ladder · Medium",
   "group": "Roll-off ladder",
   "man": "Medium roll-off linear phase filter designed to be as gentle as possible while passing a minimal amount of out-of-band noise. Recommended."
  },
  {
   "v": "medium-high",
   "label": "Roll-off ladder · Medium, no conversion",
   "group": "Roll-off ladder",
   "man": "Medium roll-off high-rate linear phase filter designed to be as gentle as possible while passing a minimal amount of out-of-band noise. Use this instead of \"medium\" when \"none\" is selected as PCM Conversion (Decimation filter). Recommended."
  },
  {
   "v": "fast-lp",
   "label": "Roll-off ladder · Fast linear",
   "group": "Roll-off ladder",
   "man": "Fast roll-off linear phase filter."
  },
  {
   "v": "fast-mp",
   "label": "Roll-off ladder · Fast minimum",
   "group": "Roll-off ladder",
   "man": "Fast roll-off minimum phase filter."
  },
  {
   "v": "brickwall",
   "label": "Roll-off ladder · Brickwall",
   "group": "Roll-off ladder",
   "man": "Brickwall filter that doesn't pass any out-of-band noise. Very steep linear phase filter. Cut-off at 25 kHz for DSD64, 50 kHz for DSD128, 100 kHz for DSD256, 200 kHz for DSD512 and 400 kHz for DSD1024."
  }
 ],
 "decimation": [
  {
   "v": "traditional",
   "label": "Conventional · Recursive",
   "group": "Conventional",
   "man": "Traditional recursive conversion algorithm. Minimizes the amount of ringing by using slow roll-off filters."
  },
  {
   "v": "single-steep",
   "label": "Conventional · Steep",
   "group": "Conventional",
   "man": "Single-pass conversion algorithm with steep roll-off."
  },
  {
   "v": "single-short",
   "label": "Conventional · Balanced",
   "group": "Conventional",
   "man": "Single-pass conversion algorithm with normal roll-off. Optimized tradeoff between ringing and wide frequency response."
  },
  {
   "v": "sinc-S",
   "label": "Sinc · Short",
   "group": "Pure sinc",
   "man": "Linear phase adaptive length sharp roll-off and high attenuation single-pass conversion algorithm."
  },
  {
   "v": "sinc-M",
   "label": "Sinc · Constant length",
   "group": "Pure sinc",
   "man": "Linear phase million-tap sharp roll-off and high attenuation single-pass conversion algorithm."
  },
  {
   "v": "poly-lp",
   "label": "Poly-sinc · Linear",
   "group": "Polyphase sinc",
   "man": "Linear phase single-pass conversion algorithm."
  },
  {
   "v": "poly-mp",
   "label": "Poly-sinc · Minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase single-pass conversion algorithm."
  },
  {
   "v": "poly-short-lp",
   "label": "Poly-sinc · Short linear",
   "group": "Polyphase sinc",
   "man": "Linear phase slow roll-off single-pass conversion algorithm. Recommended."
  },
  {
   "v": "poly-short-mp",
   "label": "Poly-sinc · Short minimum",
   "group": "Polyphase sinc",
   "man": "Minimum phase slow roll-off single-pass conversion algorithm."
  },
  {
   "v": "poly-xtr",
   "label": "Poly-sinc · Extreme",
   "group": "Polyphase sinc",
   "man": "Linear phase extreme roll-off and attenuation single-pass conversion algorithm."
  },
  {
   "v": "poly-xtr-short",
   "label": "Poly-sinc · Extreme · Short",
   "group": "Polyphase sinc",
   "man": "Linear phase extreme roll-off and attenuation single-pass conversion algorithm."
  },
  {
   "v": "poly-ext2",
   "label": "Poly-sinc · Extended v2",
   "group": "Polyphase sinc",
   "man": "Linear phase extended frequency response sharp roll-off and high attenuation single-pass conversion algorithm."
  },
  {
   "v": "poly-gauss-long",
   "label": "Poly-sinc · Gauss · Long",
   "group": "Polyphase sinc",
   "man": "Linear phase Gaussian extremely high attenuation single-pass conversion algorithm. Optimal time-frequency response."
  },
  {
   "v": "none",
   "label": "No decimation",
   "group": "Bypass",
   "man": "No decimation; intermediate output rate is equal to the source DSD rate."
  }
 ],
 "integrators": [
  {
   "v": "IIR",
   "label": "Conventional · Base",
   "group": "Conventional",
   "man": "Normal IIR-type integrator structure. 50 kHz audio bandwidth re: DSD64."
  },
  {
   "v": "IIR2",
   "label": "Conventional · Low noise",
   "group": "Conventional",
   "man": "IIR-type integrator structure designed to minimize residual noise. 25 kHz audio bandwidth re: DSD64."
  },
  {
   "v": "IIR3",
   "label": "Conventional · Medium bandwidth",
   "group": "Conventional",
   "man": "High-order IIR-type integrator structure. 30 kHz audio bandwidth re: DSD64."
  },
  {
   "v": "FIR",
   "label": "Weighted averaging · Base",
   "group": "Weighted averaging",
   "man": "Weighted FIR-type integrator structure."
  },
  {
   "v": "FIR2",
   "label": "Weighted averaging · Wide",
   "group": "Weighted averaging",
   "man": "Weighted FIR-type integrator structure. 50 kHz audio bandwidth re: DSD64."
  },
  {
   "v": "FIR-bl",
   "label": "Weighted averaging · Narrow",
   "group": "Weighted averaging",
   "man": "FIR-type integrator structure with band-limiting. 24 kHz audio bandwidth re: DSD64 with complete cut by 45 kHz."
  },
  {
   "v": "FIR-bw",
   "label": "Weighted averaging · Brickwall",
   "group": "Weighted averaging",
   "man": "FIR-type integrator structure with brickwall band-limiting. 21.5 kHz audio bandwidth re: DSD64 with complete cut by 30 kHz."
  },
  {
   "v": "CIC",
   "label": "Simple averaging · Base",
   "group": "Simple averaging",
   "man": "Cascade comb-type integrator structure."
  }
 ],
 "sdmConversion": [
  {
   "v": "wide",
   "label": "Wide",
   "man": "Wide bandwidth signal."
  },
  {
   "v": "narrow",
   "label": "Narrow",
   "man": "Narrow bandwidth signal."
  },
  {
   "v": "XFi",
   "label": "Extreme fidelity",
   "man": "Extreme fidelity medium bandwidth."
  }
 ],
 "fftSizes": [
  "128",
  "256",
  "512",
  "1024",
  "2048",
  "4096",
  "8192",
  "16384"
 ]
};

export const MAN = {
 "filter_1x": "This selection can be used to switch between resampling / oversampling filters, and has an impact on the available hardware sampling rates. Filter/oversampling selection for \"1x\" rates covers source sampling rates below 50 kHz, so-called base rates.",
 "filter_nx": "Filter selection for \"Nx\" rates covers everything above the 1x rates.",
 "fft_length": "Length of the FFT filter. Default value is 512. Length affects the steepness of the filter: shorter lengths result in slower (gentler) roll-off, while higher lengths result in faster (steeper) roll-off. This setting is per each 2x cascade filter, so it is not conversion ratio dependent. Only applies when an FFT-family filter is selected.",
 "pcm_dither": "Word-length algorithms. This selection can be used to switch between different word-length reduction algorithms. It is always recommended to use at least TPDF dither.",
 "sdm_modulator": "The delta-sigma modulator used to produce SDM output. Fifth order modulators are more suitable for DACs that have simple analog reconstruction filters. Seventh order modulators provide better technical performance, but also put more demands on the DAC's analog reconstruction filter. Typically this means that fifth order modulators suit DACs that have one switching element while seventh order modulators have the potential for better performance on DACs that have multi-element switching arrays. DSD* modulators are fixed configuration ones while ASDM* modulators are adaptive in various ways based on the source signal. For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal.",
 "direct_sdm": "Direct playback disables all processing when the source is DSD content and the output is SDM to a DSD device or file. Note! Direct playback will disable volume control and set PCM volume to a fixed -3 dBFS value.",
 "dsd_gain_6db": "DSDIFF or DSF files should typically have 6 dB of headroom on the signal level. By selecting \"+6 dB\", 6 decibels of gain is applied, removing this headroom from the converted signal. This way the normal playback level reaches that of normal PCM. However, this may cause overloads with some source material and may require extra attenuation using the volume control.",
 "sdm_integrator": "Three types of delta-sigma integrators are available for different SDM → SDM remodulation schemes. These affect mostly the frequency and phase response at the highest frequencies. Stated frequencies apply for the DSD64 source rate, and these frequencies scale as a function of the source sampling rate.",
 "sdm_conversion": "Different options for SDM → SDM rate conversions. These affect the frequency aperture that is assumed to contain a useful signal in addition to increasing noise-shaping noise. For example, piano doesn't contain high-frequency harmonics; for such a case, \"narrow\" is suitable. Close-miked percussion usually contains high level high-frequency content so that \"wide\" may be more suitable. \"XFi\" is suitable for all cases and is the default.",
 "pdm_filter": "Different types of noise filters for PCM output of DSD/SDM sources. These reduce the amount of ultrasonic noise present in the source data. Standard filtering leaves a low level of ultrasonic noise. Some loudspeakers with tweeters of low power-handling capability can be sensitive to this noise, especially when higher listening volumes are used. Also some poorly designed, or class-D, amplifiers can misbehave in the presence of such ultrasonic content. More aggressive noise filters can therefore be selected. These filters will also limit the bandwidth available for the audio content. When the processing output rate of a DSD source (assuming DSD64) is 88.2/96 kHz PCM, the use of extra noise filtering in addition to \"standard\" is less important, since most of the noise will be cut out. When the processing output rate of a DSDIFF or DSF source is 44.1/48 kHz, extra noise filtering in addition to \"standard\" is not needed and will reduce playback quality.",
 "pdm_conversion": "These settings control DSD to PCM conversion algorithms."
};

// filters.json two_stage_note: follows the prose of every option flagged twoStage (a '-2s' name).
export const TWO_STAGE = "Two stage oversampling: the first stage rate conversion is performed by at least a factor of 8 using the selected algorithm, then the signal is further converted to the final rate using an algorithm optimized for content already processed to at least 8x rate. This lowers overall CPU load while preserving the same conversion quality. Especially useful for the highest output rates.";

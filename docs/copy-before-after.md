# Description copy: before and after

This file records every user-facing description, tooltip and note string that now differs from the HQPlayer manual text it derives from, after the terse-register copy revision of 2026-08-23. Before is the original text, after is the current text.

## filters.json

### two_stage_note
- **Before:** Two stage oversampling: first stage rate conversion is performed by at least a factor of 8 using the selected algorithm, then further converted to the final rate using an algorithm optimized for content already processed to at least 8x rate. This lowers overall CPU load while preserving the same conversion quality. Especially useful for highest output rates.
- **After:** Two stage oversampling: the first stage rate conversion is performed by at least a factor of 8 using the selected algorithm, then the signal is further converted to the final rate using an algorithm optimized for content already processed to at least 8x rate. This lowers overall CPU load while preserving the same conversion quality. Especially useful for the highest output rates.

### guidance.axes.phase.mechanism
- **Before:** Manual §4.6: minimum-phase variants have 'no pre-ringing, but somewhat long post-ringing'; linear-phase variants have symmetric pre- and post-ringing; intermediate-phase variants have 'small pre-ringing and longer post-ringing'. Phase is encoded in the filter name (-lp/-ip/-mp).
- **After:** Manual §4.6: minimum phase variants have 'no pre-ringing, but somewhat long post-ringing'; linear phase variants have symmetric pre- and post-ringing; intermediate phase variants have 'small pre-ringing and longer post-ringing'. Phase is encoded in the filter name (-lp/-ip/-mp).

### guidance.axes.phase.symptoms_pointing_linear
- **Before:** spatial impression on material recorded in a real acoustic environment — the manual's 'space' focus spans linear-, intermediate- and minimum-phase variants
- **After:** spatial impression on material recorded in a real acoustic environment — the manual's 'space' focus spans linear, intermediate and minimum phase variants

### guidance.axes.phase.contested
- **Before:** No published discrimination test of minimum- versus linear-phase resampling exists (PHASE.md §10); adjacent group-delay audibility thresholds suggest small effects. State the mechanism, never a guaranteed audible difference.
- **After:** No published discrimination test of minimum versus linear phase resampling exists (PHASE.md §10); adjacent group-delay audibility thresholds suggest small effects. State the mechanism, never a guaranteed audible difference.

### IIR
- **Before:** This is analog-sounding filter, especially suitable for recordings containing strong transients, long post-ringing is a side effect (not usually audible due to masking). A really steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing, but has a long post-ringing. Small amount of pass-band ripple is also present. Medium attenuation. IIR filter is applied in time domain.
- **After:** Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A really steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Small amount of passband ripple is also present. Medium attenuation. IIR filter is applied in time domain.

### IIR2
- **Before:** This is analog-sounding filter, especially suitable for recordings containing strong transients, long post-ringing is a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing, but has a long post-ringing. Medium attenuation. No passband ripple. IIR filter is applied in time domain.
- **After:** Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Medium attenuation. No passband ripple. IIR filter is applied in time domain.

### FIR
- **Before:** Typical "oversampling" digital filter, generally suitable for most uses (slight pre- and post-ringing), but best on classical music recorded in a real world acoustic environment such as concert hall. This is the most ordinary filter type, usually present in hardware. This filter is applied in time-domain. It has average amount of pre- and post-ringing.
- **After:** Typical "oversampling" digital filter, generally suitable for most uses (slight pre- and post-ringing), but best on classical music recorded in a real-world acoustic environment such as a concert hall. This is the most ordinary filter type, usually present in hardware. This filter is applied in time domain. Average amount of pre- and post-ringing.

### FFT
- **Before:** Technically good steep "brickwall" filter, but might have some side effects (pre-ringing) on material containing strong transients. This filter is similar to FIR, but it is applied in frequency-domain and is quite efficient from performance point of view while having rather long impulse response. Length of this filter can be configured separately in the FFT filter length setting.
- **After:** Technically good steep "brickwall" filter, but might have some side effects (pre-ringing) on material containing strong transients. This filter is similar to FIR, but it is applied in frequency domain and is quite efficient from performance point of view while having rather long impulse response. Length of this filter can be configured separately in the FFT filter length setting.

### poly-sinc-lp
- **Before:** Linear phase polyphase sinc filter. Very high quality linear phase resampling filter, can perform most of the typical conversion ratios. Good phase response, but has some amount of pre-ringing. See "FIR" for further details.
- **After:** Linear phase polyphase sinc filter. Very high quality linear phase resampling filter that can perform most of the typical conversion ratios. Good phase response, but has some amount of pre-ringing. See "FIR" for further details.

### poly-sinc-short-mp
- **Before:** Minimum phase variant of poly-sinc-shrt. Otherwise similar to poly-sinc-mp, but shorter post-ringing. Most optimal transient reproduction.
- **After:** Minimum phase variant of poly-sinc-short. Otherwise similar to poly-sinc-mp, but shorter post-ringing. Most optimal transient reproduction.

### poly-sinc-long-ip
- **Before:** Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing, with improved filtering quality (faster roll-off).
- **After:** Intermediate phase version of poly-sinc-long, with small pre-ringing and longer post-ringing, and improved filtering quality (faster roll-off).

### poly-sinc-hb
- **Before:** Linear-phase polyphase half-band filter with steep roll-off and high attenuation.
- **After:** Linear phase polyphase half-band filter with steep roll-off and high attenuation.

### poly-sinc-hb-xs
- **Before:** Extremely short linear-phase polyphase half-band filter with slow roll-off and low attenuation.
- **After:** Extremely short linear phase polyphase half-band filter with slow roll-off and low attenuation.

### poly-sinc-hb-s
- **Before:** Short linear-phase polyphase half-band filter with slow roll-off and average attenuation.
- **After:** Short linear phase polyphase half-band filter with slow roll-off and average attenuation.

### poly-sinc-hb-m
- **Before:** Medium linear-phase polyphase half-band filter with average roll-off and medium attenuation.
- **After:** Medium linear phase polyphase half-band filter with average roll-off and medium attenuation.

### poly-sinc-hb-l
- **Before:** Long linear-phase polyphase half-band filter with fast roll-off and high attenuation.
- **After:** Long linear phase polyphase half-band filter with fast roll-off and high attenuation.

### poly-sinc-ext2
- **Before:** Linear phase polyphase sinc filter with sharp roll-off and high stop-band attenuation for extended frequency response while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Linear phase polyphase sinc filter with sharp roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure.

### poly-sinc-ext2-short
- **Before:** Linear phase polyphase sinc filter with slow roll-off and high stop-band attenuation for extended frequency response. Optimal frequency response and harmonic structure. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Linear phase polyphase sinc filter with slow roll-off and high stop-band attenuation for extended frequency response. Optimal frequency response and harmonic structure.

### poly-sinc-ext2-medium
- **Before:** Linear phase polyphase sinc filter with fast roll-off and high stop-band attenuation for extended frequency response while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Linear phase polyphase sinc filter with fast roll-off and high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure.

### poly-sinc-ext2-long
- **Before:** Linear phase polyphase sinc filter with very fast roll-off and very high stop-band attenuation for extended frequency response while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Linear phase polyphase sinc filter with very fast roll-off and very high stop-band attenuation for extended frequency response, while completely cutting off by the Nyquist frequency. Optimal frequency response and harmonic structure.

### poly-sinc-ext2-xla
- **Before:** Very steep 8-times-longer version of poly-sinc-ext2-long. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Very steep 8x longer version of poly-sinc-ext2-long.

### poly-sinc-ext2-xl
- **Before:** Very steep 8-times-longer non-apodizing version of poly-sinc-ext2-long. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Very steep 8x longer non-apodizing version of poly-sinc-ext2-long.

### poly-sinc-ext2-hires-lp
- **Before:** Linear-phase polyphase sinc filter for HiRes content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.
- **After:** Linear phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.

### poly-sinc-ext2-hires-ip
- **Before:** Intermediate-phase polyphase sinc filter for HiRes content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.
- **After:** Intermediate phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.

### poly-sinc-ext2-hires-mp
- **Before:** Minimum-phase polyphase sinc filter for HiRes content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.
- **After:** Minimum phase polyphase sinc filter for hi-res content, with very high stop-band attenuation. Also suitable for playback of lossy compression such as MP3 or MQA.

### poly-sinc-mqa/mp3-lp
- **Before:** Linear phase polyphase sinc filter optimized for playing back MQA or MP3 encoded content in order to clean up high frequency noise added by the MQA or MP3 encoding. Also suitable for upsampling PCM sources of 88.2 kHz or higher sampling rate, especially for hires PCM recordings of 176.4 kHz or higher sampling rate. Very short ringing. Early slow roll-off.
- **After:** Linear phase polyphase sinc filter optimized for playing back MQA- or MP3-encoded content in order to clean up high frequency noise added by the MQA or MP3 encoding. Also suitable for upsampling PCM sources of ≥ 88.2 kHz sampling rate, especially for hi-res PCM recordings of ≥ 176.4 kHz sampling rate. Very short ringing. Early slow roll-off.

### poly-sinc-gauss-short
- **Before:** Short Gaussian polyphase sinc filter. Optimal time-frequency response. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Short Gaussian polyphase sinc filter. Optimal time-frequency response.

### poly-sinc-gauss-medium
- **Before:** Gaussian polyphase sinc filter. Optimal time-frequency response. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Gaussian polyphase sinc filter. Optimal time-frequency response.

### poly-sinc-gauss-long
- **Before:** Long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response.

### poly-sinc-gauss-xla
- **Before:** Apodizing extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Apodizing extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response.

### poly-sinc-gauss-xl
- **Before:** Extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Extra long Gaussian polyphase sinc filter with extremely high attenuation. Optimal time-frequency response.

### poly-sinc-gauss-hires-lp
- **Before:** Linear-phase Gaussian filter for HiRes content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.
- **After:** Linear phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.

### poly-sinc-gauss-hires-ip
- **Before:** Intermediate-phase Gaussian filter for HiRes content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.
- **After:** Intermediate phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.

### poly-sinc-gauss-hires-mp
- **Before:** Minimum-phase Gaussian filter for HiRes content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.
- **After:** Minimum phase Gaussian filter for hi-res content with extremely high attenuation. Optimal time-frequency response. Also suitable for playback of lossy compression such as MP3 or MQA.

### poly-sinc-gauss-halfband
- **Before:** Linear-phase halfband Gaussian filter. Slightly leaky around Nyquist, but extremely high attenuation.
- **After:** Linear phase half-band Gaussian filter. Slightly leaky around Nyquist, but extremely high attenuation.

### poly-sinc-gauss-halfband-s
- **Before:** Short linear-phase halfband Gaussian filter. Leaky around Nyquist, but high attenuation.
- **After:** Short linear phase half-band Gaussian filter. Leaky around Nyquist, but high attenuation.

### ASRC
- **Before:** This is a special type of filter, slightly similar to FIR, but with a possibility of asynchronous operation for conversions from any rate to any other rate. Computationally heavy.
- **After:** Special type of filter, slightly similar to FIR, but with a possibility of asynchronous operation for conversions from any rate to any other rate. Computationally heavy.

### polynomial-1
- **Before:** Polynomial interpolation. No apparent pre- or post-ringing. Frequency response rolls off slowly in the top octave. Poor stop-band rejection and will thus leak fairly high amount of ultrasonic distortion. These type of filters are sometimes referred to as "non-ringing" by some manufacturers.
- **After:** Polynomial interpolation. No apparent pre- or post-ringing. Frequency response rolls off slowly in the top octave. Poor stop-band rejection and will thus leak fairly high amount of ultrasonic distortion. These types of filters are sometimes referred to as "non-ringing" by some manufacturers.

### minringFIR-lp
- **Before:** Minimum ringing FIR. Uses a special algorithm to create a linear-phase filter that minimizes ringing while providing better frequency response and attenuation than polynomial interpolators. Performance and ringing between polynomial and poly-sinc-short.
- **After:** Minimum ringing FIR. Uses a special algorithm to create a linear phase filter that minimizes ringing while providing better frequency response and attenuation than polynomial interpolators. Performance and ringing between polynomial and poly-sinc-short.

### sinc-S
- **Before:** sinc-filter with adaptive number of taps. Number of taps is 4096 x conversion ratio. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla.
- **After:** Sinc filter with adaptive number of taps. Number of taps is 4096x conversion ratio. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla.

### sinc-M
- **Before:** sinc-filter with one million taps. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla.
- **After:** Sinc filter with one million taps. Very sharp roll-off and high attenuation. Variant of poly-sinc-ext2-xla.

### sinc-Mx
- **Before:** Constant time version of sinc-M. Filter length is constant in time, with million taps at 16x PCM output rates. Variant of poly-sinc-ext2-xla. (65536 x conversion ratio)
- **After:** Constant time version of sinc-M. Filter length is constant in time, with one million taps at 16x PCM output rates. Variant of poly-sinc-ext2-xla. (65536x conversion ratio)

### sinc-MG
- **Before:** Gaussian constant time filter with million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xl. (65536 x conversion ratio)
- **After:** Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xl. (65536x conversion ratio)

### sinc-MGa
- **Before:** Apodizing Gaussian constant time filter with million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xla. (65536 x conversion ratio)
- **After:** Apodizing Gaussian constant time filter with one million taps at 16x PCM output rates. Extremely high attenuation. Variant of poly-sinc-gauss-xla. (65536x conversion ratio)

### sinc-L
- **Before:** sinc-filter with adaptive number of taps. Number of taps is 131070 x conversion ratio. Extremely sharp roll-off and average attenuation.
- **After:** Sinc filter with adaptive number of taps. Number of taps is 131070x conversion ratio. Extremely sharp roll-off and average attenuation.

### sinc-Ls
- **Before:** Average attenuation sinc-filter with adaptive number of taps (4096 x conversion ratio).
- **After:** Average attenuation sinc filter with adaptive number of taps (4096x conversion ratio).

### sinc-Lm
- **Before:** Average attenuation sinc-filter with adaptive number of taps (16384 x conversion ratio).
- **After:** Average attenuation sinc filter with adaptive number of taps (16384x conversion ratio).

### sinc-Ll
- **Before:** Average attenuation sinc-filter with adaptive number of taps (65536 x conversion ratio).
- **After:** Average attenuation sinc filter with adaptive number of taps (65536x conversion ratio).

### sinc-Lh
- **Before:** High attenuation sinc-filter with adaptive number of taps (16384 x ratio). Significantly better quality than sinc-L at 1/8th of the load.
- **After:** High attenuation sinc filter with adaptive number of taps (16384x ratio). Significantly better quality than sinc-L at 1/8th of the load.

### sinc-short
- **Before:** Short average attenuation sinc-filter with adaptive number of taps. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Short average attenuation sinc filter with adaptive number of taps.

### sinc-medium
- **Before:** Average attenuation sinc-filter with adaptive number of taps. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Average attenuation sinc filter with adaptive number of taps.

### sinc-long
- **Before:** Long average attenuation sinc-filter with adaptive number of taps. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Long average attenuation sinc filter with adaptive number of taps.

### sinc-long-h
- **Before:** Long high attenuation sinc-filter with adaptive number of taps. For SDM outputs, processing is two stages with minimum 16x intermediate rate.
- **After:** Long high attenuation sinc filter with adaptive number of taps.

## settings.json

### High-frequency filter tooltip (junk_filter)
- **Before:** Various playback filters are provided to deal with noise, errors and distortion. For example in bad quality or fake hires source. These filters can be switched at any time during playback. To see their effect on the source, pre-process before metering can be enabled.
- **After:** Various playback filters are provided to deal with noise, errors and distortion. For example in bad quality or fake hi-res source. These filters can be switched at any time during playback. To see their effect on the source, pre-process before metering can be enabled.

### High-frequency filter, option 1
- **Before:** 20 kHz filter is useful for cleaning up fake high-res content when such is observed through metering. It will place a sharp roll-off filter at 20 kHz.
- **After:** 20 kHz filter is useful for cleaning up fake hi-res content when such is observed through metering. It will place a sharp roll-off filter at 20 kHz.

### High-frequency filter, option 2
- **Before:** 30 kHz filter is a slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hires recordings that are for example transfers from analog tape.
- **After:** 30 kHz filter is a slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hi-res recordings that are for example transfers from analog tape.

### High-frequency filter, option 3
- **Before:** 40 kHz filter is a slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hires recordings that are for example transfers from analog tape.
- **After:** 40 kHz filter is a slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hi-res recordings that are for example transfers from analog tape.

### Sigma-delta modulator tooltip (sdm_modulator)
- **Before:** The delta-sigma modulator used to produce SDM output. Fifth order modulators are more suitable for DACs that have simple analog reconstruction filters. Seventh order modulators provide better technical performance, but also put more demands on the DAC's analog reconstruction filter. Typically this means that fifth order modulators suit DACs that have one switching element while seventh order modulators have potential for better performance on DACs that have multi-element switching arrays. DSD* modulators are fixed configuration ones while ASDM* modulators are adaptive in various ways based on source signal. For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal. Options unsuitable for the selected output rate are grayed with the reason.
- **After:** The delta-sigma modulator used to produce SDM output. Fifth order modulators are more suitable for DACs that have simple analog reconstruction filters. Seventh order modulators provide better technical performance, but also put more demands on the DAC's analog reconstruction filter. Typically this means that fifth order modulators suit DACs that have one switching element while seventh order modulators have potential for better performance on DACs that have multi-element switching arrays. DSD* modulators are fixed configuration ones while ASDM* modulators are adaptive in various ways based on source signal. For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal.

### Integrator tooltip (sdm_integrator)
- **Before:** There are three types of delta-sigma integrators available for different SDM → SDM remodulation schemes. These affect mostly frequency and phase response at highest frequencies. Stated frequencies apply for DSD64 source rate, these frequencies scale as function of source sampling rate.
- **After:** Three types of delta-sigma integrators are available for different SDM → SDM remodulation schemes. These affect mostly frequency and phase response at highest frequencies. Stated frequencies apply for DSD64 source rate, and these frequencies scale as a function of source sampling rate.

### Integrator, option 0
- **Before:** Normal IIR type integrator structure. 50 kHz audio bandwidth re DSD64.
- **After:** Normal IIR-type integrator structure. 50 kHz audio bandwidth re DSD64.

### Integrator, option 3
- **Before:** IIR type integrator structure designed to minimize residual noise. 25 kHz audio bandwidth re DSD64.
- **After:** IIR-type integrator structure designed to minimize residual noise. 25 kHz audio bandwidth re DSD64.

### Integrator, option 4
- **Before:** High order IIR type integrator structure. 30 kHz audio bandwidth re DSD64.
- **After:** High-order IIR-type integrator structure. 30 kHz audio bandwidth re DSD64.

### Integrator, option 1
- **Before:** Weighted FIR type integrator structure.
- **After:** Weighted FIR-type integrator structure.

### Integrator, option 5
- **Before:** Weighted FIR type integrator structure. 50 kHz audio bandwidth re DSD64.
- **After:** Weighted FIR-type integrator structure. 50 kHz audio bandwidth re DSD64.

### Integrator, option 6
- **Before:** FIR type integrator structure with band-limiting. 24 kHz audio bandwidth re DSD64 with complete cut by 45 kHz.
- **After:** FIR-type integrator structure with band-limiting. 24 kHz audio bandwidth re DSD64 with complete cut by 45 kHz.

### Integrator, option 7
- **Before:** FIR type integrator structure with brickwall band-limiting. 21.5 kHz audio bandwidth re DSD64 with complete cut by 30 kHz.
- **After:** FIR-type integrator structure with brickwall band-limiting. 21.5 kHz audio bandwidth re DSD64 with complete cut by 30 kHz.

### Integrator, option 2
- **Before:** Cascade comb type integrator structure.
- **After:** Cascade comb-type integrator structure.

### SDM → SDM conversion tooltip (sdm_conversion)
- **Before:** There are different options for SDM → SDM rate conversions. These affect frequency aperture that is assumed to contain useful signal in addition to increasing noise shaping noise. For example piano doesn't contain high frequency harmonics and for such case "narrow" is suitable, while close miked percussions usually contain high level high frequency content and there "wide" may be more suitable. While "XFi" is suitable for all cases. Default is "XFi".
- **After:** Different options for SDM → SDM rate conversions. These affect frequency aperture that is assumed to contain useful signal in addition to increasing noise-shaping noise. For example, piano doesn't contain high frequency harmonics and for such case "narrow" is suitable, while close-miked percussions usually contain high level high frequency content and there "wide" may be more suitable, whereas "XFi" is suitable for all cases. Default is "XFi".

### Noise filter tooltip (pdm_filter)
- **Before:** Different types of noise filters are provided for the PCM output of DSD/SDM sources. These reduce amount of ultrasonic noise present in the source data. Standard filtering leaves low level of ultrasonic noise. Some loudspeakers with tweeters of low power handling capability can be sensitive to this noise, especially when higher listening volumes are used. Also some poorly designed, or class-D, amplifiers can misbehave in presence of such ultrasonic content. Therefore more aggressive noise filters can be selected. These filters will also limit bandwidth available for the audio content. When processing output rate of DSD source (assuming DSD64) is 88.2/96 kHz PCM, use of extra noise filtering in addition to "standard" is less important, since most of the noise will be cut out. When processing output rate of DSDIFF or DSF source is 44.1/48 kHz, extra noise filtering in addition to "standard" is not needed and will actually just reduce playback quality.
- **After:** Different types of noise filters are provided for the PCM output of DSD/SDM sources. These reduce amount of ultrasonic noise present in the source data. Standard filtering leaves low level of ultrasonic noise. Some loudspeakers with tweeters of low power-handling capability can be sensitive to this noise, especially when higher listening volumes are used. Also some poorly designed, or class-D, amplifiers can misbehave in presence of such ultrasonic content. Therefore more aggressive noise filters can be selected. These filters will also limit bandwidth available for the audio content. When processing output rate of DSD source (assuming DSD64) is 88.2/96 kHz PCM, use of extra noise filtering in addition to "standard" is less important, since most of the noise will be cut out. When processing output rate of DSDIFF or DSF source is 44.1/48 kHz, extra noise filtering in addition to "standard" is not needed and will actually just reduce playback quality.

### Noise filter, option 10
- **Before:** High order noise filter designed for material created with high order modulators. Recommended.
- **After:** High-order noise filter designed for material created with high-order modulators. Recommended.

### Noise filter, option 11
- **Before:** Weighted element converter. Optimized to closely match DSD/SACD specification. Non-ringing linear-phase. Recommended.
- **After:** Weighted element converter. Optimized to closely match DSD/SACD specification. Non-ringing linear phase. Recommended.

### Noise filter, option 2
- **Before:** Slow roll-off linear-phase filter.
- **After:** Slow roll-off linear phase filter.

### Noise filter, option 3
- **Before:** Slow roll-off minimum-phase filter.
- **After:** Slow roll-off minimum phase filter.

### Noise filter, option 12
- **Before:** Medium roll-off linear-phase filter designed to be as gentle as possible while passing minimal amount of out-of-band noise. Recommended.
- **After:** Medium roll-off linear phase filter designed to be as gentle as possible while passing minimal amount of out-of-band noise. Recommended.

### Noise filter, option 6
- **Before:** Medium roll-off high rate linear-phase filter designed to be as gentle as possible while passing minimal amount of out-of-band noise. Use this instead of "medium" when "none" is selected as PCM Conversion. Recommended.
- **After:** Medium roll-off high-rate linear phase filter designed to be as gentle as possible while passing minimal amount of out-of-band noise. Use this instead of "medium" when "none" is selected as PCM Conversion (Decimation filter). Recommended.

### Noise filter, option 4
- **Before:** Fast roll-off linear-phase filter.
- **After:** Fast roll-off linear phase filter.

### Noise filter, option 5
- **Before:** Fast roll-off minimum-phase filter.
- **After:** Fast roll-off minimum phase filter.

### SDM → PCM conversion tooltip (pdm_conversion)
- **Before:** These settings control DSD to PCM conversion algorithms. Type of SDM → PCM conversion can be selected from the following conversion types.
- **After:** These settings control DSD to PCM conversion algorithms.

### SDM → PCM conversion, option 3
- **Before:** Linear-phase single-pass conversion algorithm.
- **After:** Linear phase single-pass conversion algorithm.

### SDM → PCM conversion, option 4
- **Before:** Minimum-phase single-pass conversion algorithm.
- **After:** Minimum phase single-pass conversion algorithm.

### SDM → PCM conversion, option 5
- **Before:** Linear-phase slow roll-off single-pass conversion algorithm. Recommended.
- **After:** Linear phase slow roll-off single-pass conversion algorithm. Recommended.

### SDM → PCM conversion, option 6
- **Before:** Minimum-phase slow roll-off single-pass conversion algorithm.
- **After:** Minimum phase slow roll-off single-pass conversion algorithm.

### SDM → PCM conversion, option 7
- **Before:** Linear-phase extreme roll-off and attenuation single-pass conversion algorithm.
- **After:** Linear phase extreme roll-off and attenuation single-pass conversion algorithm.

### SDM → PCM conversion, option 11
- **Before:** Linear-phase extreme roll-off and attenuation single-pass conversion algorithm.
- **After:** Linear phase extreme roll-off and attenuation single-pass conversion algorithm.

### SDM → PCM conversion, option 8
- **Before:** Linear-phase extended frequency response sharp roll-off and high attenuation single-pass conversion algorithm.
- **After:** Linear phase extended frequency response sharp roll-off and high attenuation single-pass conversion algorithm.

### SDM → PCM conversion, option 9
- **Before:** Linear-phase million-tap sharp roll-off and high attenuation single pass conversion algorithm.
- **After:** Linear phase million-tap sharp roll-off and high attenuation single-pass conversion algorithm.

### SDM → PCM conversion, option 10
- **Before:** Linear-phase adaptive length sharp roll-off and high attenuation single pass conversion algorithm.
- **After:** Linear phase adaptive length sharp roll-off and high attenuation single-pass conversion algorithm.

### SDM → PCM conversion, option 12
- **Before:** Linear-phase Gaussian extremely high attenuation single-pass conversion algorithm. Optimal time-frequency response.
- **After:** Linear phase Gaussian extremely high attenuation single-pass conversion algorithm. Optimal time-frequency response.

## shapers.json

### DSD5v2 256+fs
- **Before:** Revised fifth order one-bit delta-sigma modulator optimized for rates >= 10.24 MHz.
- **After:** Revised fifth order one-bit delta-sigma modulator optimized for rates ≥ 10.24 MHz.

### ASDM5EC-ul 512+fs
- **Before:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Ultralight version.
- **After:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Ultralight version.

### ASDM5EC-light 512+fs
- **Before:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Light version.
- **After:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Light version.

### ASDM5EC-fast 512+fs
- **Before:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Transient and load optimized version.
- **After:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Transient and load optimized version.

### ASDM5EC-super 512+fs
- **Before:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Super version.
- **After:** Adaptive fifth order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Super version.

### DSD7 256+fs
- **Before:** Seventh order one-bit delta-sigma modulator optimized for rates >= 10.24 MHz.
- **After:** Seventh order one-bit delta-sigma modulator optimized for rates ≥ 10.24 MHz.

### ASDM7EC-ul 512+fs
- **Before:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Ultralight version.
- **After:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Ultralight version.

### ASDM7EC-light 512+fs
- **Before:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Light version.
- **After:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Light version.

### ASDM7EC-fast 512+fs
- **Before:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Transient and load optimized version.
- **After:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Transient and load optimized version.

### ASDM7EC-super 512+fs
- **Before:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for 512x and higher rates. Super version.
- **After:** Adaptive seventh order one-bit delta-sigma modulator with extended compensation. Optimized for rates ≥ 512x. Super version.

### AMSDM7 512+fs
- **Before:** Special adaptive seventh order "pseudo-multi-bit" modulator optimized for rates above >= 20.48 MHz.
- **After:** Special adaptive seventh order "pseudo-multi-bit" modulator optimized for rates ≥ 20.48 MHz.

### AMSDM7EC 512+fs
- **Before:** Special adaptive seventh order "pseudo-multi-bit" modulator with extended compensation for rates >= 20.48 MHz.
- **After:** Special adaptive seventh order "pseudo-multi-bit" modulator with extended compensation for rates ≥ 20.48 MHz.

### AHM5EC5L
- **Before:** Experimental fifth order five level hybrid modulator with extended compensation. Optimized for rates >= 40.96 MHz.
- **After:** Experimental fifth order five level hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz.

### AHM7EC5L
- **Before:** Experimental seventh order five level hybrid modulator with extended compensation. Optimized for rates >= 40.96 MHz.
- **After:** Experimental seventh order five level hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz.

### AHM5EC8B
- **Before:** Fifth order 8-bit hybrid modulator with extended compensation. Optimized for rates >= 40.96 MHz. Bandwidth optimized to provide enough flat noise floor bandwidth for practically all hires content.
- **After:** Fifth order 8-bit hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz. Bandwidth optimized to provide enough flat noise floor bandwidth for practically all hi-res content.

### AHM7EC8B
- **Before:** Seventh order 8-bit hybrid modulator with extended compensation. Optimized for rates >= 40.96 MHz. Bandwidth optimized to provide enough flat noise floor bandwidth for practically all hires content.
- **After:** Seventh order 8-bit hybrid modulator with extended compensation. Optimized for rates ≥ 40.96 MHz. Bandwidth optimized to provide enough flat noise floor bandwidth for practically all hi-res content.

### NS1
- **Before:** Simple first order noise-shaping. Sample values are rounded and the quantization error is shaped such way that the error energy is pushed to the higher frequencies. Suitable mostly for 176.4/192 kHz upsampling.
- **After:** Simple first order noise-shaping. Sample values are rounded and the quantization error is shaped in such a way that the error energy is pushed to the higher frequencies. Suitable mostly for 176.4/192 kHz upsampling.

### NS4
- **Before:** Fourth order noise-shaping. Similar in shape as "shaped" dither. Suitable for all rates equal or higher than 88.2 kHz.
- **After:** Fourth order noise-shaping. Similar in shape to the "shaped" dither. Suitable for all rates ≥ 88.2 kHz.

### NS9 notes
- **Before:** Especially good for older 16-bit 4x rate capable multibit-DACs like TDA154x etc.
- **After:** Especially good for older 16-bit 4x-rate-capable multibit-DACs like TDA154x etc.

### LNS15
- **Before:** 15th order linear noise shaping. Smooth noise-shaping slope designed especially for 16x rates (705.6/768 kHz) and recommended for these higher PCM rates. Can be also used at 8x rates (352.8/384 kHz), but not recommended for rates below.
- **After:** 15th order linear noise-shaping. Smooth noise-shaping slope designed especially for 16x rates (705.6/768 kHz) and recommended for these higher PCM rates. Can be also used at 8x rates (352.8/384 kHz), but not recommended for rates below.

### Gauss1
- **Before:** Gaussian Probability Density Function. High quality flat frequency dither recommended for rates at or below 96 kHz where noise-shaping is not suitable.
- **After:** Gaussian Probability Density Function. High quality flat frequency dither recommended for rates ≤ 96 kHz where noise-shaping is not suitable.

### shaped
- **Before:** Shaped dither. Noise used in this dither has shaped frequency distribution to lower audibility of the dither noise. Suitable for playback rates of 88.2/96 kHz, or higher.
- **After:** Shaped dither. Noise used in this dither has shaped frequency distribution to lower audibility of the dither noise. Suitable for playback rates ≥ 88.2/96 kHz.

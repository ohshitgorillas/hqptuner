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
- **After:** Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A really steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Small amount of passband ripple is also present. Medium attenuation. The IIR filter is applied in the time domain.

### IIR2
- **Before:** This is analog-sounding filter, especially suitable for recordings containing strong transients, long post-ringing is a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing, but has a long post-ringing. Medium attenuation. No passband ripple. IIR filter is applied in time domain.
- **After:** Analog-sounding filter especially suitable for recordings containing strong transients, with long post-ringing as a side effect (not usually audible due to masking). A steep IIR filter is used. This filter type is similar to analog filters and has no pre-ringing but long post-ringing. Medium attenuation. No passband ripple. The IIR filter is applied in the time domain.

### FIR
- **Before:** Typical "oversampling" digital filter, generally suitable for most uses (slight pre- and post-ringing), but best on classical music recorded in a real world acoustic environment such as concert hall. This is the most ordinary filter type, usually present in hardware. This filter is applied in time-domain. It has average amount of pre- and post-ringing.
- **After:** Typical "oversampling" digital filter, generally suitable for most uses (slight pre- and post-ringing), but best on classical music recorded in a real-world acoustic environment such as a concert hall. This is the most ordinary filter type, usually present in hardware. This filter is applied in the time domain. Average amount of pre- and post-ringing.

### FFT
- **Before:** Technically good steep "brickwall" filter, but might have some side effects (pre-ringing) on material containing strong transients. This filter is similar to FIR, but it is applied in frequency-domain and is quite efficient from performance point of view while having rather long impulse response. Length of this filter can be configured separately in the FFT filter length setting.
- **After:** Technically good steep "brickwall" filter, but might have some side effects (pre-ringing) on material containing strong transients. This filter is similar to FIR, but it is applied in the frequency domain and is quite efficient from a performance point of view while having a rather long impulse response. The length of this filter can be configured separately in the FFT filter length setting.

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
- **After:** Polynomial interpolation. No apparent pre- or post-ringing. Frequency response rolls off slowly in the top octave. Poor stop-band rejection and will thus leak a fairly high amount of ultrasonic distortion. These types of filters are sometimes referred to as "non-ringing" by some manufacturers.

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
- **After:** Various playback filters are provided to deal with noise, errors, and distortion, for example in bad quality or fake hi-res sources. These filters can be switched at any time during playback. To see their effect on the source, pre-process before metering can be enabled.

### High-frequency filter, option 1
- **Before:** 20 kHz filter is useful for cleaning up fake high-res content when such is observed through metering. It will place a sharp roll-off filter at 20 kHz.
- **After:** Useful for cleaning up fake hi-res content when such is observed through metering. It will place a sharp roll-off filter at 20 kHz.

### High-frequency filter, option 2
- **Before:** 30 kHz filter is a slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hires recordings that are for example transfers from analog tape.
- **After:** Slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hi-res recordings that are, for example, transfers from analog tape.

### High-frequency filter, option 3
- **Before:** 40 kHz filter is a slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hires recordings that are for example transfers from analog tape.
- **After:** Slow roll-off filter for removing high frequency disturbances unrelated to the music, while keeping optimal transient response. This can be used for certain hi-res recordings that are, for example, transfers from analog tape.

### High-frequency filter, option 4
- **Before:** 50 kHz filter is a very slow roll-off filter for cleaning out for example excessive noise shaping from certain ADCs and DSD to PCM conversions.
- **After:** Very slow roll-off filter for cleaning out, for example, excessive noise shaping from certain ADCs and DSD to PCM conversions.

### Output mode tooltip
- **Before:** Selects default output mode. When set to "PCM", all content is played as PCM output. When "SDM (DSD)" is selected, all content is played as SDM output. When "[source]" is selected, PCM content is played as PCM and DSD content is played as SDM. However, using "[source]" usually leads to sub-optimal result with either format since only very few DACs have separate true PCM (R2R) and SDM conversion sections inside. In most cases only either one of the options is optimal for the DAC.
- **After:** Selects the output mode. When set to "PCM", all content is played as PCM output. When "SDM (DSD)" is selected, all content is played as SDM output. When "Auto" is selected, PCM content is played as PCM and DSD content is played as SDM. Using "Auto", however, usually leads to a sub-optimal result with either format since only very few DACs have separate true PCM (R2R) and SDM conversion sections inside. In most cases, only one of the options is optimal for the DAC.

### Backend tooltip
- **Before:** Specifies type of output device. ALSA uses an ALSA hardware device. Network uses a Signalyst Network Audio Adapter — for Network Audio driver type, a list of remote audio devices is shown. Combo holds a set of sub-elements of type "alsa" and/or type "network"; these form a combined output device with as many channels as sum of channels of the sub-elements, and channel mapping follows order of the sub-devices.
- **After:** Specifies the type of output device. ALSA uses an ALSA hardware device. Network uses a Signalyst Network Audio Adapter — for the Network Audio driver type, a list of remote audio devices is shown. Combo holds a set of sub-elements of type "alsa" and/or type "network"; these form a combined output device with as many channels as the sum of the channels of the sub-elements, and channel mapping follows the order of the sub-devices.

### UPnP freewheel tooltip
- **Before:** For UPnP controlled sources, freewheel can be enabled. This allows the entire track to be (pre-)fetched to memory at full network speed, when track size is known. This can add increased resource load spike when fetch happens. It also has memory usage implications.
- **After:** Allows the entire track to be (pre-)fetched to memory at full network speed when the track size is known. This can cause a resource load spike when the fetch happens. It also has memory usage implications.

### Quick pause tooltip
- **Before:** Quick pause changes pause operation to play only basic silence pattern. In some cases this reduces delay when pressing pause. But can cause audible glitches especially when DAC is directly connected to a power amp without intermediate analog volume control.
- **After:** Changes the pause operation to play a basic silence pattern. In some cases, this reduces the delay when pressing pause, but it can cause audible glitches, especially when the DAC is directly connected to a power amp without intermediate volume control.

### Short buffer tooltip
- **Before:** Set length of FIFO (normal / short / minimum) for faster control responses. This reduces amount of delay for example for volume control. But it also increases likelihood of audio drop-outs.
- **After:** Length of the FIFO (first in, first out buffer) to adjust control responses. This reduces the amount of delay for volume control, for example, but also increases the likelihood of audio drop-outs.

### Channels tooltip
- **Before:** Number of output channels, possible choices range from "2" for stereo to 128 output channels, primarily for complex matrix processing cases.
- **After:** Number of output channels; choices range from "2" for stereo to 128 output channels, primarily for complex matrix processing cases.

### DSP pipelines tooltip
- **Before:** Specify number of DSP pipelines available. This is both number of matrix pipelines, and total number of possible input or output channels. At least maximum number of source or output channels. Using suitably low value reduces resource consumption, such as RAM usage to some extent.
- **After:** Number of DSP pipelines available. This sets the number of matrix pipelines, which is also the maximum number of input or output channels, so it must be at least the larger of the source channel count and the output channel count. Using a suitably low value reduces resource consumption, such as RAM usage, to some extent.

### FFT filter length tooltip
- **Before:** This option specifies length of the FFT filter. Default value is 512. Length affects steepness of the filter, shorter lengths result in slower (gentler) roll-off, while higher lengths result in faster (steeper) roll-off. This setting is per each 2x cascade filter, thus it is not conversion ratio dependent. Only applies when an FFT-family filter is selected.
- **After:** Length of the FFT filter. Default value is 512. Length affects the steepness of the filter: shorter lengths result in slower (gentler) roll-off, while higher lengths result in faster (steeper) roll-off. This setting is per each 2x cascade filter, so it is not conversion ratio dependent. Only applies when an FFT-family filter is selected.

### Sigma-delta modulator tooltip (sdm_modulator)
- **Before:** The delta-sigma modulator used to produce SDM output. Fifth order modulators are more suitable for DACs that have simple analog reconstruction filters. Seventh order modulators provide better technical performance, but also put more demands on the DAC's analog reconstruction filter. Typically this means that fifth order modulators suit DACs that have one switching element while seventh order modulators have potential for better performance on DACs that have multi-element switching arrays. DSD* modulators are fixed configuration ones while ASDM* modulators are adaptive in various ways based on source signal. For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal. Options unsuitable for the selected output rate are grayed with the reason.
- **After:** The delta-sigma modulator used to produce SDM output. Fifth order modulators are more suitable for DACs that have simple analog reconstruction filters. Seventh order modulators provide better technical performance, but also put more demands on the DAC's analog reconstruction filter. Typically this means that fifth order modulators suit DACs that have one switching element while seventh order modulators have the potential for better performance on DACs that have multi-element switching arrays. DSD* modulators are fixed configuration ones while ASDM* modulators are adaptive in various ways based on the source signal. For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal.

### Integrator tooltip (sdm_integrator)
- **Before:** There are three types of delta-sigma integrators available for different SDM → SDM remodulation schemes. These affect mostly frequency and phase response at highest frequencies. Stated frequencies apply for DSD64 source rate, these frequencies scale as function of source sampling rate.
- **After:** Three types of delta-sigma integrators are available for different SDM → SDM remodulation schemes. These affect mostly the frequency and phase response at the highest frequencies. Stated frequencies apply for the DSD64 source rate, and these frequencies scale as a function of the source sampling rate.

### Integrator, option 0
- **Before:** Normal IIR type integrator structure. 50 kHz audio bandwidth re DSD64.
- **After:** Normal IIR-type integrator structure. 50 kHz audio bandwidth re: DSD64.

### Integrator, option 3
- **Before:** IIR type integrator structure designed to minimize residual noise. 25 kHz audio bandwidth re DSD64.
- **After:** IIR-type integrator structure designed to minimize residual noise. 25 kHz audio bandwidth re: DSD64.

### Integrator, option 4
- **Before:** High order IIR type integrator structure. 30 kHz audio bandwidth re DSD64.
- **After:** High-order IIR-type integrator structure. 30 kHz audio bandwidth re: DSD64.

### Integrator, option 1
- **Before:** Weighted FIR type integrator structure.
- **After:** Weighted FIR-type integrator structure.

### Integrator, option 5
- **Before:** Weighted FIR type integrator structure. 50 kHz audio bandwidth re DSD64.
- **After:** Weighted FIR-type integrator structure. 50 kHz audio bandwidth re: DSD64.

### Integrator, option 6
- **Before:** FIR type integrator structure with band-limiting. 24 kHz audio bandwidth re DSD64 with complete cut by 45 kHz.
- **After:** FIR-type integrator structure with band-limiting. 24 kHz audio bandwidth re: DSD64 with complete cut by 45 kHz.

### Integrator, option 7
- **Before:** FIR type integrator structure with brickwall band-limiting. 21.5 kHz audio bandwidth re DSD64 with complete cut by 30 kHz.
- **After:** FIR-type integrator structure with brickwall band-limiting. 21.5 kHz audio bandwidth re: DSD64 with complete cut by 30 kHz.

### Integrator, option 2
- **Before:** Cascade comb type integrator structure.
- **After:** Cascade comb-type integrator structure.

### SDM → SDM conversion tooltip (sdm_conversion)
- **Before:** There are different options for SDM → SDM rate conversions. These affect frequency aperture that is assumed to contain useful signal in addition to increasing noise shaping noise. For example piano doesn't contain high frequency harmonics and for such case "narrow" is suitable, while close miked percussions usually contain high level high frequency content and there "wide" may be more suitable. While "XFi" is suitable for all cases. Default is "XFi".
- **After:** Different options for SDM → SDM rate conversions. These affect the frequency aperture that is assumed to contain a useful signal in addition to increasing noise-shaping noise. For example, piano doesn't contain high-frequency harmonics; for such a case, "narrow" is suitable. Close-miked percussion usually contains high level high-frequency content so that "wide" may be more suitable. "XFi" is suitable for all cases and is the default.

### Noise filter tooltip (pdm_filter)
- **Before:** Different types of noise filters are provided for the PCM output of DSD/SDM sources. These reduce amount of ultrasonic noise present in the source data. Standard filtering leaves low level of ultrasonic noise. Some loudspeakers with tweeters of low power handling capability can be sensitive to this noise, especially when higher listening volumes are used. Also some poorly designed, or class-D, amplifiers can misbehave in presence of such ultrasonic content. Therefore more aggressive noise filters can be selected. These filters will also limit bandwidth available for the audio content. When processing output rate of DSD source (assuming DSD64) is 88.2/96 kHz PCM, use of extra noise filtering in addition to "standard" is less important, since most of the noise will be cut out. When processing output rate of DSDIFF or DSF source is 44.1/48 kHz, extra noise filtering in addition to "standard" is not needed and will actually just reduce playback quality.
- **After:** Different types of noise filters for PCM output of DSD/SDM sources. These reduce the amount of ultrasonic noise present in the source data. Standard filtering leaves a low level of ultrasonic noise. Some loudspeakers with tweeters of low power-handling capability can be sensitive to this noise, especially when higher listening volumes are used. Also some poorly designed, or class-D, amplifiers can misbehave in the presence of such ultrasonic content. More aggressive noise filters can therefore be selected. These filters will also limit the bandwidth available for the audio content. When the processing output rate of a DSD source (assuming DSD64) is 88.2/96 kHz PCM, the use of extra noise filtering in addition to "standard" is less important, since most of the noise will be cut out. When the processing output rate of a DSDIFF or DSF source is 44.1/48 kHz, extra noise filtering in addition to "standard" is not needed and will reduce playback quality.

### Noise filter, option 1
- **Before:** Similar to standard, but has lower corner frequency and results in almost flat noise profile in ultrasonic range. Recommended.
- **After:** Similar to standard, but has a lower corner frequency and results in an almost flat noise profile in the ultrasonic range. Recommended.

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
- **After:** Medium roll-off linear phase filter designed to be as gentle as possible while passing a minimal amount of out-of-band noise. Recommended.

### Noise filter, option 6
- **Before:** Medium roll-off high rate linear-phase filter designed to be as gentle as possible while passing minimal amount of out-of-band noise. Use this instead of "medium" when "none" is selected as PCM Conversion. Recommended.
- **After:** Medium roll-off high-rate linear phase filter designed to be as gentle as possible while passing a minimal amount of out-of-band noise. Use this instead of "medium" when "none" is selected as PCM Conversion (Decimation filter). Recommended.

### Noise filter, option 4
- **Before:** Fast roll-off linear-phase filter.
- **After:** Fast roll-off linear phase filter.

### Noise filter, option 5
- **Before:** Fast roll-off minimum-phase filter.
- **After:** Fast roll-off minimum phase filter.

### SDM → PCM conversion tooltip (pdm_conversion)
- **Before:** These settings control DSD to PCM conversion algorithms. Type of SDM → PCM conversion can be selected from the following conversion types.
- **After:** These settings control DSD to PCM conversion algorithms.

### SDM → PCM conversion, option 0
- **Before:** Traditional recursive conversion algorithm. Minimizes amount of ringing by using slow roll-off filters.
- **After:** Traditional recursive conversion algorithm. Minimizes the amount of ringing by using slow roll-off filters.

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

### SDM → PCM conversion, option 254
- **Before:** No decimation, intermediate output rate is equal to source DSD rate.
- **After:** No decimation; intermediate output rate is equal to the source DSD rate.

### Output device tooltip
- **Before:** A list of remote audio devices is shown. This always combination of the NAA device plus the hardware device ID.
- **After:** A list of remote audio devices is shown. This is always a combination of the NAA device plus the hardware device ID.

### DAC bits tooltip
- **Before:** Number significant bits the DAC has, this is the dithering level; 0 auto-detects. When DAC is connected to a unidirectional interface like S/PDIF, AES/EBU or I2S it is important to select correct number of bits. In addition, when a DAC is connected to USB and has something else than 32-bit input resolution, it is recommended to set the actual value here. Also when a suitable noise-shaper, such as LNS15, NS9 or NS5 is used in combination with high output rates, linearity errors inherent to all R2R DACs can be corrected. This will lower distortion of especially low level signals and reduce zero-crossing distortions.
- **After:** Number of significant bits the DAC has; this is the dithering level. 0 auto-detects. When the DAC is connected to a unidirectional interface like S/PDIF, AES/EBU or I2S, it is important to select the correct number of bits. In addition, when a DAC is connected to USB and has something other than 32-bit input resolution, it is recommended to set the actual value here. Also, when a suitable noise-shaper, such as LNS15, NS9 or NS5, is used in combination with high output rates, linearity errors inherent to all R2R DACs can be corrected. This will lower the distortion of especially low-level signals and reduce zero-crossing distortions.

### Apodizing tooltip
- **Before:** The need for an apodizing filter is based on detected errors that originate from the recording ADC or mastering tools. Apodizing filter should be used at least when "Apod" counter increments to higher than 10 during any single track. There is no harm in using apodizing filter for content that doesn't need one. But there is harm using non-apodizing filter for content that would need one.
- **After:** The need for an apodizing filter is based on detected errors that originate from the recording ADC or mastering tools. Apodizing filters should be used at least when the "Apod" counter increments to higher than 10 during any single track. There is no harm in using an apodizing filter for content that doesn't need one, but there is harm in using non-apodizing filters for content that would need one.

### Matrix processing tooltip
- **Before:** Matrix processing offers a way to copy, route, filter and mix down channels with specified gains. Matrix processing consists of maximum 128 virtual channels – pipelines, number of active pipelines can be configured through advanced settings. Note! It is not recommended have both simple convolution engine and matrix processor active simultaneously. If convolution is needed with matrix processing, it is recommended to configure convolution here.
- **After:** Matrix processing offers a way to copy, route, filter and mix down channels with specified gains. Matrix processing consists of a maximum of 128 virtual channels (pipelines); the number of active pipelines can be configured through advanced settings. Note! It is not recommended to have both the simple convolution engine and the matrix processor active simultaneously. If convolution is needed with matrix processing, it is recommended to configure convolution here.

### Engine, option 0
- **Before:** Overlap-save, which is alternative method.
- **After:** Overlap-save, which is an alternative method.

### IIR to FIR tooltip
- **Before:** Using the IIR to FIR it is possible to choose whether parametric EQs are converted to a convolution EQ. In some cases, like GPU offloading, it may be more efficient to compute set of parametric EQs as a convolution filter instead.
- **After:** Using IIR to FIR, it is possible to choose whether parametric EQs are converted to a convolution EQ. In some cases, like GPU offloading, it may be more efficient to compute a set of parametric EQs as a convolution filter instead.

### IIR to FIR, option 2
- **Before:** The EQ filter is converted to a linear phase one. Note! Conversion to linear phase will introduce some amount of unnatural pre-ringing in the audio band. This is why EQ filters are typically minimum-phase. Higher the parametric filter's Q and dB values are, more pre-ringing it will also introduce for linear-phase. So the linear phase conversion works best with rather gentle EQ setups.
- **After:** The EQ filter is converted to linear phase. Note! Conversion to linear phase will introduce some amount of unnatural pre-ringing in the audio band. This is why EQ filters are typically minimum phase. The higher the parametric filter's Q and dB values are, the more pre-ringing it will also introduce for linear phase. Therefore, the linear phase conversion works best with rather gentle EQ setups.

### Bauer crossfeed tooltip
- **Before:** Bauer cross-feed is processing for headphones that is intended to make the listening experience more natural and spacious. This is very simple model, with three presets. Applied to the output mix bus, meaning output channels after the matrix processing.
- **After:** Bauer cross-feed is processing for headphones, intended to make the listening experience more natural and spacious. This is a very simple model with three presets. Applied to the output mix bus, meaning output channels after matrix processing.

### DAC correction tooltip
- **Before:** Correction performs corrections for the output signal of selected DAC. These corrections are specific to a DAC model and output rate. When Combo-backend is used, there may be multiple corrections available for each corresponding DAC. Applied to the output mix bus, meaning output channels after the matrix processing.
- **After:** Correction performs corrections for the output signal of selected DAC. These corrections are specific to a DAC model and output rate. When Combo-backend is used, there may be multiple corrections available for each corresponding DAC. Applied to the output mix bus, meaning output channels after matrix processing.

### Loudness tooltip
- **Before:** Loudness is a volume-adaptive loudness control with adjustable parameters. For bass and treble controls, the corner frequency, slope factor (see IIR plugin) and level can be adjusted. Lower bound is volume setting where at or below, set maximum loudness value is reached. Higher bound is volume setting where at and above, loudness value reaches 0 dB. Applied to the output mix bus, meaning output channels after the matrix processing.
- **After:** Volume-adaptive loudness control with adjustable parameters. For bass and treble, the corner frequency, slope factor (see IIR plugin), and level can be adjusted. Lower bound is the volume setting where, at or below, the maximum loudness value is reached. Upper bound is the volume setting where, at or above, the loudness value reaches 0 dB. Applied to the output mix bus, meaning output channels after matrix processing.

### Bass steepness / Q tooltip
- **Before:** Bass adjustment slope factor. See the IIR plugin: s is factor (1 maximum steepness).
- **After:** Bass adjustment slope factor. See the IIR plugin: s is the factor (1 = maximum steepness).

### Treble steepness / Q tooltip
- **Before:** Treble adjustment slope factor. See the IIR plugin: s is factor (1 maximum steepness).
- **After:** Treble adjustment slope factor. See the IIR plugin: s is the factor (1 = maximum steepness).

### Range lower bound tooltip
- **Before:** Loudness range lower bound at which maximum level is reached — volume setting where at or below, set maximum loudness value is reached.
- **After:** The volume setting where, at or below, the maximum loudness value is reached.

### Range upper bound tooltip
- **Before:** Loudness range higher bound at which minimum level is reached — volume setting where at and above, loudness value reaches 0 dB.
- **After:** The volume setting where, at or above, the loudness value reaches 0 dB.

### Auto headroom tooltip
- **Before:** Enables special fixed volume with optimized level setting that has enough headroom for most typical inter-sample overs. This is recommended setting when HQPlayer's digital volume control is not needed due to use of some external volume control method. The -3 dB setting puts volume at roughly -3 dB, the -6 dB setting at roughly -6 dB. -6 dB setting is good for music content where normal -3 dB doesn't provide enough headroom, such as heavily clipped content.
- **After:** Enables a special fixed volume with an optimized level setting that has enough headroom for most typical inter-sample overs. This is a recommended setting when HQPlayer's digital volume control is not needed due to the use of some external volume control method. The -3 dB setting puts the volume at roughly -3 dB; the -6 dB setting at roughly -6 dB. The -6 dB setting is good for music content where the normal -3 dB setting doesn't provide enough headroom, such as heavily clipped content.

### Engine tooltip (matrix_engine)

- **Before:** Convolution engine applicable to filter(s) defined in Process, can be selected from two choices.
- **After:** Convolution engine used for the filter(s) defined in Process.

### Expand HF tooltip

- **Before:** For filters using low sampling rate, frequency response of the filter can be extended beyond Nyquist frequency of the filter's sampling rate by selecting Expand HF. When choosing format for convolution filters, for most optimal case for all kinds of source material, use extended frequency response convolution filters with 352.8 kHz sampling rate. When such are used, Expand HF can be left disabled for all cases.
- **After:** For filters using a low sampling rate, the frequency response of the filter can be extended beyond the Nyquist frequency of the filter's sampling rate by selecting Expand HF. When choosing a format for convolution filters, extended frequency response convolution filters with a 352.8 kHz sampling rate are optimal for all kinds of source material. When such filters are used, Expand HF can be left disabled.

### Pipelines tooltip (matrix_pipelines)

- **Before:** Description of a virtual channel / processing pipeline. The "Source Ch" specifies the channel which is used as a source for the virtual channel. "Gain" is overall gain applied for the virtual channel. And "Mix Ch" is the logical output channel. When multiple virtual channels have the same target channel, outputs of the virtual channels are mixed together to the target output channel. "Process" can define external filter impulse response(s) WAV file for convolution, parametric equalizer specification in RoomEqWizard text output format, and parametric filter specifications. Gain can be applied in both dB scale or linear scale, as selected in the corresponding column. Linear scale factors can be also negative to perform phase inversion, this allows for example M/S processing. Distinct from DSP pipelines, which sets how many are available.
- **After:** Description of a virtual channel / processing pipeline. "Source Ch" specifies the channel used as the source for the virtual channel. "Gain" is the overall gain applied to the virtual channel, and "Mix Ch" is the logical output channel. When multiple virtual channels have the same target channel, the outputs of the virtual channels are mixed together to the target output channel. "Process" can define external filter impulse response WAV file(s) for convolution, a parametric equalizer specification in RoomEqWizard text output format, and parametric filter specifications. Gain can be applied in either dB scale or linear scale, as selected in the corresponding column. Linear scale factors can also be negative to perform phase inversion; this allows, for example, M/S processing. Distinct from DSP pipelines, which sets how many are available.

### DAC correction tooltip (revised)

- **Before:** Correction performs corrections for the output signal of selected DAC. These corrections are specific to a DAC model and output rate. When Combo-backend is used, there may be multiple corrections available for each corresponding DAC. Applied to the output mix bus, meaning output channels after matrix processing.
- **After:** Performs corrections for the output signal of the selected DAC. These corrections are specific to a DAC model and output rate. When the Combo backend is used, there may be multiple corrections available, one for each sub-device's DAC. Applied to the output mix bus, meaning output channels after matrix processing.

### DSD playback tooltip (direct_sdm)

- **Before:** DirectSDM setting disables all processing when source is DSD content and output format is SDM to a DSD-device or file. Note! Enabling DirectSDM will disable volume control and set PCM volume to fixed -3 dBFS value.
- **After:** Direct playback disables all processing when the source is DSD content and the output is SDM to a DSD device or file. Note! Direct playback will disable volume control and set PCM volume to a fixed -3 dBFS value.

### Fixed volume level tooltip

- **Before:** Fixed volume setting, in dBFS. When using any resampling, maximum recommended volume level is -3 dBFS to avoid inter-sample overloads, and in case material contains digital clipping/limiting. Note! High oversampling ratios can generate high inter-sample overs. Overloading the delta-sigma modulator in SDM mode will also cause audible noises. It is therefore recommended to keep software volume at max -3 dB setting or lower when using PCM to SDM conversion to avoid overloads, especially if the source material contains digital clipping.
- **After:** Fixed volume in dBFS. When using any resampling, the maximum recommended volume level is -3 dBFS, to avoid inter-sample overloads and in case the material contains digital clipping/limiting. Note! High oversampling ratios can generate high inter-sample overs. Overloading the delta-sigma modulator in SDM mode will also cause audible noises. It is therefore recommended to keep the software volume at -3 dB or lower when using PCM to SDM conversion to avoid overloads, especially if the source material contains digital clipping.

### Max volume tooltip

- **Before:** Maximum output volume setting in dB. Allows also positive values (gain). Together with the minimum this configures the adjustment range of the volume control. Setting both to the same value gives a fixed volume at that level. Note! When both values are set to zero (0), volume control is bypassed completely. However, this is not suitable for normal cases since it will cause inter-sample overs and thus limiting either at HQPlayer side or at the DAC side.
- **After:** Maximum output volume setting in dB. Also allows positive values (gain). Together with the minimum, this configures the adjustment range of the volume control. Setting both to the same value gives a fixed volume at that level. Note! When both values are set to zero (0), volume control is bypassed completely. However, this is not suitable for normal cases since it will cause inter-sample overs and thus limiting, either on the HQPlayer side or on the DAC side.

### PCM gain compensation tooltip

- **Before:** Due to nature of DSD, many DACs have different output levels for 0 dBFS PCM vs 0 dB DSD. PCM gain compensation can be used to compensate for this level difference.
- **After:** Many DACs have different output levels for 0 dBFS PCM vs 0 dB DSD. PCM gain compensation can be used to compensate for this level difference.

### Adaptive volume tooltip

- **Before:** Apply adaptive gain settings during playback based on metadata or library analysis data; ReplayGain 2.0 metadata is used to offset the volume. Note that in case metadata includes positive gain values, you may need to provide extra headroom using volume control setting.
- **After:** Applies adaptive gain during playback based on metadata or library analysis data; ReplayGain 2.0 metadata is used to offset the volume. Note! If the metadata includes positive gain values, extra headroom may be needed using the volume control.

### CUDA offload tooltip

- **Before:** "CUDA offload" can utilize nVidia GPU to partially offload the processing from CPU to GPU. CUDA offload requires nVidia GPU with minimum Compute Capability level 5.2, 2 GB of graphics RAM and latest official nVidia drivers. When CUDA offload is enabled, also Multicore DSP should be enabled, or left at automatic setting to achieve best performance. With "convolution only", only convolution algorithms are offloaded to GPU.
- **After:** Utilizes an NVIDIA GPU to partially offload processing from the CPU to the GPU. CUDA offload requires an NVIDIA GPU with a minimum Compute Capability level of 5.2, 2 GB of graphics RAM, and the latest official NVIDIA drivers. When CUDA offload is enabled, Multicore DSP should also be enabled, or left at the automatic setting, to achieve the best performance. With "convolution only", only convolution algorithms are offloaded to the GPU.

### 1x filter tooltip

- **Before:** This selection can be used to switch between resampling / oversampling filters. This selection has an impact on available hardware sampling rates. Filter/oversampling selection for "1x" rates covers source sampling rates below 50 kHz, so called base rates.
- **After:** This selection can be used to switch between resampling / oversampling filters, and has an impact on the available hardware sampling rates. Filter/oversampling selection for "1x" rates covers source sampling rates below 50 kHz, so-called base rates.

### Nx filter tooltip

- **Before:** Filter selection for "Nx" rates covers everything else above the 1x rates.
- **After:** Filter selection for "Nx" rates covers everything above the 1x rates.

### Output device tooltip (alsa_device)

- **Before:** On Linux, the ALSA audio endpoint (device) lists all the available hardware audio endpoints.
- **After:** Lists all the available ALSA hardware audio endpoints.

### Idle time tooltip

- **Before:** Defines amount of time the engine is left idling after playback of current content has ended. This allows faster playback restart within the idle period.
- **After:** Defines the amount of time the engine is left idling after playback of the current content has ended. This allows a faster playback restart within the idle period.

### DoP tooltip

- **Before:** DSD content can be transferred to/from the audio device by packing it into suitable PCM container; select "DSD over PCM (DoP)" to use the DoP v1.1 standard. PCM mode does not use this setting.
- **After:** DSD content can be transferred to/from the audio device by packing it into a suitable PCM container; select "DSD over PCM (DoP)" to use the DoP v1.1 standard. PCM mode does not use this setting.

### DSD rates tooltip

- **Before:** Allow any DSD base rate instead of being constrained to 44.1 kHz base rate (e.g. DSD128x48 = 6.144 MHz). Only meaningful for DACs that accept 48k-family DSD rates.
- **After:** Allow any DSD base rate instead of being constrained to the 44.1 kHz base rate (e.g. DSD128x48 = 6.144 MHz). Only meaningful for DACs that accept 48k-family DSD rates.

### Buffer time tooltip

- **Before:** Length of the hardware audio buffer (in milliseconds); 0 is the driver default. It is recommended to use the driver default, unless audio drop-outs are experienced. When the driver default is used, the audio driver defines length of the buffer. Values between 10 and 100 ms are most recommended. −1 selects the minimum buffer: never use it for normal playback — it can be attempted only for realtime inputs using the input backend.
- **After:** Length of the hardware audio buffer (in milliseconds); 0 is the driver default. It is recommended to use the driver default, unless audio drop-outs are experienced. When the driver default is used, the audio driver defines the length of the buffer. Values between 10 and 100 ms are most recommended. −1 selects the minimum buffer: never use it for normal playback; it can be attempted only for realtime inputs using the input backend.

### Source gain tooltip

- **Before:** DSDIFF or DSF file should typically have 6 dB of headroom on the signal level. By selecting "+6 dB", 6 decibels of gain is applied, removing this headroom from the converted signal. This way the normal playback level reaches that of normal PCM. However, this may cause overloads with some source material and may require extra attenuation using volume control.
- **After:** DSDIFF or DSF files should typically have 6 dB of headroom on the signal level. By selecting "+6 dB", 6 decibels of gain is applied, removing this headroom from the converted signal. This way the normal playback level reaches that of normal PCM. However, this may cause overloads with some source material and may require extra attenuation using the volume control.

### Multicore DSP tooltip

- **Before:** Multicore DSP increases parallelization of various DSP operations. With "auto", automatic detection and configuration is active and can utilize any number of cores. For best performance it is recommended to use the auto-detection. When disabled, processing is optimized for cases where number of cores is equal or less than number of output channels. Such as dual-core CPUs when output is stereo. When enabled, processing is optimized for modern multi-core CPUs with much higher core count than number of output channels. Since this parallelization increases processing overhead, it will increase total CPU time consumption. If there are performance problems with "auto" setting, it is typically useful to try this option.
- **After:** Multicore DSP increases parallelization of various DSP operations. With "auto", automatic detection and configuration is active and can utilize any number of cores. For best performance, it is recommended to use the auto-detection. When disabled, processing is optimized for cases where the number of cores is equal to or less than the number of output channels, such as dual-core CPUs when output is stereo. When enabled, processing is optimized for modern multi-core CPUs with a much higher core count than the number of output channels. Since this parallelization increases processing overhead, it will increase total CPU time consumption. If there are performance problems with the "auto" setting, it is typically useful to try this option.

### Blocks per cycle tooltip

- **Before:** Number of blocks to process at once. This setting can be used to fine tune CPU/GPU load to lowest possible figure. When set to default (0) the value is auto-configured based on detected amount of CPU cache etc. Processing more blocks at once reduces overhead, especially when GPU is used. While processing fewer blocks at once helps keeping most of the data in CPU cache. Higher values are better suited for processors with large cache, such as AMD 3D-series and some Intel Xeon models, or systems with high speed RAM. While smaller values are better suited for CPUs with small cache, or systems with slower RAM.
- **After:** Number of blocks to process at once. This setting can be used to fine tune CPU/GPU load to the lowest possible figure. When set to the default (0), the value is auto-configured based on the detected amount of CPU cache etc. Processing more blocks at once reduces overhead, especially when a GPU is used, while processing fewer blocks at once helps keep most of the data in CPU cache. Higher values are better suited for processors with a large cache, such as AMD 3D-series and some Intel Xeon models, or systems with high speed RAM, while smaller values are better suited for CPUs with a small cache, or systems with slower RAM.

### Pre-process before metering tooltip

- **Before:** When enabled, pre-processing, such as 20 kHz filter, is run before metering. This allows one to see effect of the pre-process. But it may make it harder to detect when to disable 20 kHz filter again.
- **After:** When enabled, pre-processing, such as the 20 kHz filter, is run before metering. This allows one to see the effect of the pre-process, but it may make it harder to detect when to disable the 20 kHz filter again.

### Crossfeed preset tooltip

- **Before:** Sets one of the available presets: default parameters, Chu Moy's parameters, Jan Meier's parameters, or custom parameters according to frequency and level. When custom preset is selected, cross-feed filter frequency and level can be entered respectively.
- **After:** Sets one of the available presets: default parameters, Chu Moy's parameters, Jan Meier's parameters, or custom parameters according to frequency and level. When the custom preset is selected, the cross-feed filter frequency and level can be entered.

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

### AHM5EC5L notes
- **Before:** Limited SNR compared to other modulators, best suited for loudspeaker system and/or when digital volume control is not needed. Not recommended when HQPlayer's volume control is the primary volume control method.
- **After:** Limited SNR compared to other modulators, best suited for a loudspeaker system and/or when digital volume control is not needed. Not recommended when HQPlayer's volume control is the primary volume control method.

### AHM7EC5L notes
- **Before:** Limited SNR compared to other modulators, best suited for loudspeaker system and/or when digital volume control is not needed. Not recommended when HQPlayer's volume control is the primary volume control method.
- **After:** Limited SNR compared to other modulators, best suited for a loudspeaker system and/or when digital volume control is not needed. Not recommended when HQPlayer's volume control is the primary volume control method.

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
- **After:** Especially good for older 16-bit, 4x-rate-capable multibit DACs like TDA154x etc.

### LNS15
- **Before:** 15th order linear noise shaping. Smooth noise-shaping slope designed especially for 16x rates (705.6/768 kHz) and recommended for these higher PCM rates. Can be also used at 8x rates (352.8/384 kHz), but not recommended for rates below.
- **After:** 15th order linear noise-shaping. Smooth noise-shaping slope designed especially for 16x rates (705.6/768 kHz) and recommended for these higher PCM rates. Can be also used at 8x rates (352.8/384 kHz), but not recommended for rates below.

### TPDF
- **Before:** Triangular Probability Density Function. This is the industry standard simple dither mechanism. Suitable for any rate and recommended if playback rate is 44.1/48 kHz. Recommended for general purpose use.
- **After:** Triangular Probability Density Function. This is the industry standard simple dither mechanism. Suitable for any rate and recommended if the playback rate is 44.1/48 kHz. Recommended for general purpose use.

### Gauss1
- **Before:** Gaussian Probability Density Function. High quality flat frequency dither recommended for rates at or below 96 kHz where noise-shaping is not suitable.
- **After:** Gaussian Probability Density Function. High quality flat frequency dither recommended for rates ≤ 96 kHz where noise-shaping is not suitable.

### shaped
- **Before:** Shaped dither. Noise used in this dither has shaped frequency distribution to lower audibility of the dither noise. Suitable for playback rates of 88.2/96 kHz, or higher.
- **After:** Shaped dither. Noise used in this dither has a shaped frequency distribution to lower the audibility of the dither noise. Suitable for playback rates ≥ 88.2/96 kHz.

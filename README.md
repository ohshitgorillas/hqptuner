# HQPTuner: an improved configuration interface for HQPlayer Embedded


## Inspiration

HQPlayer is, in my humble opinion, the best deal in all of high-end digital audio, with two caveats:
1. You may go broke trying to afford CPUs and GPUs to feed it the power it craves.
2. While everything under the hood works wonderfully, the default UI is bad.

The second point is the inspiration for HQPTuner.

### Benefits of HQPTuner

HQPTuner is an improvement over the stock web configuration UI in many ways:

* **More sensible organization**: Settings are organized into four tabs: Output, DSP, Volume, and System.
* **Easier rate selection**: No more memorizing raw Hz values: select, e.g., PCM x4 or DSD512 from the rate selection menu.
* **Surfaced manual knowledge**: All of the information from the manual is available at your fingertips. No more cross-referencing.
* **Filter sorting**: Automatically sort filters by quality, genre, and focus with an option to only show apodizing filters for 1x material.
* **Smart option availability**: Only see options that are appropriate for the settings you've selected; e.g., dither options are filtered for your current output rate.

### Drawbacks of HQPTuner

While it should cover 95% of use cases, this is **not** a full-featured configuration interface.

Unavailable features:
* Media metadata and controls
* Library management
* Matrix pipeline (only DAC Correction and Crossfeed)
* Convolution engine

Furthermore, to maintain "friendly" output rate options, the "Auto-rate family" option is always forced and only the most common output rates (multiples of 44.1k and 48k) are available.

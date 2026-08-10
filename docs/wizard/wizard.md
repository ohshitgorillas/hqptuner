# HQPTuner Setup Wizard — workflow

A guided first-run flow that takes a user from a bare HQPlayer install to pressing Play, ending with every endpoint saved as an HQPTuner preset and the engine running one of them. Screen copy is quoted in sequence; between the quotes is what the program does at that moment.

> Welcome to the HQPTuner setup wizard! We're going to get HQPlayer configured for your first listen.
>
> The wizard's goal is to take the pressure out of the HQPlayer setup process while showing you the ropes. It does not generate ideal, optimized settings; rather, it gives you a functional starting point to explore and optimize further. None of these choices or selections are binding—everything can be changed and re-configured later.
>
> None of this information is stored or harvested in any way.

## 1. Backend

> In this section, we'll configure the backend settings for each preset. Presets are collections of settings applied all at once, useful for switching between different setups/endpoints, e.g., headphone and speakers, or going from living room to den; the "backend" setting determines how the 1s and 0s arrive at that preset's endpoint, i.e., direct or over your home network.

> While you can set up any number of endpoints/presets in this wizard, it only supports configurations that stream to one device at a time. If your target is multiple endpoints *at once* (HQPlayer's "Combo" backend), you'll need to configure that yourself.

> How many distinct setups or devices (endpoints) will HQPlayer be streaming to?

The answer sets the number of presets; the rest of this section loops once per endpoint.

> Give this preset a name, e.g., "den speakers".
>
> Tip: if you are adding a headphone setup which drives multiple headphones, each with a distinct EQ profile, you can add those later as separate "matrix profiles" under the same preset. There's no need to create a different preset per headphone/EQ profile.
>
> If the device isn't plugged in and/or powered on yet, do that now, give it a minute or two to boot up, and click Next. Or, see the instructions for setting up a network endpoint here (link).

### 1.1 Backend type

> First, we need to know how the music is going to get from HQPlayer to your DAC. This phase determines the backend type for this preset.
>
> * HQPlayer streams to an endpoint over my home network (NAA aka network audio adapter)
> * My HQPlayer device outputs directly to my DAC or DDC (ALSA aka advanced Linux sound architecture)

NAA continues into §1.2; direct output skips ahead to §1.3.

### 1.2 NAA bring-up

> **CRITICAL:** The HQPlayer host system's firewall must be disabled or removed entirely. HQPlayer *will* fail to find NAAs in the presence of a firewall.
>
> On Debian or Ubuntu Server: `sudo systemctl stop ufw && sudo systemctl disable ufw`
> On Fedora: `sudo systemctl stop firewalld && sudo systemctl disable firewalld`
>
> If that doesn't work, try `sudo apt remove ufw` or `sudo dnf remove firewalld` respectively.

The user runs these on the HQPlayer host themselves — HQPTuner has no access to the host OS.

> NAAs come in three flavors:
> 1. NAA OS: You download the read-only OS image from Signalyst's website (link), flash it onto an SD card, and let the endpoint device boot into that directly. See the instructions on the Signalyst website (link).
> 2. Built-in: the device features an HQPlayer NAA plugin or mode which is enabled through its native settings. Consult your device's manual.
> 3. The `networkaudiod` + `avahi-daemon` packages, both available on various Linux distros.
>
> Recommendation: Use the highly optimized NAA OS whenever possible.

Entering this step, HQPTuner snapshots the daemon's current network device list.

> Once the NAA is connected to the network, booted up, and ready, click Next to identify it.

On Next, HQPTuner has the daemon rescan its devices and re-reads the list. The listing that appeared since the snapshot is the NAA; it's carried forward pre-selected into the device step.

`TODO copy`: identify success, and identify failure (nothing new after the rescan; retry path).

### 1.3 DDC question and device lock-in

Asked on both backends — the double listing occurs behind an NAA too.

> Do you have a transport or DDC before your DAC, which feeds the DAC over USB?

No:

> Select the device for this preset from the list. If there are multiple endpoints of the same name/style and you can't tell which is the one you want, power down the others and click Refresh devices.

The list is the daemon's own device list for the chosen backend; Refresh devices makes it rescan.

Yes:

> Using a DDC or transport before your DAC and connecting it to the DAC over USB generates two device listings for the same hardware, but only one of them actually works. To ensure you actually hear music once you press Play, we need to figure out which of those listings is correct.
>
> Select the two device listings for this preset below and press Next.

HQPTuner notes the two chosen listings.

> Now, unplug the USB cable feeding the DAC and press Next.

On Next, it has the daemon rescan and re-reads the list: of the two, the listing that *survived* the unplug is the working device, and it's locked in for this preset.

> Please hang tight while HQPTuner finds the remaining device listing... Got it! Plug the DAC back in and click Next.

`TODO copy`: failure branches: both listings survive, both vanish, rescan returns nothing.

## 2. Hardware

Asked once — the answers describe the machine running the daemon, and the resulting settings are written identically into every preset. They can only be changed with a daemon restart, which §6 already pays for.

> In this section, we're going to figure out how to best configure HQPlayer for your hardware: things like output modes (for example, whether your gear supports DSD) and rate limits.

> Does your hardware have either of the following?
> - Nvidia GPU(s)
> - A CPU with E-cores

> Do you have more than one Nvidia GPU? If yes, enter their indices below (`nvidia-smi`).
> More powerful card:
> Less powerful card:

> How would you rate your Nvidia GPU's power?
> - don't bother (no CUDA offloading)
> - low (convolution only)
> - moderate to high (convolution + resampling)

The answers resolve to hardware-acceleration settings per this table:

| Hardware answer | CUDA offload | Multicore DSP | E-core DSP |
|---|---|---|---|
| 2+ GPUs (indices entered) | convolution on one card, resampling on the other | on | per CPU |
| 1 GPU, rated "don't bother" | off | on | per CPU |
| 1 GPU, rated "low" | convolution only | on | per CPU |
| 1 GPU, rated "moderate to high" | convolution + resampling | on | per CPU |
| no GPU, E-cores | off | on | on |
| no GPU, no E-cores | off | on | off |

> Your answers to these questions determine your *initial* hardware acceleration settings. For power users, unless you're running top of the line hardware, it will take some tweaking beyond what the wizard can do to truly optimize performance. You'll find these settings under the System tab.

## 3. Rate detection

Fully automatic, per preset — no questions. The wizard asks the daemon to enumerate the device's supported rates and derives the maximum PCM and DSD rate limits, whether DSD is reachable at all (gates §5), and 48k-family DSD support. Enumeration answers for the device the daemon is currently on, so each preset's detection runs once the daemon is on that preset's device.

`TODO copy`: whatever the user sees here, if the step is visible rather than silent.

## 4. Preferences

> This section's settings are more preference-related.

> * Do you plan on using HQPlayer for volume control? If not, do you frequently listen to heavily clipped material? (target: optimal ISO -3dB vs -6dB)

Yes enables HQPlayer's volume control and moves on to the EQ question. No means fixed volume: the clipped-material answer picks the Optimal ISO headroom, −3 dB vs −6 dB, and the user gets the pitch:

> HQPTuner hints: give HQPlayer's volume control a try. It's not your typical digital volume knob.
>
> Traditional audiophile wisdom says that digital volume controls are bad (they drop significant bits, and therefore quality, to achieve volume decreases) and that volume should be adjusted as far up the chain as possible. That is *not* the case with HQPlayer's internal volume control, which never sees a quality loss at any level. Furthermore, consider the following two points:
>
> 1. **Perfect channel matching**: Traditional analog volume potentiometers have small mismatches across their range between the left and right channels, which, when audible, leads to blurred imaging (stepped knobs and R-2R ladder-based volume control which use matched resistors per step are exempt from this). Digital volume control, on the other hand, is always perfectly matched. Turn your analog volume knob up all the way (at which point it is very likely well matched) and use HQPlayer for volume control, and you might be surprised at how much better the soundstage is!
>
> 2. **Volume adaptive loudness**: This feature accounts for the fact that our hearing itself is non-linear across the frequency range: lower frequencies get quieter than the midrange as the volume goes down. Loudness therefore boosts bass (and optionally treble) to keep music *sounding* linear regardless of the listening level. It needs calibrated to your setup's gain and your own hearing, but once it's dialed in, you may be surprised by how much more satisfying low-volume listening can be, which is better for your hearing.
>
> Fair warning: there will always be a delay between HQPlayer controls and playback, including volume changes. You won't hear the volume change until 1 – 2s later (over NAA with the standard buffer settings). This delay can be mitigated with careful configuration, but if instant volume changes are critical for you, skip this.

> * Do you have EQ profiles to load into HQPlayer? How many?

The count sizes the pipeline allocation; actual EQ import happens after the wizard, in the Matrix tab.

## 5. Output mode

Shown only for presets whose detected rates include DSD/DoP; everyone else stays on PCM and skips to §6.

> Choose the output mode for your first listen: PCM, SDM (DSD), or Auto.
>
> - **PCM** stands for Pulse Code Modulation. This is how your standard mp3 or FLAC files are packaged: 16 or 24 bits of volume depth and sampled at between 44.1 to 192 kHz.
> - **SDM** stands for Sigma-Delta Modulation, and is otherwise known as DSD (Direct Stream Digital). It's a 1-bit signal (0 = falling volume, 1 = rising volume) with a very high sampling rate: at least 2.82 MHz for DSD64, and going up to >90 MHz for DSD2048.
> - **Auto** follows the source: playing PCM files (e.g., `*.flac`) will output PCM; playing DSD files (`.dsf` or `.dff`) will output SDM.
>
> Suggestion: Give DSD a try. It takes a little more processing power than PCM, so if you're unsure about your hardware, start low like 64-128x and work your way up. Worst case scenario, you can switch back to PCM live at any time.

## 6. Filters

With more than one preset, the wizard first asks which one the user wants to listen to first and loads it (`TODO copy`: the question).

> You're almost there. Now, we need to pick your first filters.
>
> Hint: the default filters are really, *really* good. You could even skip this part.
>
> For your first listen...
> * Which genre fits what you're going to be playing best?
> * Choose one or two of the following three qualities you want the filter to focus on: space, timbre, transients
> * Is the material 1x (sampled at 44.1 or 48 kHz) or Nx (>= 88.2 kHz)? HQPlayer uses different filters for 1x and Nx material.
> * Would you prefer something leaner and more detailed, or smoother and more analog?

The four answers drive the existing filter-narrowing facets, with quality pinned to 4–5 — one filter database, no wizard-specific second copy.

> Based on your selections, here's a curated list of filters for your first listen. All of them have been rated 4/5 or 5/5 quality by Jussi, so don't feel too overwhelmed: there are no bad choices here. Plus, filters can be changed live without restarting playback if you really don't like it.

The pick applies live — no restart — and persists into the running preset.

`TODO copy`: empty facet result (reuse the tabs' "no filters match — widen criteria" or write wizard-specific wording).

## 7. Fin

> You're all set; you can press play now.
>
> Enjoy the tunes :)

## Missing copy
1. NAA identify — success and failure (§1.2)
2. Disambiguation failure branches (§1.3)
3. Rate-detection visibility + wording (§3)
4. Which-preset-first question (§6)
5. Filter empty-result state (§6)

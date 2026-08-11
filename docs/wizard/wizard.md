# HQPTuner Setup Wizard — workflow

A guided first-run flow that takes a user from a bare HQPlayer install to pressing Play, ending with every endpoint saved as an HQPTuner preset and the engine running one of them. Screen copy is quoted in sequence; between the quotes is what the program does at that moment.

> Welcome to the HQPTuner setup wizard! We're going to get HQPlayer configured for your first listen.
>
> The wizard's goal is to take the pressure out of the HQPlayer setup process while showing you the ropes. It does not generate ideal, optimized, set-it-and-forget-it settings; rather, it gives you a functional starting point to explore. None of these choices or selections are binding: everything can be re-configured later.
>
> None of this information is stored or harvested in any way; it never leaves your computer.

Note: must disable IPv6 to start. Defaults to on, but later steps assume IPv4 only and test IPv6 explicitly.

## 1. Preset creation

> We'll start by defining your presets, their devices, and backends. Presets are collections of settings applied all at once, useful for switching between different device endpoints/setups, e.g., a headphone rig in a home office versus a speaker rig in the living room, or going from living room to den setups. The "backend" setting determines how the 1s and 0s arrive at that preset's endpoint, i.e., via direct connection (ALSA) or over your home network (NAA).
>
> While you can set up any number of endpoints/presets in this wizard, it only supports configurations that stream to one device at a time. If your target is multiple endpoints *at once* (HQPlayer's "Combo" backend), you'll need to configure that yourself.
>
> How many distinct setups or devices (endpoints) will HQPlayer be streaming to?

The answer sets the number of presets; the rest of this section loops once per.

> Give this preset a name, e.g., "living room speakers".
>
> **HQPTuner Tips**: if you are adding a headphone setup with multiple headphones, each with a distinct EQ profile, you can add those later as separate "matrix profiles" under the same preset. There's no need to create a different preset per headphone/EQ profile.

Once named, the user must select the appropriate device from the available devices list.

> If the device isn't plugged in and/or powered on yet, do that now, give it a minute to boot up, and click Next. Or, see the instructions for setting up a network endpoint here (§1.1 NAA bring-up).

### 1.1 Backend

> How is the music getting from HQPlayer to your DAC? This determines the backend type for this preset: ALSA (advanced Linux sound architecture) or NAA (network audio adapter).
>
> * HQPlayer streams to this endpoint over my home network (NAA)
> * My HQPlayer device outputs directly to my DAC or DDC (ALSA)

If the user selects NAA but no devices are visible, go to §1.2.

### 1.2 NAA bring-up (NAA only)

The following dialog is shown only once, regardless of how many NAAs the user is setting up.

> Network Audio Adapters (NAAs) come in three flavors:
> 1. **NAA OS**: Download the latest NAA OS image from [Signalyst's website](https://signalyst.com/bins/naa/), flash it onto an SD card (or whatever the device uses for a boot drive/OS storage), and let the endpoint device boot that directly.
> 2. **Built-in**: the device features an HQPlayer NAA plugin or mode which is enabled through its native settings. Consult your device's manual.
> 3. **DIY**: the `networkaudiod` package, also available directly from [Signalyst](https://signalyst.com/bins/naa/).
>
> **HQPTuner Tips**: The NAA OS is highly optimized; use it whenever possible unless you also want to use non-HQPlayer sources.
>
> Once the NAA is connected to the network, booted up, and ready, click Refresh devices and make sure it's there. If you see multiple ambiguous listings, don't worry, we'll sort that out later. If you don't see the device at all, you'll need to figure out why it's not appearing before proceeding.
>
> ### **CRITICAL: READ THIS**
>  
> HQPlayer *will* fail to find NAAs in the presence of a firewall. The HQPlayer host system's firewall must be disabled or removed entirely.
>
> On Debian or Ubuntu Server: `sudo systemctl stop ufw && sudo systemctl disable ufw`
>
> On Fedora: `sudo systemctl stop firewalld && sudo systemctl disable firewalld`
>
> If that doesn't work, try `sudo apt remove ufw` or `sudo dnf remove firewalld` respectively.

This screen requires a visible NAA device on the network to proceed.

### 1.3 Device selection

> Select the device for this preset from the list.
>
> If there are multiple endpoints of the same device/style and you can't tell which is which (e.g., two Holo Reds on the same network), power the other(s) down and click Refresh devices so that only the correct device is left.
>
> If there is only one physical device but multiple listings, select both and we'll disambiguate them in a minute.

### 1.4 IPv6 detection (NAA only)

This section determines whether to enable IPv6 support during NAA discovery and streaming.

Not all devices are capable of IPv6 even if a home LAN is, so we need to do this per preset/device.

> Does your home LAN use IPv6 addressing? This determines whether HQPlayer uses IPv6 to discover and stream to NAAs.
> - Yes
> - No
> - I don't know

On "yes", confirm:

> Enabling IPv6 and confirming the NAA remains visible... Got it.

or...

> That didn't work. Let's leave IPv6 off for now. Don't worry: this won't affect performance at all, only how HQPlayer discovers and talks to the NAA.

On "I don't know", proceed with the following:

> HQPTuner will detect whether your LAN can use IPv6 for NAA discovery by checking whether the device remains visible with IPv6 support engaged. This will restart the daemon once or twice.
>
> If you'd rather skip this, click Skip below to stick with IPv4. Otherwise, click Start.
>
> Restarting the daemon with IPv6 enabled...
>
> Verifying NAA endpoint visibility...
> 
> Confirmed! IPv6 works.
 
or...

> Either this device or your home LAN doesn't seem to support IPv6. Don't worry: this doesn't affect performance at all, only how HQPlayer discovers and talks to this NAA.

#### 1.5 USB Disambiguation

> Using a DDC or transport before your DAC and connecting it to the DAC over USB generates two device listings for the same hardware, but only one of them actually works (produces sound). To ensure you actually hear music once you press Play, we need to figure out which of those listings is correct.
>
> First, unplug the USB cable feeding the DAC or turn the DAC off, then click Disambiguate.

Once the user presses the Disambiguate button...

> Please hang tight while HQPTuner finds the remaining device listing... Got it! Saved. Plug the DAC back in and click Next.

The surviving device is locked in as the correct endpoint. Both endpoints are hidden from future lists to avoid confusion.

Or...

> HQPTuner wasn't able to disambiguate which device is correct, since {both devices disappeared / neither device went down}. You'll need to experiment later: load each device and try to play content back. The one that produces sound is (obviously) correct.


### 1.5 Rate detection

Per preset. The interface answer sets the rate ceilings the daemon can't see for itself — a DAC behind a DDC or transport is invisible to it.

> How does your DAC receive its input signal from HQPlayer? If you use a separate streamer, DDC, or transport, how does *that* send the signal to your DAC?
>
> - USB or I2S/IIS
> - AES/EBU or S/PDIF coaxial (4x PCM, DSD64 via DoP)
> - S/PDIF Toslink (2x PCM, no DSD)

USB or I2S continues; the other two answers fix the limits themselves.

The wizard then queries the daemon for the 48k-family answer:

> Checking whether your hardware supports 48kHz-family DSD rates... Got it.
>
> Here's what your hardware supports:
> - PCM: ...
> - SDM: ... (via DoP / None)
> - 48kHz DSD: yes/no
> - DAC bits:
> - PCM gain compensation (only when native DSD is possbile)
> 
> If you're using a separate transport or DDC, confirm these limits with your DAC's manual to avoid your transport sending a rate that your DAC can't parse. If the real limits are lower than those above, change them now.
>
> If you're planning on outputting PCM, especially on a DAC with R-2R ladder topology, you'll want to find the "DAC bits" setting. This tells HQPlayer where the noise floor of your DAC is so that it can apply dithering correctly.
>
> Known good DAC bits values (from the HQPlayer manual):
> - Holo Audio Cyan 2, Spring, Spring 2, Spring 3, May: 20
> - Denafrips: 19
> - LAiV Harmony DAC, Harmony μDAC: 18
> - Schiit Bifrost 2/64, Gungnir 2, Yggdrasil LIM (DAC8812): 16
>
> Finally, if you plan on switching between PCM and DSD, you'll want to set PCM Gain Compensation so that the levels are even. A table in the HQPlayer manual (p. 16) shows levels for common DACs. If you can't find yours, leave it at 0dB for now.

### 1.6 Volume control

> Do you plan on using HQPlayer/HQPTuner for volume control for this preset, or using a different means of volume control?
>
> Fair warning: there will always be a delay between HQPlayer controls and playback, including volume changes. This delay can be mitigated with careful configuration, but if instant volume changes are critical for you, skip this.

"Yes" disables fixed volume, sets the range to -60 to -3 dB, sets startup volume to -40dB, and moves onto the next section.

On "no":
> Do you frequently listen to heavily clipped material?
> - Yes (-6dB auto headroom/optimal ISO)
> - No (-3dB auto headroom/optimal ISO)
> 
> **HQPTuner Hint 1**: The output level's absolute ceiling should be -3dB to prevent clipping during resampling.
>
> **HQPTuner Hint 2**: Think about giving HQPlayer's volume control an honest shot. It's not your typical digital volume knob.
>
> Traditional audiophile wisdom says that digital volume controls are bad (they drop significant bits, and therefore quality, to achieve volume decreases) and that volume should be adjusted as far up the chain as possible. That is *not* the case with HQPlayer's internal volume control, which never sees a quality loss at any level. Furthermore, consider the following:
>
> 1. **Perfect channel matching**: Traditional analog volume potentiometers have small mismatches across their range between the left and right channels, which, when audible, leads to blurred imaging (stepped knobs and R-2R ladder-based volume control which use matched resistors per step are exempt from this). Digital volume control, on the other hand, is always perfectly matched. Turn your analog volume knob up all the way (at which point it is very likely well matched) and use HQPlayer for volume control, and you might be surprised at how much better the soundstage is!
>
> 2. **Volume adaptive loudness**: This feature accounts for the fact that our hearing itself is non-linear: lower frequencies get quieter than the midrange as the volume goes down. Loudness therefore boosts bass (and optionally treble) to keep music *sounding* linear regardless of the listening level. It needs calibrated to your setup's gain and your own hearing, but once it's dialed in, you may be surprised by how much more satisfying low-volume listening can be, which is better for your hearing in the long run.

## 3. EQ Profiles

This section still needs fleshed out a bit, but needs to come after the presets have been added.

> Matrix profiles are useful for, e.g., headphone rigs with multiple sets of headphones, each requiring a distinct EQ correction and/or volume-adaptive loudness bounds. If you have multiple headphone rigs even, you can save those EQ profiles to both headphone rig presets.
>
> Room corrections also get added at this stage.
>
> Does this endpoint stream to speakers, headphones, or both?
> - Speakers
> - Headphones
> - Both

On "speakers":

> What kind of setup? 

with options 2.0, 2.1, 3.0, 3.1, 5.1, ...

> Do you need to set levels and/or delays per speaker?
>
> Do you have room correction convolution filters or an EQ curve per speaker that you want to transfer to HQPlayer?
>
> Upload the filter files for the {Left,Right,etc.} channel here:

On "headphones":

> Do you already have EQ/correction profiles for your headphones to upload? How many?
>
> Is your hearing symmetrical? If not, do you have a correction profile to overlay, or do you already have separate EQ files for left and right channels?
>
> **HQPTuner Tips**: If you don't already have correction profiles for your headphones, don't worry: HQPTuner integrates the entire Headphone Auto EQ library, so you can try out correction profiles in just a few clicks.

A loop runs per headphone:

> Name this profile, e.g., "Sennheiser HD600".
> 
> Upload the EQ profile (for the left/right channel) here:


## 4. HQPlayer Hardware

Asked once — the answers describe the machine running the daemon, and the resulting settings are written identically into every preset.

> In this section, we're going to generate some first-pass hardware acceleration settings. 
> 
> **HQPTuner Tips:** Depending on your goals and the available processing power, further optimization may be required. For power users without top-of-the-line hardware, it will take some tweaking beyond what the wizard can do to truly maximize performance. You'll find these settings under the System tab.
> 
> Does your hardware have either of the following?
> - Nvidia GPU(s)
> - A CPU with E-cores
> 
> Do you have two Nvidia GPUs? If yes, enter their indices below (run `nvidia-smi` on the host machine).
> - More powerful card:
> - Less powerful card:
> - Both cards are identical
> 
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

## 5. The Tour

At this point, the user is guided through the HQPTuner interface in "tour" mode, but can skip out of this at any point.

We begin in the Output tab, with (no preset) loaded.

> Welcome to the HQPTuner interface. You'll now get a tour of your new UI, however, if you'd rather skip this, click "Skip" below.

If the user has multiple presets, they're presented with...

> First, let's pick the preset you're going to use for your first listen from the dropdown.
> 
> Now, click Apply. The daemon will restart and be back in <10 seconds.

The Apply button is highlighted. Once the daemon reloads, the tour resumes.

### 5.1 Output

> The output tab contains device, backend, mode, and rate settings among other features. Most of these have already been set correctly by the wizard, but feel free to experiment with the rest.
>
> Another feature of note here is the "junk" filter (high-frequency filter). HQPTuner will alert you when it's appropriate to engage the 20-50kHz filters; the 2x-8x settings are on you.
> 
> (when available)
> Choose the output mode for your first listen: PCM, SDM (DSD), or Auto.
>
> - **PCM** stands for Pulse Code Modulation. This is how your standard mp3 or FLAC files are packaged: 16 or 24 bits of volume depth and sampled at between 44.1 to 192 kHz.
> - **SDM** stands for Sigma-Delta Modulation, and is otherwise known as DSD (Direct Stream Digital). It's a 1-bit signal (0 = falling volume, 1 = rising volume) with a very high sampling rate: at least 2.82 MHz for DSD64, and going up to >90 MHz for DSD2048.
> - **Auto** follows the source: playing PCM files (e.g., `.flac`) will output PCM; playing DSD files (`.dsf` or `.dff`) will output SDM.
>
> HQPTuner Hint: If your gear supports native DSD, give PCM→SDM a try. This usually demands more processing power, so if you're unsure about your hardware, start low like 64-128x and work your way up using the default filters and modulator. You can switch back to PCM output mode at any time.

### Volume

(fixed volume copy)
> If you're using a fixed volume level, this tab is boring. I recommend keeping auto headroom (optimal ISO) at -3dB unless you hit clipping warnings, at which point you should take it down to -6dB.
>
> The recommended maximum output level is -3dB; levels above this are likely to yield clipping.

(adaptive volume copy)
> The volume tab is your new best friend, as it's one of two places to change the master volume (the other being LIVE mode). This is also where you set the volume range and engage/adjust the volume-adaptive loudness feature. The plot below shows the current boost levels.
>
> Although the maximum range goes to +12dB, the recommended maximum is -3dB; levels above this are likely to yield clipping.
>
> We've set the startup volume at a safe -40dB, with the lower range left at its default value. You'll want to adjust these later to your own setup's gain levels.
>
> Volume-adaptive loudness remains bypassed for now; that requires calibration to your own hearing, which is beyond the scope of this wizard. If you want to enable this later, here's my personal recipe:
> 1. Turn your preamp or volume knob up *almost* all the way. This allows you some headroom to account for the fact that not all recordings are at the same level, so some adjustment may be necessary to find the right balance for each recording.
> 2. Play some material with a moderate dynamic range: not super quiet, but not horribly compressed either.
> 3. Adjust the volume up until you perceive all frequencies as being equally loud and even; increases in volume should not increase the *perceived* bass level. This is the loudness upper bound value.
> 4. Adjust the volume to the quietest level you could bear to listen at. This is the starting point for the lower bound.
> 5. Engage the loudness feature, enter the upper and lower bound values respectively, then click Apply to restart the daemon. Leave the levels at their defaults for now.
> 6. Play the same material again, starting at the upper bound. Decrease the volume across the loudness range and listen to how the bass and treble respond.
> 7. If the bass gets boomy as the volume goes down, decrease the lower bound; if bass gets weak as the volume goes down, increase the lower bound. Furthermore, the treble boost is optional as per the manual's description, so if this feature makes treble sound strange or too forward, decrease the treble boost's level (or just disable it by turning it down to 0dB).
> 8. If the upper and lower bounds are correct, but the bass still sounds boomy with volume decreases, you can then try to decrease the boost level.
> 
> 

### Resampling

> Now, we need to choose your first filters. This is done on the Resampling page.
>
> You'll notice that this page has two signal chain cards, one for PCM and one for SDM (DSD). Unless you're in Auto mode, one of them is always collapsed to keep it off your mind.
>
> Inside the active chain card, filters are split into two categories: 1x (content sampled at 44.1 or 48 kHz) and Nx (content sampled at >=88.2 kHz). There are also distinct settings for native DSD content.
> 
> Above is the Filter Narrowing card. This system encodes the manual's knowledge and ratings of filters right into the interface. You can be down to a handful of relevant filters in just a few clicks.
> 
> For your first listen, I recommend filling out at least the genre and/or focus fields; I also recommend leaving Quality set on >=3/5 or better. If you like a filter, favorite it by clicking its star in the dropdown. If you dislike it or just want to change things up, filters can always be switched live mid-playback.
>
> **HQPTuner Hints**: The default filters are superb all-arounders and are the defaults for a reason. You could even skip this part. They've been favorited for you by default so you don't lose track of them.

### Matrix

> The Matrix tab is split into two sections: Speakers and Headphones.
> 
> The Speakers section gives you access to setting levels and time delays for each channel in your system.
>
> The Headphones section gives access to the full Headphone Auto EQ library as well as two different styles of crossfeed.
>
> Matrix profiles store different EQ presets, all of which can be swapped live.
>
> **HQPTuner Hints:** Hard-panned content on headphones got you down? Give crossfeed a try and you may be surprised how much more tolerable those (and other) recordings can be! HQPTuner offers both HQPlayer's native Bauer implementation, plus its own structural crossfeed feature.

### System

> This tab is where you do things like:
> - change from the default every-web-UI-ever blue accent color to something cool and fun instead 😋
> - tweak hardware acceleration settings to squeeze every last ounce of performance out of your system
> - view the daemon's log
> - check the engine health in the form of input/output buffers and realtime processing speed

### LIVE mode

> LIVE mode exposes all settings that the daemon is capable of changing in the fly without restarting the engine. Each field's value is applied upon selection: no staging, no apply.
>
> Live presets also allow you to keep combinations of live settings for applying on the fly all at once.


## 4. Fin

> That's the end of the tour. Hopefully by now, you're feeling much more confident and knowledgeable about configuring HQPlayer.
>
> And if not, don't hesitate to reach out and say what could have been better. I'll do my best to fix it.
> 
> You can press Play now. Enjoy the tunes :)

Note: must be actual ASCII emoticon, NOT the 🙂 emoji.

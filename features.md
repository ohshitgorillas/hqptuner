# features

a list of features and fixes the user has thought up while using HQPTuner. remove items from this list when finished.

1. sort filters by light/medium/heavy? (this is more of a wishlist item than a feature that needs implemented now)

5. The triple-handle Range slider needs a visual overhaul; it looks bad.

Can we do a [-like symbol for the min and ]-like for the max?
And maybe a down caret `v` or filled in triangle for startup volume
Startup vol is offset from its actual value/tickmark (which btw is unlabeled)
tickmarks are nearly invisible
-120 and +12 limits are jammed up against the sides of the card

6. Login/non-Dockerized credentials as an option.

The original HQPlayer web UI is auth-gated, but HQPTuner is free to anyone with LAN access, making it inappropriate for the possibility of control over WAN. Give the option to deprive Docker of the credentials and instead supply them via HQPTuner's UI.

8. "EMERGENCY CONFIG RESET" button in System. full width card, collapsed by default. sends totally stock xml to the daemon and restarts. for major failures/corruption. use a classic Nintendo controller and make the user input the Contra code to confirm.

9. Turning off structural crossfeed does not always remove the extra pipelines.

10. Loading structural crossfeed, then a headphone EQ profile, does not update the structural crossfeed settings.

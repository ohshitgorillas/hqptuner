# features

a list of features and fixes the user has thought up while using HQPTuner. remove items from this list when finished.

1. sort filters by light/medium/heavy? (this is more of a wishlist item than a feature that needs implemented now)

5. The triple-handle Range slider needs a visual overhaul; it looks bad.

Can we do a [-like symbol for the min and ]-like for the max?
And maybe a down caret `v` or filled in triangle for startup volume
Startup vol is offset from its actual value/tickmark (which btw is unlabeled)
tickmarks are nearly invisible
-120 and +12 limits are jammed up against the sides of the card

8. "EMERGENCY CONFIG RESET" button in System. full width card, collapsed by default. sends totally stock xml to the daemon and restarts. for major failures/corruption. use a classic Nintendo controller and make the user input the Contra code to confirm.

(these next two are part of the same issue but I wrote it down twice cause I saw it express in two different ways)
9. Turning off structural crossfeed does not always remove the extra pipelines.
10. Loading structural crossfeed, then a headphone EQ profile, does not update the structural crossfeed settings. 
(note: it's more complicated than that, but some series of actions leads to stuck crossfeed pipelines 3-16 that don't auto-update with EQ or go away with "turn off" but do go away by switching to Bauer).

-- NEW FEATURE: EMERGENCY COFNIG RESET -- 

for major failures/corruption

System > full width card, collapsed by default

sends totally stock xml to the daemon and attempts restart; on failure, user is warned to `systemctl restart hqplayerd`. 

MUST WORK EVEN WHEN HQPLAYERD IS DOWN

UI: use a classic Nintendo controller and make the user input the Contra code (state code in notes, don't make them guess)



-- MAJOR FEATURE: DSP overhaul --

Currently DSP is headphone-centric with none of the /Speakers features from the web UI integrated.

I want a big switcher at the top of the DSP tab: [  OFF  |  SPEAKERS  |  HEADPHONES  ]

SPEAKERS exposes the /speakers features with graphics

HEADPHONES exposes the currently available headphone options

favicon changes based on setting, currently switches based on preset text

internal docs exist



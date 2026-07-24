# features

a list of features and fixes the user has thought up while using HQPTuner. remove items from this list when finished.

1. sort filters by light/medium/heavy? (this is more of a wishlist item than a feature that needs implemented now)

5. The triple-handle Range slider needs a visual overhaul; it looks bad.

Can we do a [-like symbol for the min and ]-like for the max?
And maybe a down caret `v` or filled in triangle for startup volume
Startup vol is offset from its actual value/tickmark (which btw is unlabeled)
tickmarks are nearly invisible
-120 and +12 limits are jammed up against the sides of the card

(these next two are part of the same issue but I wrote it down twice cause I saw it express in two different ways)
9. Turning off structural crossfeed does not always remove the extra pipelines.
10. Loading structural crossfeed, then a headphone EQ profile, does not update the structural crossfeed settings. 
(note: it's more complicated than that, but some series of actions leads to stuck crossfeed pipelines 3-16 that don't auto-update with EQ or go away with "turn off" but do go away by switching to Bauer).

11. Turning structural crossfeed off should not switch the window to Bauer. it should ONLY remove the structural crossfeed from the pipeline

13. (user request) It would be awesome to have the Playback Filter added in Ver 6 included here as well (I noticed “Junk Filter” in the code, so perhaps it’s already on your roadmap).

14. SDM Sources > DSD Sources

15. Top banner/signal chain/tabs not aligned

16. Load REW parameters for headphone auto EQ input field does not work, no way to load anything from the box; asinine with load buttons anyway, remove.

18. Load REW parameters / AutoEq txt button does not fucking work

19. make head circumference adjustable in 0.25 cm increments on the slider. input box should take any value.

20. Import EQ appends, it does not replace (should not replace structural crossfeed, which should instead adapt to the new profile)

21. REW-style auto click and drag should quantify what's happening and by how much

22. DSP section: add vertical preamp slider which adjusts to EQ automatically

-- NEW FEATURE: EMERGENCY COFNIG RESET -- 

for major failures/corruption

System > full width card, collapsed by default

sends totally stock xml to the daemon and attempts restart; on failure, user is warned to `systemctl restart hqplayerd`. 

MUST WORK EVEN WHEN HQPLAYERD IS DOWN

UI: use a classic Nintendo controller and make the user input the Contra code (state code in notes, don't make them guess)


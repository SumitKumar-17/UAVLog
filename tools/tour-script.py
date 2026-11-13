#!/usr/bin/env python3
"""Write script/Video_Script.txt, the one script for the video: the narration of the quick (about 7 minute) tour path, generated
from web/src/lib/tour-steps.ts so it never drifts from the app. Steps marked `quick: true` are on the path."""
import re, textwrap
src = open("web/src/lib/tour-steps.ts").read()
found = re.findall(r'\{\s*(quick: true,\s*)?section:\s*"([^"]+)"(.*?)\n\s*(?=\{ (?:quick: true, )?section:|\];)', src, re.S)
steps = [(sec, body) for q, sec, body in found if q]
def field(body, name):
    m = re.search(name + r':\s*"((?:[^"\\]|\\.)*)"', body)
    return m.group(1).replace('\\"', '"') if m else ""
words = sum(len(field(b, "say").split()) for _, b in steps)
# about 130 spoken words a minute, plus roughly 5 s per step for the clicking and typing the tour does for you
minutes = words / 130 + len(steps) * 5 / 60
out = ["SEMANTIC LOG ANALYTICS [UAV LOG]: VIDEO SCRIPT (about 7 minutes)",
       "Sumit Kumar (22CS30056), Advanced Database Management Systems (CS60113) Term Project", "",
       f"This is the only script. {len(steps)} short steps, about {words} spoken words, roughly {minutes:.0f} minutes. The project PPT is submitted separately.", "",
       "HOW TO RECORD",
       "  1. Open the site (the hosted address, or the local one), wait for the Overview to load, and click Tour in the top bar. It starts on the quick path.",
       "  2. Press Enter to do each step's action (it types or clicks for you) and move on; the arrow keys go back and forward.",
       "  3. Press H to hide the card so only the spotlight shows (drag the card by its top edge if it covers something). N shows the narration under the card.",
       "  4. Say the SAY line in your own words. <angle brackets> say what the action is. Press F to switch to the full 90-step tour if you want more.",
       "  The hosted site is read-only: uploads and notes are off.", ""]
last = None
for n, (sec, body) in enumerate(steps, 1):
    if sec != last:
        out += ["", "=" * 70, sec.upper(), "=" * 70]; last = sec
    title, text, hint, say = (field(body, k) for k in ("title", "text", "hint", "say"))
    out.append(f"\n[{n}] {title}" + (f"   <{hint}>" if hint else ""))
    out.append(textwrap.fill("Show: " + text, 100, subsequent_indent="      "))
    if say: out.append(textwrap.fill("SAY:  " + say, 100, subsequent_indent="      "))
open("script/Video_Script.txt", "w").write("\n".join(out) + "\n")
print(len(steps), "steps,", words, "words, about", round(minutes), "minutes")

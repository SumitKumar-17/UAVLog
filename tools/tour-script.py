#!/usr/bin/env python3
"""Write script/Video_Script.txt, the one script for the video: the narration in tour order, generated from web/src/lib/tour-steps.ts so it never drifts from the app."""
import re, textwrap
src = open("web/src/lib/tour-steps.ts").read()
steps = re.findall(r'\{\s*section:\s*"([^"]+)"(.*?)\n\s*(?=\{ section:|\];)', src, re.S)
def field(body, name):
    m = re.search(name + r':\s*"((?:[^"\\]|\\.)*)"', body)
    return m.group(1).replace('\\"', '"') if m else ""
out = ["SEMANTIC LOG ANALYTICS [UAV LOG]: VIDEO SCRIPT",
       "Sumit Kumar (22CS30056), Advanced Database Management Systems (CS60113) Term Project", "",
       "This is the only script. You record the video by driving the app with its built-in Tour; the project PPT is submitted separately as its own file.", "",
       "HOW TO RECORD",
       "  1. Open the site (the hosted address, or the local one), wait for the Overview to load, and click Tour in the top bar.",
       "  2. Press Enter to do each step's action (it types or clicks for you) and move on; the arrow keys go back and forward.",
       "  3. Press H to hide the card so only the spotlight shows. N shows the narration under the card. M jumps between sections. Esc ends the tour.",
       "  4. Read the SAY lines in your own words. Each step names what to show and what to click; <angle brackets> say what the action is.",
       "  The hosted site is read-only: the Upload step (89) only shows the drop zone.", ""]
last = None; n = 0
for sec, body in steps:
    n += 1
    if sec != last:
        out += ["", "=" * 70, sec.upper(), "=" * 70]; last = sec
    title, text, hint, say = (field(body, k) for k in ("title", "text", "hint", "say"))
    out.append(f"\n[{n}] {title}" + (f"   <{hint}>" if hint else ""))
    out.append(textwrap.fill("Show: " + text, 100, subsequent_indent="      "))
    if say: out.append(textwrap.fill("SAY:  " + say, 100, subsequent_indent="      "))
open("script/Video_Script.txt", "w").write("\n".join(out) + "\n")
print(n, "steps")

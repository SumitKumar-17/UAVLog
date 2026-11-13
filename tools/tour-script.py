#!/usr/bin/env python3
"""Write script/Tour_Script.txt: the video narration in tour order, generated from web/src/lib/tour-steps.ts so it never drifts from the app."""
import re, textwrap
src = open("web/src/lib/tour-steps.ts").read()
steps = re.findall(r'\{\s*section:\s*"([^"]+)"(.*?)\n\s*(?=\{ section:|\];)', src, re.S)
def field(body, name):
    m = re.search(name + r':\s*"((?:[^"\\]|\\.)*)"', body)
    return m.group(1).replace('\\"', '"') if m else ""
out = ["TOUR SCRIPT: the whole video, step by step", "",
       "How to record: open the app, click Tour (top bar). Enter does the step's action (typing or clicking for you) and then moves on; the arrow keys go back and forward;",
       "H hides the card so only the spotlight shows on the video; N shows the narration under the card; M jumps between sections; Esc ends.", ""]
last = None; n = 0
for sec, body in steps:
    n += 1
    if sec != last:
        out += ["", "=" * 70, sec.upper(), "=" * 70]; last = sec
    title, text, hint, say = (field(body, k) for k in ("title", "text", "hint", "say"))
    out.append(f"\n[{n}] {title}" + (f"   <{hint}>" if hint else ""))
    out.append(textwrap.fill("Show: " + text, 100, subsequent_indent="      "))
    if say: out.append(textwrap.fill("SAY:  " + say, 100, subsequent_indent="      "))
open("script/Tour_Script.txt", "w").write("\n".join(out) + "\n")
print(n, "steps")

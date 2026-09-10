import subprocess, sys
sys.exit(subprocess.call([
    "python", r"C:\Users\abcom\jpbir\tools\build_jt_chunks.py",
    "--root", r"C:\PHONE NUMBER APP",
    "--label", "code",
    "--out", r"C:\Users\abcom\jpbir\runs\jt_agent\parts\c_phone_app.jsonl"
]))

import subprocess, sys
sys.exit(subprocess.call([
    "python", r"C:\Users\abcom\jpbir\tools\build_jt_chunks.py",
    "--root", r"C:\Final S24",
    "--label", "code",
    "--out", r"C:\Users\abcom\jpbir\runs\jt_agent\parts\c_final_s24.jsonl"
]))

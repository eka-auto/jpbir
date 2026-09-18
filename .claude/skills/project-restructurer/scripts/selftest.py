#!/usr/bin/env python3
"""
selftest.py — Prove the pipeline never loses a file.

Every check here is a regression: each one failed at some point and cost a
file. Run it after touching analyze/plan/apply, before trusting a run on
anything real.

    python3 selftest.py

Exit code 0 = all good, 1 = something regressed.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable or "python3"

_results = []


def run(*args):
    """Invoke one pipeline script; return (exit_code, stdout+stderr)."""
    proc = subprocess.run([PY, os.path.join(HERE, args[0])] + list(args[1:]),
                          capture_output=True, text=True, encoding="utf-8",
                          errors="replace")
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def check(name, got, want):
    ok = got == want
    _results.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}"
          + ("" if ok else f"\n          got  {got!r}\n          want {want!r}"))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def landed(dest):
    """Files actually present in the output, ignoring backup and bookkeeping."""
    out = []
    for root, dirs, files in os.walk(dest):
        if ".restructure_backup" in root:
            continue
        for f in files:
            if f in ("RESTRUCTURE_STATE.json", "INTEGRATION.md"):
                continue
            out.append(os.path.join(root, f))
    return out


def build_fixture(root):
    """A messy project exercising every path that has ever lost a file."""
    f = {
        "src/components/App.tsx": "export default () => null\n",
        "src/components/button.css": ".b{}\n",
        "src/pages/Home.tsx": "export const H = () => null\n",
        "src/pages/café.tsx": "unicode name\n",       # non-ascii
        "api/controllers/userController.js": "x\n",
        "api/services/billing.js": "x\n",
        "db/migrations/001_init.sql": "CREATE TABLE t(id int);\n",
        "db/models/user.js": "x\n",
        "infra/docker/Dockerfile": "FROM node:20\n",
        "vendor/stripe/client.js": "x\n",
        "lib/twilio_sms.js": "x\n",
        "space dir/read me.txt": "spaces in both names\n",   # spaces
        "index.js": "x\n",
        "deploy.sh": "echo hi\n",
        # pinned: tooling finds these only at the root
        ".github/workflows/ci.yml": "name: ci\n",
        "package.json": "{}\n",
        "pyproject.toml": "[project]\nname='x'\n",
        ".gitignore": "node_modules\n",
        ".env.example": "K=v\n",
        "README.md": "# readme\n",
    }
    for rel, body in f.items():
        write(os.path.join(root, *rel.split("/")), body)
    return len(f)


def main():
    tmp = tempfile.mkdtemp(prefix="pr_selftest_")
    try:
        src = os.path.join(tmp, "proj")
        total = build_fixture(src)
        wt = os.path.join(tmp, "wt.json")
        rc, out = run("analyze.py", src, "--out", wt)
        check("analyze exits clean", rc, 0)

        # --- every file survives, in every layout mode --------------------
        for tag, extra in (("flatten", []), ("preserve", ["--preserve-depth"])):
            plan = os.path.join(tmp, f"{tag}.json")
            dest = os.path.join(tmp, f"out_{tag}")
            run("plan.py", wt, "--out", plan, *extra)
            run("apply.py", plan, "--source", src, "--dest", dest)
            check(f"all {total} files land ({tag})", len(landed(dest)), total)

        # --- root anchors are never moved ---------------------------------
        with open(os.path.join(tmp, "preserve.json"), encoding="utf-8") as fh:
            moves = {m["from"]: m["to"] for m in json.load(fh)["moves"]}
        for anchor in (".github/workflows/ci.yml", "package.json",
                       "pyproject.toml", ".gitignore", ".env.example",
                       "README.md"):
            check(f"pinned: {anchor}", moves.get(anchor), anchor)

        # --- name clashes: nothing is silently overwritten ----------------
        # Three files want one name, and a fourth is genuinely called
        # `utils__1.js` — the name the de-duper would otherwise generate.
        c = os.path.join(tmp, "clash")
        for p, body in (("a/services/utils.js", "AAA\n"),
                        ("b/services/utils.js", "BBB\n"),
                        ("c/services/utils.js", "CCC\n"),
                        ("a/services/utils__1.js", "REAL\n")):
            write(os.path.join(c, *p.split("/")), body)
        cwt, cplan = os.path.join(tmp, "c_wt.json"), os.path.join(tmp, "c.json")
        cdest = os.path.join(tmp, "c_out")
        run("analyze.py", c, "--out", cwt)
        run("plan.py", cwt, "--out", cplan)
        run("apply.py", cplan, "--source", c, "--dest", cdest)
        bodies = sorted(open(p, encoding="utf-8").read().strip()
                        for p in landed(cdest))
        check("4 clashing files all survive", bodies,
              ["AAA", "BBB", "CCC", "REAL"])

        # --- case-only clash (Windows/macOS fold Utils.js and utils.js) ---
        k = os.path.join(tmp, "case")
        write(os.path.join(k, "api", "services", "utils.js"), "LOWER\n")
        write(os.path.join(k, "lib", "services", "Utils.js"), "UPPER\n")
        kwt, kplan = os.path.join(tmp, "k_wt.json"), os.path.join(tmp, "k.json")
        kdest = os.path.join(tmp, "k_out")
        run("analyze.py", k, "--out", kwt)
        run("plan.py", kwt, "--out", kplan)
        run("apply.py", kplan, "--source", k, "--dest", kdest)
        kb = sorted(open(p, encoding="utf-8").read().strip()
                    for p in landed(kdest))
        check("case-only clash keeps both", kb, ["LOWER", "UPPER"])

        # --- Phase 4: the handoff file is the skill's stated deliverable --
        # An INTEGRATION.md missing its Entry Points section fails the one job
        # the skill exists for: telling the next agent where to start.
        flat_dest = os.path.join(tmp, "out_flatten")
        rc, out = run("integrate.py", "--dest", flat_dest)
        check("integrate exits clean", rc, 0)
        md_path = os.path.join(flat_dest, "INTEGRATION.md")
        check("INTEGRATION.md written", os.path.isfile(md_path), True)
        md = open(md_path, encoding="utf-8").read() if os.path.isfile(md_path) else ""
        for section in ("Start Here", "Where things live", "Entry Points",
                        "Resume Point"):
            check(f"handoff has '{section}'", section in md, True)

        # --- content-level proof that no bytes were lost ------------------
        # Structural checks above prove a copy was attempted; this proves the
        # bytes arrived.
        rc, out = run("verify.py", "--verify", "--source", src,
                      "--dest", flat_dest)
        check("verify.py finds nothing missing", rc, 0)

        # --- a checked-in build artifact must survive in-place cleanup ----
        # analyze.py skips dist/ as regenerable, so it never enters the plan
        # and never reaches pinned_roots. Cleanup then sees an unrecognised
        # top-level entry and deletes it. Repos that COMMIT their built
        # artifact — a Firebase rules bundle, a vendored worker — lose the
        # very file their deploy config points at, with no error.
        art = os.path.join(tmp, "artifact")
        build_fixture(art)
        write(os.path.join(art, "dist", "firestore.rules"), "rules_version='2';\n")
        write(os.path.join(art, "firebase.json"),
              '{"firestore":{"rules":"dist/firestore.rules"}}\n')
        awt = os.path.join(tmp, "a_wt.json")
        aplan = os.path.join(tmp, "a_plan.json")
        run("analyze.py", art, "--out", awt)
        run("plan.py", awt, "--out", aplan, "--preserve-depth")
        run("apply.py", aplan, "--source", art, "--dest", art)
        check("committed dist/ artifact survives in-place cleanup",
              os.path.isfile(os.path.join(art, "dist", "firestore.rules")), True)

        # --- a hand-edited plan with a duplicate must be refused ----------
        # SKILL.md tells the agent to hand-correct plan JSON, so this is a
        # live path, not a hypothetical.
        bad = os.path.join(tmp, "bad.json")
        with open(os.path.join(tmp, "flatten.json"), encoding="utf-8") as fh:
            p = json.load(fh)
        p["moves"][1]["to"] = p["moves"][0]["to"]
        with open(bad, "w", encoding="utf-8") as fh:
            json.dump(p, fh)
        rc, out = run("apply.py", bad, "--source", src,
                      "--dest", os.path.join(tmp, "bad_out"))
        check("preflight refuses duplicate destinations", rc, 1)
        check("...and copies nothing", os.path.isdir(
            os.path.join(tmp, "bad_out", "Frontend")), False)

        # --- cleanup must never run when a file is unaccounted for --------
        rc, out = run("apply.py", bad, "--source", src, "--dest", src)
        check("in-place cleanup blocked by bad plan", rc, 1)
        check("source survived the refusal",
              os.path.isfile(os.path.join(src, "package.json")), True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    failed = _results.count(False)
    print(f"\n  {_results.count(True)} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

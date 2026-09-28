"""Read-only identity checks. Write results only beside this script."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent
AUDIT = HERE.parent.parent
REPO = AUDIT.parent.parent
manifest = json.loads((AUDIT / "manifest.json").read_text())
SNAPSHOT = Path(manifest["source_snapshot"])
REVISION = manifest["revision"]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(path):
    return sha(path.read_bytes())


def git(*args):
    return subprocess.check_output(["git", "-C", str(REPO), *args])


expected = manifest["file_sha256"]
tree = git("ls-tree", "-r", "--name-only", "-z", REVISION).decode().split("\0")[:-1]
source_checks = []
for name, wanted in expected.items():
    snapshot_hash = digest(SNAPSHOT / name)
    git_hash = sha(git("show", f"{REVISION}:{name}"))
    source_checks.append({"path": name, "manifest": wanted,
                          "snapshot": snapshot_hash, "git_blob": git_hash,
                          "matches": wanted == snapshot_hash == git_hash})

coverage = json.loads((AUDIT / "checks/coverage-map.json").read_text())["files"]
areas = sorted({area for values in coverage.values() for area in values})
area_reports = [f"reports/{area}-{model}.md" for area in areas for model in ("astra", "daybreak")]
reconciliation = json.loads((AUDIT / "reconciliation.json").read_text())
focused_reports = sorted({path for row in reconciliation for path in row["reports"]})
# Never open or hash the paired overall report.
report_inventory = {name: {"sha256": digest(AUDIT / name), "bytes": (AUDIT / name).stat().st_size}
                    for name in area_reports + focused_reports}

archive_record = json.loads((AUDIT / "checks/source-archive.json").read_text())
archive_file = AUDIT / archive_record["archive"]
with tarfile.open(archive_file, "r:gz") as archive:
    archive_hashes = {member.name.removeprefix("./"): sha(archive.extractfile(member).read())
                      for member in archive.getmembers() if member.isfile()}

fixtures = []
for row in json.loads((AUDIT / "checks/fixture-hashes.json").read_text()):
    manifest_path = SNAPSHOT / row["manifest"]
    artifact_path = Path(row["artifact_path"]) if "artifact_path" in row else manifest_path.parent / row["artifact"]
    wanted = json.loads(manifest_path.read_text())["artifacts"][row["artifact"]]["sha256"]
    actual = digest(artifact_path)
    fixtures.append({"path": str(artifact_path), "manifest_sha256": wanted, "sha256": actual,
                     "matches": wanted == actual == row["expected"] == row["actual"]})

locked_versions = []
for row in json.loads((AUDIT / "checks/locked-soroban-versions.json").read_text()):
    lock = SNAPSHOT / "fixtures" / row["file"]
    versions = {}
    for package in lock.read_text().split("[[package]]")[1:]:
        name = re.search(r'^name = "([^"]+)"$', package, re.M)
        version = re.search(r'^version = "([^"]+)"$', package, re.M)
        if name and version and name.group(1) in ("soroban-sdk", "soroban-env-host"):
            versions[name.group(1)] = version.group(1)
    locked_versions.append({"file": str(lock), "versions": versions,
                            "matches_record": versions == row["versions"]})

delta_record = json.loads((AUDIT / "checks/concurrent-source-change.json").read_text())
delta_name = delta_record["file"]
patch = git("diff", "--no-ext-diff", "--no-textconv", REVISION, "--", delta_name)
saved_patch = (AUDIT / "checks/concurrent-source-change.patch").read_bytes()
delta = {"file": delta_name, "frozen_sha256": digest(SNAPSHOT / delta_name),
         "current_sha256": digest(REPO / delta_name), "patch_sha256": sha(patch),
         "saved_patch_sha256": sha(saved_patch), "patch_bytes_match": patch == saved_patch,
         "current_matches_record": digest(REPO / delta_name) == delta_record["current_sha256"],
         "authorship": "Not attributed", "review": "Accepted within existing manual testnet workflow"}

inputs = ["REPORT.md", "CONCERNS.md", "FEATURES.md", "ARCHITECTURE.md", "RESEARCH.md",
          "reconciliation.json", "manifest.json", "checks/coverage-map.json",
          "checks/baseline-permitted-results.json", "checks/rust-summary.json",
          "checks/BROWSER.md", "checks/coordinator-checkpoint-versions.json",
          "checks/coordinator-verification.txt", "checks/artifact-pattern-scan.json",
          "checks/locked-soroban-versions.json"]
checks = {
    "snapshot_and_git_identity": len(tree) == len(expected) == 199 and set(tree) == set(expected)
        and all(row["matches"] for row in source_checks),
    "coverage": set(coverage) == set(expected) and all(coverage.values()) and len(areas) == 8,
    "all_prior_reports": len(area_reports) == 16 and len(focused_reports) == 40
        and all(row["bytes"] > 0 for row in report_inventory.values()),
    "baseline_archive": archive_hashes == expected and digest(archive_file) == archive_record["sha256"],
    "fixture_hashes": len(fixtures) == 14 and all(row["matches"] for row in fixtures),
    "locked_soroban_versions": len(locked_versions) == 4
        and all(row["matches_record"] for row in locked_versions),
    "concurrent_delta_identity": delta["patch_bytes_match"] and delta["current_matches_record"],
}
result = {"checked_utc": datetime.now(timezone.utc).isoformat(), "revision": REVISION,
          "snapshot": str(SNAPSHOT), "checks": checks, "passed": all(checks.values()),
          "tracked_paths": len(tree), "source_checks": source_checks,
          "areas": areas, "reports": report_inventory,
          "coordinator_input_sha256": {name: digest(AUDIT / name) for name in inputs},
          "decisions": dict(Counter(row["status"] for row in reconciliation)),
          "confirmed_severities": dict(Counter(row["severity"] for row in reconciliation if row["status"] == "confirmed")),
          "fixture_checks": fixtures, "locked_soroban_versions": locked_versions,
          "archive_sha256": digest(archive_file), "delta": delta,
          "paired_overall_read": False,
          "final_packaging": "pending coordinator archival and normal repository checks",
          "behavioral_suites": "not repeated; existing evidence reviewed"}
(HERE / "integrity.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({key: result[key] for key in ("checked_utc", "checks", "passed", "decisions", "confirmed_severities", "delta")}, indent=2))
raise SystemExit(0 if result["passed"] else 1)

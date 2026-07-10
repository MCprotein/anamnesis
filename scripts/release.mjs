#!/usr/bin/env node

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";

const REPO = "MCprotein/anamnesis";
const NPMJS_REGISTRY = "https://registry.npmjs.org";
const GITHUB_PACKAGES_REGISTRY = "https://npm.pkg.github.com";
const RETRIEVAL_BENCHMARK_PATH =
  "docs/benchmark-evidence/retrieval-source-pointers/retrieval-source-pointers.json";
const RELEASE_DIRTY_ALLOWLIST = [
  "package.json",
  "package-lock.json",
  "CHANGELOG.md",
  "README.md",
  ".anamnesis/evidence/events.jsonl",
  "docs/DOGFOOD.md",
  "docs/BENCHMARK-GALLERY.md",
  "docs/benchmark-evidence/",
];

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  try {
    switch (command) {
      case "prepare":
        prepare(args);
        break;
      case "publish":
        publish(args);
        break;
      case "verify":
        verify(args);
        break;
      case "status":
        status();
        break;
      default:
        usage(command ? `unknown command: ${command}` : undefined);
        process.exit(command ? 1 : 0);
    }
  } catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq >= 0) {
        args[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function usage(error) {
  if (error) console.error(`release: ${error}`);
  console.log(`Usage:
  npm run release:status
  npm run release:prepare -- --version X.Y.Z [--dry-run] [--skip-checks]
  npm run release:publish -- --version X.Y.Z [--dry-run] [--skip-checks] [--push] [--cleanup-branch]
  npm run release:verify -- --version X.Y.Z

Flow:
  1. Put release notes under CHANGELOG.md "## [Unreleased]".
  2. Run release:prepare. It updates package.json, package-lock.json,
     CHANGELOG.md, and README patch metadata when applicable, then refreshes
     release evidence and runs npm run release:check.
  3. Run release:publish -- --version X.Y.Z --push. It commits release files,
     fast-forwards release/hotfix branches into main, tags vX.Y.Z, and pushes
     main plus the tag. The tag workflow publishes npmjs.org, GitHub Packages,
     and the GitHub Release.
  4. Run release:verify after the workflow completes.`);
}

function prepare(args) {
  const version = requiredVersion(args);
  const dryRun = args["dry-run"] === true;
  const skipChecks = args["skip-checks"] === true;

  assertRepoRoot();
  if (!dryRun) assertNoNonReleaseDirtyForPrepare();

  const current = readPackageJson().version;
  assertVersionIncreases(current, version);

  const releaseDate = new Date().toISOString().slice(0, 10);
  const updates = buildPrepareUpdates(version, releaseDate);

  console.log(`release prepare ${current} -> ${version}`);
  for (const update of updates) {
    console.log(`  ${dryRun ? "would update" : "update"} ${update.file}`);
  }

  if (!dryRun) {
    for (const update of updates) {
      fs.writeFileSync(update.file, update.next);
    }
    if (!skipChecks) {
      run("npm", ["run", "dogfood"]);
      run("npm", ["run", "benchmark:retrieval"]);
      assertRetrievalBenchmarkVersion(version);
      run("npm", ["run", "benchmark:gallery"]);
      run("npm", ["run", "release:check"]);
    }
  }

  const warnings = updates.flatMap((update) => update.warnings ?? []);
  for (const warning of warnings) {
    console.log(`  warning: ${warning}`);
  }

  if (dryRun) {
    console.log("dry-run complete; no files written");
  } else {
    console.log("release prepare complete; run release:publish after reviewing the diff");
  }
}

function publish(args) {
  const version = requiredVersion(args);
  const dryRun = args["dry-run"] === true;
  const skipChecks = args["skip-checks"] === true;
  const shouldPush = args.push === true;
  const cleanupBranch = args["cleanup-branch"] === true;

  assertRepoRoot();
  assertPreparedVersion(version);
  assertRetrievalBenchmarkVersion(version);

  if (!skipChecks && !dryRun) {
    run("npm", ["run", "release:check"]);
  }

  const dirtyFiles = gitDirtyFiles();
  const disallowed = dirtyFiles.filter((file) => !isAllowedReleaseDirty(file));
  if (disallowed.length > 0) {
    throw new Error(
      `refusing to auto-commit non-release dirty files:\n${disallowed
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }

  const originalBranch = currentBranch();
  const tag = `v${version}`;

  console.log(`release publish ${tag}`);
  if (dirtyFiles.length > 0) {
    console.log(`  ${dryRun ? "would commit" : "commit"} ${dirtyFiles.length} release file(s)`);
    if (!dryRun) {
      run("git", ["add", ...dirtyFiles]);
      run("git", [
        "commit",
        "-m",
        `Release ${version}`,
        "-m",
        "Prepare a versioned release state so the tag workflow can publish all external artifacts from one commit.",
        "-m",
        "Constraint: package version, changelog, release evidence, git tag, npmjs.org, GitHub Packages, and GitHub Release must stay aligned.",
        "-m",
        "Rejected: manual checklist-only release steps | they repeatedly allowed registry, tag, and GitHub Release drift.",
        "-m",
        "Confidence: high",
        "-m",
        "Scope-risk: narrow",
        "-m",
        "Directive: use scripts/release.mjs for future release cuts; do not publish by hand unless the documented recovery path is active.",
        "-m",
        "Tested: npm run release:check",
        "-m",
        "Not-tested: live tag workflow execution before push",
      ]);
    }
  } else {
    console.log("  no release file changes to commit");
  }

  if (originalBranch !== "main") {
    if (!/^(release|hotfix)\//.test(originalBranch)) {
      throw new Error(
        `refusing to merge from branch '${originalBranch}'. Use main, release/*, or hotfix/* for release publish.`,
      );
    }
    console.log(`  ${dryRun ? "would fast-forward" : "fast-forward"} ${originalBranch} -> main`);
    if (!dryRun) {
      run("git", ["switch", "main"]);
      run("git", ["merge", "--ff-only", originalBranch]);
    }
  }

  if (tagExists(tag)) {
    throw new Error(`${tag} already exists locally; refusing to retag`);
  }

  console.log(`  ${dryRun ? "would tag" : "tag"} ${tag}`);
  if (!dryRun) {
    run("git", ["tag", tag]);
  }

  if (shouldPush) {
    console.log(`  ${dryRun ? "would push" : "push"} origin main ${tag}`);
    if (!dryRun) {
      run("git", ["push", "origin", "main", tag]);
    }

    if (cleanupBranch && originalBranch !== "main") {
      console.log(`  ${dryRun ? "would delete" : "delete"} merged branch ${originalBranch}`);
      if (!dryRun) {
        run("git", ["branch", "-d", originalBranch]);
        if (commandOk("git", ["ls-remote", "--exit-code", "origin", `refs/heads/${originalBranch}`])) {
          run("git", ["push", "origin", "--delete", originalBranch]);
        } else {
          console.log(`  remote branch ${originalBranch} not found; local cleanup complete`);
        }
      }
    }
  } else {
    console.log(`  next: git push origin main ${tag}`);
  }
}

function verify(args) {
  const version = requiredVersion(args);
  const pkg = readPackageJson().name;
  const tag = `v${version}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anamnesis-release-verify-"));

  console.log(`release verify ${tag}`);
  const npmjs = capture("npm", [
    "view",
    `${pkg}@${version}`,
    "version",
    "--registry",
    NPMJS_REGISTRY,
  ]).trim();
  const github = capture("npm", [
    "view",
    `${pkg}@${version}`,
    "version",
    "--registry",
    GITHUB_PACKAGES_REGISTRY,
  ]).trim();
  if (npmjs !== version) throw new Error(`npmjs.org returned ${npmjs}, expected ${version}`);
  if (github !== version) throw new Error(`GitHub Packages returned ${github}, expected ${version}`);

  run("gh", ["release", "view", tag, "--repo", REPO], { stdio: "pipe" });

  const npmjsCli = capture(
    "npm",
    [
      "exec",
      `--@mcprotein:registry=${NPMJS_REGISTRY}/`,
      "--yes",
      `--package=${pkg}@${version}`,
      "--",
      "anamnesis",
      "--version",
    ],
    { cwd: tmp },
  ).trim();
  const githubCli = capture(
    "npm",
    [
      "exec",
      `--@mcprotein:registry=${GITHUB_PACKAGES_REGISTRY}/`,
      "--yes",
      `--package=${pkg}@${version}`,
      "--",
      "anamnesis",
      "--version",
    ],
    { cwd: tmp },
  ).trim();

  if (npmjsCli !== version) throw new Error(`npmjs.org CLI returned ${npmjsCli}, expected ${version}`);
  if (githubCli !== version) throw new Error(`GitHub Packages CLI returned ${githubCli}, expected ${version}`);

  console.log(`  npmjs.org: ${npmjs}`);
  console.log(`  GitHub Packages: ${github}`);
  console.log(`  GitHub Release: ${tag}`);
  console.log(`  CLI smoke: ${npmjsCli} / ${githubCli}`);
}

function status() {
  assertRepoRoot();
  const pkg = readPackageJson();
  const tag = `v${pkg.version}`;
  const releaseExists = commandOk("gh", ["release", "view", tag, "--repo", REPO]);
  const tagLocal = tagExists(tag);
  const tagRemote = commandOk("git", ["ls-remote", "--exit-code", "origin", `refs/tags/${tag}`]);

  console.log("release status");
  console.log(`  package: ${pkg.name}@${pkg.version}`);
  console.log(`  branch: ${currentBranch()}`);
  console.log(`  local tag ${tag}: ${tagLocal ? "yes" : "no"}`);
  console.log(`  remote tag ${tag}: ${tagRemote ? "yes" : "no"}`);
  console.log(`  GitHub Release ${tag}: ${releaseExists ? "yes" : "no"}`);
  console.log(`  dirty files: ${gitDirtyFiles().length}`);
}

function buildPrepareUpdates(version, releaseDate) {
  const packageJson = readPackageJson();
  const packageLock = readJson("package-lock.json");
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");

  packageJson.version = version;
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }

  const changelogResult = promoteUnreleased(changelog, version, releaseDate);
  const readmeResult = updateReadmePatch(readme, version);

  return [
    {
      file: "package.json",
      next: `${JSON.stringify(packageJson, null, 2)}\n`,
    },
    {
      file: "package-lock.json",
      next: `${JSON.stringify(packageLock, null, 2)}\n`,
    },
    {
      file: "CHANGELOG.md",
      next: changelogResult,
    },
    {
      file: "README.md",
      next: readmeResult.next,
      warnings: readmeResult.changed ? [] : [readmeResult.reason],
    },
  ].filter((update) => fs.readFileSync(update.file, "utf8") !== update.next);
}

function promoteUnreleased(changelog, version, releaseDate) {
  if (changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md already has a ${version} section`);
  }

  const heading = "## [Unreleased]";
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error("CHANGELOG.md is missing ## [Unreleased]");

  const headingEnd = changelog.indexOf("\n", start);
  if (headingEnd < 0) throw new Error("CHANGELOG.md Unreleased heading is malformed");

  const bodyStart = headingEnd + 1;
  const afterHeading = changelog.slice(bodyStart);
  const nextSection = afterHeading.search(/\n## \[/);
  const unreleasedBody = nextSection >= 0 ? afterHeading.slice(0, nextSection) : afterHeading;
  const rest = nextSection >= 0 ? afterHeading.slice(nextSection) : "";
  const body = unreleasedBody.trim();

  if (body.length === 0) {
    throw new Error("CHANGELOG.md Unreleased section is empty; add release notes before prepare");
  }

  return `${changelog.slice(0, bodyStart)}\n## [${version}] — ${releaseDate}\n\n${body}\n${rest}`;
}

function updateReadmePatch(readme, version) {
  const [major, minor] = version.split(".");
  const rowPattern = new RegExp(
    `(\\| \\*\\*v${escapeRegExp(`${major}.${minor}`)}\\*\\* \\|[^\\n]*\\| )([^|\\n]*)( \\|)`,
  );
  const match = readme.match(rowPattern);
  if (!match) {
    return {
      next: readme,
      changed: false,
      reason: `README roadmap row for v${major}.${minor} not found; update release docs manually if this is a new minor.`,
    };
  }

  const statusText = match[2];
  if (!statusText.includes("shipped")) {
    return {
      next: readme,
      changed: false,
      reason: `README roadmap row for v${major}.${minor} is not shipped yet; update it manually when cutting the first release for that minor.`,
    };
  }

  const nextStatus = /latest patch \d+\.\d+\.\d+/.test(statusText)
    ? statusText.replace(/latest patch \d+\.\d+\.\d+/, `latest patch ${version}`)
    : `${statusText}; latest patch ${version}`;

  return {
    next: readme.replace(rowPattern, `$1${nextStatus}$3`),
    changed: nextStatus !== statusText,
    reason: "",
  };
}

function assertPreparedVersion(version) {
  const pkg = readPackageJson();
  const lock = readJson("package-lock.json");
  if (pkg.version !== version) {
    throw new Error(`package.json version is ${pkg.version}, expected ${version}`);
  }
  if (lock.version !== version || lock.packages?.[""]?.version !== version) {
    throw new Error(`package-lock.json is not aligned to ${version}`);
  }
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  if (!changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md is missing ## [${version}]`);
  }
}

function requiredVersion(args) {
  const version = args.version;
  if (typeof version !== "string") {
    throw new Error("--version X.Y.Z is required");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`invalid semver version '${version}'`);
  }
  return version;
}

function assertVersionIncreases(current, next) {
  const a = current.split(".").map(Number);
  const b = next.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return;
    if (b[i] < a[i]) break;
  }
  throw new Error(`next version ${next} must be greater than current ${current}`);
}

function assertRepoRoot() {
  if (!fs.existsSync("package.json") || !fs.existsSync(".git")) {
    throw new Error("run this command from the anamnesis repository root");
  }
  const pkg = readPackageJson();
  if (pkg.name !== "@mcprotein/anamnesis") {
    throw new Error(`wrong package root: ${pkg.name}`);
  }
}

function assertNoNonReleaseDirtyForPrepare() {
  const dirty = gitDirtyFiles();
  const disallowed = dirty.filter((file) => !isAllowedReleaseDirty(file));
  if (disallowed.length > 0) {
    throw new Error(
      `release prepare refuses non-release dirty files:\n${disallowed
        .map((file) => `  - ${file}`)
        .join("\n")}`,
    );
  }
  if (dirty.length > 0) {
    console.log(`release prepare will preserve existing release-file edits: ${dirty.join(", ")}`);
  }
}

function assertRetrievalBenchmarkVersion(version) {
  if (!fs.existsSync(RETRIEVAL_BENCHMARK_PATH)) {
    throw new Error(
      `missing retrieval benchmark evidence: ${RETRIEVAL_BENCHMARK_PATH}`,
    );
  }
  const evidence = readJson(RETRIEVAL_BENCHMARK_PATH);
  const actual = evidence?.provenance?.packageVersion;
  if (actual !== version) {
    throw new Error(
      `retrieval benchmark package version is ${actual ?? "missing"}, expected ${version}; run npm run benchmark:retrieval`,
    );
  }
}

function gitDirtyFiles() {
  const output = capture("git", ["status", "--porcelain"], { trim: false });
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3))
    .map((file) => (file.includes(" -> ") ? file.split(" -> ").at(-1) : file));
}

function currentBranch() {
  return capture("git", ["branch", "--show-current"]).trim();
}

function tagExists(tag) {
  return commandOk("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
}

function isAllowedReleaseDirty(file) {
  return RELEASE_DIRTY_ALLOWLIST.some((allowed) =>
    allowed.endsWith("/") ? file.startsWith(allowed) : file === allowed,
  );
}

function readPackageJson() {
  return readJson("package.json");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result;
}

function capture(command, args, options = {}) {
  const result = cp.spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${detail ? `:\n${detail}` : ""}`,
    );
  }
  return options.trim === false ? result.stdout : result.stdout.trim();
}

function commandOk(command, args) {
  const result = cp.spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
  });
  return result.status === 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();

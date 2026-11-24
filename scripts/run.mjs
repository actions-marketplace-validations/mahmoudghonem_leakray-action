import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const COMMENT_MARKER = "<!-- leakray-action-comment -->";
const VALID_FAIL_ON = new Set(["critical", "high", "medium", "low", "info"]);

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  appendFileSync(outputPath, `${name}=${String(value)}\n`, "utf8");
}

function appendStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  appendFileSync(summaryPath, `${markdown}\n`, "utf8");
}

function gradeBadgeEmoji(grade) {
  if (grade === "A+" || grade === "A") return "🟢";
  if (grade === "B" || grade === "C") return "🟡";
  return "🔴";
}

function formatSummaryMarkdown(report, failOn, thresholdFailed) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const actionable = findings.filter((f) => f.severity !== "info");
  const infoCount = findings.length - actionable.length;
  const statusLine = thresholdFailed
    ? `❌ Failed threshold (\`--fail-on ${failOn}\`)`
    : `✅ Passed${failOn && failOn !== "none" ? ` (\`--fail-on ${failOn}\`)` : ""}`;

  const lines = [
    COMMENT_MARKER,
    `## ${gradeBadgeEmoji(report.grade)} LeakRay Security Scan — **${report.score}/100 (${report.grade})**`,
    "",
    `| Target | Status | Findings | Duration |`,
    `| :--- | :--- | :--- | :--- |`,
    `| \`${report.targetUrl}\` | ${statusLine} | ${actionable.length} actionable${infoCount > 0 ? `, ${infoCount} info` : ""} | ${(Number(report.durationMs || 0) / 1000).toFixed(2)}s |`,
    "",
  ];

  if (findings.length === 0) {
    lines.push("No issues detected across all 22 passive security checks.");
  } else {
    lines.push("| Severity | Finding | Rule |", "| :--- | :--- | :--- |");
    for (const f of findings.slice(0, 15)) {
      const title = String(f.title ?? "").replace(/\|/g, "\\|");
      lines.push(`| **${String(f.severity ?? "info").toUpperCase()}** | ${title} | \`${f.ruleId}\` |`);
    }
    if (findings.length > 15) {
      lines.push("", `_...and ${findings.length - 15} more finding(s)._`);
    }
  }

  lines.push(
    "",
    `_Scanned passively by [LeakRay](https://leakray.dev) (\`npx leakray\`) — zero false positives on public client keys._`,
  );

  return lines.join("\n");
}

async function upsertPrComment(markdown, token) {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repo || !eventPath) {
    return;
  }

  let prNumber;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    prNumber = event?.pull_request?.number ?? event?.issue?.number;
  } catch {
    return;
  }

  if (!prNumber) {
    return;
  }

  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "leakray-action",
  };

  try {
    const listRes = await fetch(
      `${apiBase}/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
      { headers },
    );
    if (!listRes.ok) {
      console.warn(`LeakRay: could not list PR comments (HTTP ${listRes.status}).`);
      return;
    }

    const comments = await listRes.json();
    const existing = Array.isArray(comments)
      ? comments.find((c) => typeof c?.body === "string" && c.body.includes(COMMENT_MARKER))
      : null;

    const targetUrl = existing
      ? `${apiBase}/repos/${repo}/issues/comments/${existing.id}`
      : `${apiBase}/repos/${repo}/issues/${prNumber}/comments`;

    const saveRes = await fetch(targetUrl, {
      method: existing ? "PATCH" : "POST",
      headers,
      body: JSON.stringify({ body: markdown }),
    });

    if (!saveRes.ok) {
      console.warn(`LeakRay: could not post PR comment (HTTP ${saveRes.status}). Ensure 'pull-requests: write' permission is set.`);
    }
  } catch (error) {
    console.warn(`LeakRay: skipping PR comment (${error instanceof Error ? error.message : String(error)}).`);
  }
}

async function main() {
  const url = (process.env.INPUT_URL || "").trim();
  if (!url) {
    console.error("Error: 'url' input is required.");
    process.exit(2);
  }

  const failOnRaw = (process.env.INPUT_FAIL_ON || "high").trim().toLowerCase();
  const failOn = failOnRaw === "none" || failOnRaw === "" ? null : failOnRaw;
  if (failOn && !VALID_FAIL_ON.has(failOn)) {
    console.error(`Error: invalid fail-on "${failOnRaw}". Expected critical|high|medium|low|info|none.`);
    process.exit(2);
  }

  const allowLocal = (process.env.INPUT_ALLOW_LOCAL || "false").trim().toLowerCase() === "true";
  const timeout = (process.env.INPUT_TIMEOUT || "20000").trim();
  const commentOnPr = (process.env.INPUT_COMMENT_ON_PR || "true").trim().toLowerCase() === "true";
  const cliVersion = (process.env.INPUT_CLI_VERSION || "latest").trim() || "latest";
  const token = process.env.INPUT_GITHUB_TOKEN || "";

  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["-y", `leakray@${cliVersion}`, url, "--json", "--timeout", timeout];
  if (allowLocal) {
    args.push("--allow-local");
  }
  if (failOn) {
    args.push("--fail-on", failOn);
  }

  const run = spawnSync(npxCmd, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32",
  });

  if (run.stderr) {
    process.stderr.write(run.stderr);
  }

  if (run.error) {
    console.error(`LeakRay execution failed: ${run.error.message}`);
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(run.stdout || "");
  } catch {
    console.error("LeakRay did not return valid JSON output.");
    if (run.stdout) {
      process.stdout.write(run.stdout);
    }
    process.exit(run.status || 2);
  }

  const findings = Array.isArray(report.findings) ? report.findings : [];
  const actionable = findings.filter((f) => f.severity !== "info");

  setOutput("score", report.score ?? 0);
  setOutput("grade", report.grade ?? "F");
  setOutput("findings_count", findings.length);
  setOutput("actionable_count", actionable.length);

  const thresholdFailed = run.status === 1;
  const markdown = formatSummaryMarkdown(report, failOn ?? "none", thresholdFailed);
  appendStepSummary(markdown);

  console.log(
    `LeakRay: ${report.targetUrl} -> ${report.score}/100 (${report.grade}) | ${actionable.length} actionable, ${findings.length - actionable.length} info`,
  );

  if (commentOnPr) {
    await upsertPrComment(markdown, token);
  }

  process.exit(run.status ?? 0);
}

void main();

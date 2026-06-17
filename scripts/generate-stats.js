/**
 * Script untuk mengambil data kontribusi GitHub secara langsung
 * melalui GraphQL API resmi GitHub, lalu merender hasilnya
 * sebagai file SVG (stats.svg) yang ditampilkan di README.
 *
 * Dijalankan otomatis oleh GitHub Actions, menggunakan token
 * bawaan GITHUB_TOKEN yang disuntikkan sebagai environment variable.
 */

const fs = require("fs");
const https = require("https");

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GH_TOKEN;

if (!USERNAME || !TOKEN) {
  console.error("GITHUB_USERNAME atau GH_TOKEN tidak ditemukan di environment.");
  process.exit(1);
}

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    name
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalRepositoryContributions
      contributionCalendar {
        totalContributions
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        primaryLanguage {
          name
          color
        }
      }
    }
  }
}
`;

function graphqlRequest(query, variables) {
  const payload = JSON.stringify({ query, variables });

  const options = {
    hostname: "api.github.com",
    path: "/graphql",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `bearer ${TOKEN}`,
      "User-Agent": "taramel-stats-action",
      "Content-Length": Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API merespons dengan status ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) {
            reject(new Error(JSON.stringify(parsed.errors)));
            return;
          }
          resolve(parsed.data);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function computeLanguageBreakdown(repositories) {
  const totals = {};
  let totalRepos = 0;

  for (const repo of repositories) {
    if (repo.primaryLanguage) {
      const name = repo.primaryLanguage.name;
      const color = repo.primaryLanguage.color || "#999999";
      if (!totals[name]) {
        totals[name] = { count: 0, color };
      }
      totals[name].count += 1;
      totalRepos += 1;
    }
  }

  const breakdown = Object.entries(totals)
    .map(([name, info]) => ({
      name,
      color: info.color,
      percentage: totalRepos > 0 ? (info.count / totalRepos) * 100 : 0,
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 5);

  return breakdown;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderStatsCard({ totalCommits, totalPRs, totalIssues, totalContributions, totalStars, contributedTo }) {
  const rows = [
    { icon: "★", label: "Total Stars Earned", value: totalStars },
    { icon: "●", label: "Total Commits (last year)", value: totalCommits },
    { icon: "⑂", label: "Total PRs", value: totalPRs },
    { icon: "!", label: "Total Issues", value: totalIssues },
    { icon: "▤", label: "Contributed to (last year)", value: contributedTo },
  ];

  const rowHeight = 30;
  const startY = 75;

  const rowsSvg = rows
    .map((row, i) => {
      const y = startY + i * rowHeight;
      return `
    <text x="25" y="${y}" class="icon">${row.icon}</text>
    <text x="50" y="${y}" class="label">${escapeXml(row.label)}:</text>
    <text x="340" y="${y}" class="value" text-anchor="end">${row.value}</text>`;
    })
    .join("");

  return `<svg width="420" height="260" viewBox="0 0 420 260" xmlns="http://www.w3.org/2000/svg">
  <style>
    .bg { fill: #0d0d1a; }
    .title { font: 600 18px "Segoe UI", Ubuntu, sans-serif; fill: #e94560; }
    .label { font: 600 13px "Segoe UI", Ubuntu, sans-serif; fill: #a8a8b3; }
    .value { font: 600 13px "Segoe UI", Ubuntu, sans-serif; fill: #ffffff; }
    .icon { font: 600 13px "Segoe UI", Ubuntu, sans-serif; fill: #e94560; }
    .footer { font: 400 11px "Segoe UI", Ubuntu, sans-serif; fill: #6b6b7a; }
  </style>
  <rect class="bg" width="420" height="260" rx="10" />
  <text x="25" y="35" class="title">Tara Amelia's GitHub Stats</text>
  ${rowsSvg}
  <text x="25" y="245" class="footer">Diperbarui otomatis melalui GitHub Actions · Total kontribusi setahun: ${totalContributions}</text>
</svg>`;
}

function renderLanguagesCard(breakdown) {
  const barWidth = 380;
  const barHeight = 12;
  const barY = 60;

  let offsetX = 20;
  const segments = breakdown
    .map((lang) => {
      const segmentWidth = (lang.percentage / 100) * barWidth;
      const rect = `<rect x="${offsetX}" y="${barY}" width="${segmentWidth}" height="${barHeight}" rx="6" fill="${lang.color}" />`;
      offsetX += segmentWidth;
      return rect;
    })
    .join("");

  const legend = breakdown
    .map((lang, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 20 + col * 200;
      const y = 100 + row * 28;
      return `
    <circle cx="${x}" cy="${y}" r="5" fill="${lang.color}" />
    <text x="${x + 14}" y="${y + 4}" class="label">${escapeXml(lang.name)} ${lang.percentage.toFixed(2)}%</text>`;
    })
    .join("");

  return `<svg width="420" height="220" viewBox="0 0 420 220" xmlns="http://www.w3.org/2000/svg">
  <style>
    .bg { fill: #0d0d1a; }
    .title { font: 600 18px "Segoe UI", Ubuntu, sans-serif; fill: #e94560; }
    .label { font: 600 12px "Segoe UI", Ubuntu, sans-serif; fill: #a8a8b3; }
  </style>
  <rect class="bg" width="420" height="220" rx="10" />
  <text x="20" y="35" class="title">Most Used Languages</text>
  ${segments}
  ${legend}
</svg>`;
}

async function main() {
  const data = await graphqlRequest(QUERY, { login: USERNAME });
  const user = data.user;

  const totalCommits = user.contributionsCollection.totalCommitContributions;
  const totalPRs = user.contributionsCollection.totalPullRequestContributions;
  const totalIssues = user.contributionsCollection.totalIssueContributions;
  const totalContributions = user.contributionsCollection.contributionCalendar.totalContributions;
  const contributedTo = user.contributionsCollection.totalRepositoryContributions;

  const totalStars = user.repositories.nodes.reduce(
    (sum, repo) => sum + repo.stargazerCount,
    0
  );

  const languageBreakdown = computeLanguageBreakdown(user.repositories.nodes);

  const statsSvg = renderStatsCard({
    totalCommits,
    totalPRs,
    totalIssues,
    totalContributions,
    totalStars,
    contributedTo,
  });

  const languagesSvg = renderLanguagesCard(languageBreakdown);

  fs.mkdirSync("assets", { recursive: true });
  fs.writeFileSync("assets/stats.svg", statsSvg, "utf-8");
  fs.writeFileSync("assets/languages.svg", languagesSvg, "utf-8");

  console.log("Berhasil membuat assets/stats.svg dan assets/languages.svg");
  console.log(`Total commits: ${totalCommits}, Total contributions: ${totalContributions}`);
}

main().catch((err) => {
  console.error("Gagal membuat stats:", err.message);
  process.exit(1);
});

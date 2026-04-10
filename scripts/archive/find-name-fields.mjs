import { readFileSync } from "node:fs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/find-name-fields.mjs <path>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(filePath, "utf8"));
const matches = [];

function walk(node, path) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`));
    return;
  }

  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const next = `${path}.${key}`;
      if (key.toLowerCase().includes("name")) {
        matches.push({ key, path: next });
      }
      walk(value, next);
    }
  }
}

walk(data, "$");

const grouped = new Map();
for (const row of matches) {
  if (!grouped.has(row.key)) grouped.set(row.key, []);
  grouped.get(row.key).push(row.path);
}

const keys = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

const result = {
  file: filePath,
  totalMatches: matches.length,
  uniqueKeys: keys.length,
  keys: keys.map((k) => ({
    key: k,
    count: grouped.get(k).length,
    samplePaths: grouped.get(k).slice(0, 5),
  })),
};

console.log(JSON.stringify(result, null, 2));

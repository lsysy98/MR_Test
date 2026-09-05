const DEFAULT_CIMS_SHEET_ID = "1ciVrJFqZyrXQvgBxZtSLwn9MxvOculLugDERIpHeEkY";
const DEFAULT_CIMS_SHEET_GID = "0";
const DEFAULT_STATS_SHEET_ID = "18g8f_EtcBQ7bMTg8rwnkHUsMxmHFAxoAz7hcF9weFm8";
const DEFAULT_STATS_SHEET_GID = "627148657";

const CIMS_SHEET_ID =
  process.env.CIMS_SHEET_ID ||
  process.env.CLIENT_DIRECTORY_SHEET_ID ||
  process.env.CLIENT_SHEET_ID ||
  process.env.GOOGLE_SHEET_ID ||
  DEFAULT_CIMS_SHEET_ID;
const CIMS_SHEET_GID =
  process.env.CIMS_SHEET_GID ||
  process.env.CLIENT_DIRECTORY_SHEET_GID ||
  process.env.CLIENT_SHEET_GID ||
  process.env.GOOGLE_SHEET_GID ||
  DEFAULT_CIMS_SHEET_GID;
const STATS_SHEET_ID =
  process.env.CLIENT_STATS_SHEET_ID ||
  process.env.PRESCRIPTION_STATS_SHEET_ID ||
  DEFAULT_STATS_SHEET_ID;
const STATS_SHEET_GID =
  process.env.CLIENT_STATS_SHEET_GID ||
  process.env.PRESCRIPTION_STATS_SHEET_GID ||
  DEFAULT_STATS_SHEET_GID;
const TEAM_OWNERS = ["성진욱", "김무영", "이승엽", "김태홍", "제성규", "송진영", "이현욱"];

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.end(JSON.stringify(data));
}

function cleanCell(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function normalize(value) {
  return cleanCell(value).replace(/\s+/g, "").toLowerCase();
}

function normalizeOwner(value) {
  return normalize(value);
}

function normalizeBranch(value) {
  return normalize(value)
    .replace(/[()（）\[\]{}]/g, "")
    .replace(/사업장명|사업장|영업소|지점명|지점|센터/g, "");
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const clean = cleanCell(value);
    const key = normalize(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(clean);
  });
  return result;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function findColumn(header, names) {
  const keys = names.map(normalize);
  for (let i = 0; i < header.length; i += 1) {
    const key = normalize(header[i]);
    if (keys.some((name) => key === name || key.includes(name))) return i;
  }
  return -1;
}

function findCimsHeaderIndex(rows) {
  return rows.findIndex((row, index) => {
    if (index > 20) return false;
    return /거래처|치과/.test(normalize(row[1])) || /거래처코드|코드/.test(normalize(row[0]));
  });
}

function findCimsOwnerIndex(rows, headerIndex) {
  if (headerIndex >= 0) {
    const headerMatch = findColumn(rows[headerIndex], ["MR담당자명", "담당자명", "담당자", "MR"]);
    if (headerMatch >= 0) return headerMatch;
  }

  const ownerSet = new Set(TEAM_OWNERS.map(normalizeOwner));
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let bestIndex = -1;
  let bestCount = 0;
  for (let column = 0; column < maxColumns; column += 1) {
    let count = 0;
    rows.slice(0, 500).forEach((row) => {
      if (ownerSet.has(normalizeOwner(row[column]))) count += 1;
    });
    if (count > bestCount) {
      bestCount = count;
      bestIndex = column;
    }
  }
  return bestCount >= 2 ? bestIndex : -1;
}

function rowsFromCimsCsv(text) {
  const rawRows = parseCsv(text).map((row) => row.map(cleanCell));
  const headerIndex = findCimsHeaderIndex(rawRows);
  const ownerIndex = findCimsOwnerIndex(rawRows, headerIndex);
  const seen = new Set();
  return rawRows
    .map((row, index) => ({
      index,
      code: cleanCell(row[0]),
      client: cleanCell(row[1]),
      branch: cleanCell(row[10]),
      owner: ownerIndex >= 0 ? cleanCell(row[ownerIndex]) : ""
    }))
    .filter((item) => {
      if (item.index === headerIndex) return false;
      if (!item.client) return false;
      if (item.index === 0 && /코드|거래처|치과|사업장|지점/i.test(`${item.code} ${item.client} ${item.branch}`)) return false;
      const key = item.code ? `code:${normalize(item.code)}` : `client:${normalize(item.client)}:${normalize(item.branch)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function rowsFromStatsCsv(text) {
  return parseCsv(text)
    .map((row, index) => ({
      index,
      code: cleanCell(row[2]),
      client: cleanCell(row[3]),
      branch: cleanCell(row[6]),
      owner: cleanCell(row[9])
    }))
    .filter((item) => {
      if (!item.code && !item.client && !item.branch && !item.owner) return false;
      if (item.index === 0 && /코드|거래처|치과|사업장|지점|담당/i.test(`${item.code} ${item.client} ${item.branch} ${item.owner}`)) return false;
      return Boolean(item.client || item.code || item.branch || item.owner);
    });
}

async function fetchSheetCsv(sheetId, sheetGid, label) {
  if (!sheetId) throw new Error(`${label} Google Sheet id is missing.`);

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(sheetGid)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "sales-report-cims-lookup" }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label} request failed: ${response.status}`);
    if (/<!doctype html|<html/i.test(text)) {
      throw new Error(`${label} 시트 공유 권한을 확인해주세요.`);
    }
    return text;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`${label} 응답이 너무 늦습니다.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function branchMatchesScope(branch, branchScope) {
  if (!branchScope.length) return true;
  const branchKey = normalizeBranch(branch);
  return Boolean(branchKey && branchScope.some((scope) => {
    return branchKey === scope || branchKey.includes(scope) || scope.includes(branchKey);
  }));
}

function ownerBranchScope(owner, statsRows) {
  const ownerKey = normalizeOwner(owner);
  if (!ownerKey) return [];
  return uniqueValues(
    statsRows
      .filter((item) => normalizeOwner(item.owner) === ownerKey)
      .map((item) => item.branch)
  ).map(normalizeBranch).filter(Boolean);
}

function statsMatchClient(item, statsRows) {
  const code = normalize(item.code);
  const client = normalize(item.client);
  return statsRows.some((stat) => {
    const statCode = normalize(stat.code);
    const statClient = normalize(stat.client);
    return Boolean((code && statCode && code === statCode) || (client && statClient && client === statClient));
  });
}

function annotateCimsRows(cimsRows, statsRows) {
  return cimsRows.map((item) => ({
    ...item,
    existing: statsMatchClient(item, statsRows)
  }));
}

function smallSample(rows, count = 5) {
  return rows.slice(0, count).map((item) => ({
    code: item.code || "",
    client: item.client || "",
    branch: item.branch || "",
    owner: item.owner || ""
  }));
}

function scopeCimsRows(cimsRows, owner, ownerBranches) {
  const ownerKey = normalizeOwner(owner);
  const hasCimsOwner = cimsRows.some((item) => Boolean(normalizeOwner(item.owner)));
  const ownerRows = ownerKey && hasCimsOwner
    ? cimsRows.filter((item) => normalizeOwner(item.owner) === ownerKey)
    : cimsRows;
  const branchRows = ownerBranches.length
    ? ownerRows.filter((item) => branchMatchesScope(item.branch, ownerBranches))
    : ownerRows;

  return {
    rows: branchRows,
    hasCimsOwner,
    ownerMatchedCount: ownerRows.length,
    branchMatchedCount: branchRows.length
  };
}

function scoreItem(item, query) {
  const client = normalize(item.client);
  const branch = normalize(item.branch);
  const code = normalize(item.code);

  if (code === query) return 0;
  if (code.startsWith(query)) return 1;
  if (client === query) return 2;
  if (client.startsWith(query)) return 3;
  if (client.includes(query)) return 4;
  if (branch.startsWith(query)) return 5;
  if (branch.includes(query)) return 6;
  if (code.includes(query)) return 7;
  return 9;
}

function formatItem(item) {
  return {
    code: item.code || "",
    client: item.client || "",
    branch: item.branch || "",
    existing: Boolean(item.existing)
  };
}

module.exports = async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url, "http://localhost");
    const query = normalize(requestUrl.searchParams.get("q"));
    const includeAll = requestUrl.searchParams.get("all") === "1";
    const owner = cleanCell(requestUrl.searchParams.get("owner"));
    const limit = Math.max(1, Math.min(50, Number(requestUrl.searchParams.get("limit") || 20)));

    if (req.method !== "GET") {
      return json(res, 405, { error: "Method not allowed" });
    }

    const cimsCsv = await fetchSheetCsv(CIMS_SHEET_ID, CIMS_SHEET_GID, "CIMS");
    const statsResult = await fetchSheetCsv(STATS_SHEET_ID, STATS_SHEET_GID, "전체처방통계")
      .then((csv) => ({ ok: true, rows: rowsFromStatsCsv(csv) }))
      .catch((error) => ({ ok: false, rows: [], error }));
    const cimsRows = rowsFromCimsCsv(cimsCsv);
    const ownerBranches = ownerBranchScope(owner, statsResult.rows);
    const scoped = scopeCimsRows(cimsRows, owner, ownerBranches);
    const rows = annotateCimsRows(scoped.rows, statsResult.rows);

    if (requestUrl.searchParams.get("debug") === "1") {
      return json(res, 200, {
        ok: true,
        cimsLoaded: true,
        cimsTotal: cimsRows.length,
        cimsHasOwnerColumn: scoped.hasCimsOwner,
        cimsOwnerMatchedCount: scoped.ownerMatchedCount,
        cimsAfterOwnerBranchFilter: scoped.branchMatchedCount,
        cimsVisibleCount: rows.length,
        cimsSheetIdStart: CIMS_SHEET_ID.slice(0, 10),
        statsLoaded: statsResult.ok,
        statsCount: statsResult.rows.length,
        statsError: statsResult.ok ? "" : statsResult.error?.message || "전체처방통계 연결 실패",
        owner: owner,
        ownerBranches: ownerBranches,
        cimsSample: smallSample(cimsRows),
        cimsOwnerSample: smallSample(cimsRows.filter((item) => normalizeOwner(item.owner) === normalizeOwner(owner))),
        statsOwnerSample: smallSample(statsResult.rows.filter((item) => normalizeOwner(item.owner) === normalizeOwner(owner))),
        message: "전체처방통계 G/J로 담당자 지점을 파악한 뒤, CIMS 담당자명과 K열 지점이 맞는 거래처만 입력 후보로 사용합니다."
      });
    }

    if (includeAll) {
      return json(res, 200, {
        items: rows.map(formatItem),
        count: rows.length,
        cimsLoaded: true,
        statsLoaded: statsResult.ok
      });
    }

    if (!query) {
      return json(res, 200, { items: [], count: 0, cimsLoaded: true, statsLoaded: statsResult.ok });
    }

    const filtered = rows
      .filter((item) => {
        return normalize(item.client).includes(query) ||
          normalize(item.branch).includes(query) ||
          normalize(item.code).includes(query);
      })
      .sort((a, b) => scoreItem(a, query) - scoreItem(b, query) || a.index - b.index);

    return json(res, 200, {
      items: filtered.slice(0, limit).map(formatItem),
      count: filtered.length,
      cimsLoaded: true,
      statsLoaded: statsResult.ok
    });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};

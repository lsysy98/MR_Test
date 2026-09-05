const DEFAULT_CIMS_SHEET_ID = "1ciVrJFqZyrXQvgBxZtSLwn9MxvOculLugDERIpHeEkY";
const DEFAULT_CIMS_SHEET_GID = "0";

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

function rowsFromCimsCsv(text) {
  const seen = new Set();
  return parseCsv(text)
    .map((row, index) => ({
      index,
      code: cleanCell(row[0]),
      client: cleanCell(row[1]),
      branch: cleanCell(row[10])
    }))
    .filter((item) => {
      if (!item.client) return false;
      if (item.index === 0 && /코드|거래처|치과|사업장|지점/i.test(`${item.code} ${item.client} ${item.branch}`)) return false;
      const key = item.code ? `code:${normalize(item.code)}` : `client:${normalize(item.client)}:${normalize(item.branch)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function fetchCimsCsv() {
  if (!CIMS_SHEET_ID) throw new Error("CIMS Google Sheet id is missing.");

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CIMS_SHEET_ID)}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(CIMS_SHEET_GID)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "sales-report-cims-lookup" }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`CIMS request failed: ${response.status}`);
    if (/<!doctype html|<html/i.test(text)) {
      throw new Error("CIMS 시트 공유 권한을 확인해주세요.");
    }
    return text;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("CIMS 응답이 너무 늦습니다.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
    existing: false
  };
}

module.exports = async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url, "http://localhost");
    const query = normalize(requestUrl.searchParams.get("q"));
    const includeAll = requestUrl.searchParams.get("all") === "1";
    const limit = Math.max(1, Math.min(50, Number(requestUrl.searchParams.get("limit") || 20)));

    if (req.method !== "GET") {
      return json(res, 405, { error: "Method not allowed" });
    }

    const rows = rowsFromCimsCsv(await fetchCimsCsv());

    if (requestUrl.searchParams.get("debug") === "1") {
      return json(res, 200, {
        ok: true,
        cimsLoaded: true,
        cimsCount: rows.length,
        cimsSheetIdStart: CIMS_SHEET_ID.slice(0, 10),
        message: "거래처 입력 후보는 CIMS 시트 A열 코드, B열 거래처명, K열 사업장명만 사용합니다."
      });
    }

    if (includeAll) {
      return json(res, 200, {
        items: rows.map(formatItem),
        count: rows.length,
        cimsLoaded: true
      });
    }

    if (!query) {
      return json(res, 200, { items: [], count: 0, cimsLoaded: true });
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
      cimsLoaded: true
    });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};

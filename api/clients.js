const DEFAULT_SHEET_ID = "1ciVrJFqZyrXQvgBxZtSLwn9MxvOculLugDERIpHeEkY";
const DEFAULT_SHEET_GID = "0";

const SHEET_ID = process.env.CLIENT_SHEET_ID || process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
const SHEET_GID = process.env.CLIENT_SHEET_GID || process.env.GOOGLE_SHEET_GID || DEFAULT_SHEET_GID;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.end(JSON.stringify(data));
}

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function cleanCell(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
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

function rowsFromCsv(text) {
  return parseCsv(text)
    .map((row, index) => ({
      index,
      code: cleanCell(row[0]),
      client: cleanCell(row[1]),
      branch: cleanCell(row[10])
    }))
    .filter((item) => {
      if (!item.code && !item.client) return false;
      if (item.index === 0 && /코드|거래처|치과|사업장|지점/i.test(`${item.code} ${item.client} ${item.branch}`)) return false;
      return Boolean(item.client);
    });
}

async function fetchSheetCsv() {
  if (!SHEET_ID) throw new Error("Google Sheet id is missing.");

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(SHEET_GID)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "sales-report-client-lookup" }
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Google Sheet request failed: ${response.status}`);
    }
    if (/<!doctype html|<html/i.test(text)) {
      throw new Error("Google Sheet sharing is not open to link viewers.");
    }
    return text;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Google Sheet response timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function scoreItem(item, query, codeQuery) {
  const client = normalize(item.client);
  const branch = normalize(item.branch);
  const code = normalize(item.code);

  if (codeQuery) {
    if (code === codeQuery) return 0;
    if (code.startsWith(codeQuery)) return 1;
    if (code.includes(codeQuery)) return 2;
    return 9;
  }

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

module.exports = async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url, "http://localhost");
    const query = normalize(requestUrl.searchParams.get("q"));
    const codeQuery = normalize(requestUrl.searchParams.get("code"));
    const includeAll = requestUrl.searchParams.get("all") === "1";
    const limit = Math.max(1, Math.min(30, Number(requestUrl.searchParams.get("limit") || 12)));

    if (req.method !== "GET") {
      return json(res, 405, { error: "Method not allowed" });
    }
    const csv = await fetchSheetCsv();
    const rows = rowsFromCsv(csv);

    if (includeAll) {
      return json(res, 200, {
        items: rows.map((item) => ({
          code: item.code,
          client: item.client,
          branch: item.branch
        })),
        count: rows.length
      });
    }

    if (!query && !codeQuery) {
      return json(res, 200, { items: [], count: 0 });
    }

    const filtered = rows
      .filter((item) => {
        if (codeQuery) return normalize(item.code).includes(codeQuery);
        return normalize(item.client).includes(query) ||
          normalize(item.branch).includes(query) ||
          normalize(item.code).includes(query);
      })
      .sort((a, b) => scoreItem(a, query, codeQuery) - scoreItem(b, query, codeQuery) || a.index - b.index);

    return json(res, 200, {
      items: filtered.slice(0, limit).map((item) => ({
        code: item.code,
        client: item.client,
        branch: item.branch
      })),
      count: filtered.length
    });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

const OWNER_ORDER = ["성진욱", "김무영", "이승엽", "김태홍", "제성규", "송진영", "이현욱"];

function cleanSupabaseUrl() {
  if (!SUPABASE_URL) return "";
  return SUPABASE_URL
    .trim()
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/g, "");
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function cleanCell(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatWon(value) {
  return Number(value || 0).toLocaleString("ko-KR") + "원";
}

function formatDate(value) {
  const text = cleanCell(value);
  if (!text) return "";
  const parts = text.split("-");
  if (parts.length !== 3) return text;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

async function supabase(path, options = {}) {
  const baseUrl = cleanSupabaseUrl();

  if (!baseUrl || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment variables are missing.");
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl)) {
    throw new Error("SUPABASE_URL must look like https://xxxx.supabase.co");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(`${baseUrl}/rest/v1/${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Supabase response timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }

  if (!response.ok) {
    throw new Error(data?.message || text || "Supabase request failed.");
  }

  return data;
}

async function supabasePaged(pathBase, pageSize = 1000, maxPages = 30) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const separator = pathBase.includes("?") ? "&" : "?";
    const pageRows = await supabase(`${pathBase}${separator}limit=${pageSize}&offset=${page * pageSize}`);
    if (!Array.isArray(pageRows) || !pageRows.length) break;
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return rows;
}

function ownerSort(a, b) {
  const ai = OWNER_ORDER.indexOf(a.owner);
  const bi = OWNER_ORDER.indexOf(b.owner);
  if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  return a.owner.localeCompare(b.owner, "ko");
}

function groupMissingReports(rows) {
  const ownerMap = new Map();

  rows.forEach((row) => {
    if (cleanCell(row.client_code)) return;
    const owner = cleanCell(row.owner) || "담당자 미지정";
    const client = cleanCell(row.client) || "거래처명 없음";
    const branchName = cleanCell(row.branch_name);
    const key = `${client}|${branchName}`;
    if (!ownerMap.has(owner)) ownerMap.set(owner, new Map());
    const itemMap = ownerMap.get(owner);
    if (!itemMap.has(key)) {
      itemMap.set(key, {
        client,
        branchName,
        reportCount: 0,
        dates: [],
        types: [],
        amount: 0
      });
    }
    const item = itemMap.get(key);
    item.reportCount += 1;
    item.amount += Number(row.amount || 0);
    const date = cleanCell(row.report_date);
    if (date && !item.dates.includes(date)) item.dates.push(date);
    const type = cleanCell(row.type);
    if (type && !item.types.includes(type)) item.types.push(type);
  });

  return Array.from(ownerMap.entries())
    .map(([owner, itemMap]) => {
      const items = Array.from(itemMap.values())
        .map((item) => ({
          ...item,
          dates: item.dates.sort(),
          amountText: formatWon(item.amount)
        }))
        .sort((a, b) => {
          const ad = a.dates[0] || "";
          const bd = b.dates[0] || "";
          return ad.localeCompare(bd) || a.client.localeCompare(b.client, "ko");
        });
      return { owner, count: items.length, items };
    })
    .sort(ownerSort);
}

function renderOwnerSection(owner) {
  const rows = owner.items.map((item) => {
    const dateText = item.dates.length
      ? item.dates.map(formatDate).join(", ")
      : "-";
    const branch = item.branchName || "지점 없음";
    const types = item.types.length ? item.types.join(", ") : "-";
    return `
      <tr>
        <td class="client">
          <strong>${escapeHtml(item.client)}</strong>
          <small>${escapeHtml(branch)}</small>
        </td>
        <td>${escapeHtml(dateText)}</td>
        <td>${escapeHtml(types)}</td>
        <td class="amount">${escapeHtml(item.amountText)}</td>
        <td>${escapeHtml(String(item.reportCount))}건</td>
      </tr>`;
  }).join("");

  return `
    <section class="owner-card">
      <div class="owner-head">
        <h2>${escapeHtml(owner.owner)}</h2>
        <span>${escapeHtml(String(owner.count))}곳</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>거래처</th>
              <th>날짜</th>
              <th>구분</th>
              <th>금액</th>
              <th>보고</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

function renderPage(data) {
  const ownerCount = data.owners.length;
  const sections = data.owners.length
    ? data.owners.map(renderOwnerSection).join("")
    : `<section class="empty">거래처코드가 비어 있는 보고가 없습니다.</section>`;
  const alert = data.error
    ? `<section class="alert">${escapeHtml(data.error)}</section>`
    : "";

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>거래처코드 미지정 목록</title>
  <style>
    :root {
      --bg: #fff7f1;
      --panel: #ffffff;
      --ink: #201a16;
      --muted: #76685f;
      --line: #efd8c8;
      --accent: #f26116;
      --accent-soft: #fff0e6;
      --shadow: 0 18px 42px rgba(83, 52, 31, .12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(180deg, var(--bg), #fff);
      color: var(--ink);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 52px;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: end;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: clamp(26px, 4vw, 42px);
      letter-spacing: 0;
    }
    .hero p {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(2, minmax(120px, auto));
      gap: 10px;
    }
    .summary div {
      min-width: 132px;
      padding: 13px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .summary strong {
      display: block;
      font-size: 26px;
      line-height: 1;
      color: var(--accent);
    }
    .summary span {
      display: block;
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
    }
    .owner-list {
      display: grid;
      gap: 14px;
    }
    .owner-card {
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .owner-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      background: var(--accent-soft);
    }
    .owner-head h2 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0;
    }
    .owner-head span {
      padding: 6px 11px;
      border-radius: 999px;
      background: #fff;
      color: var(--accent);
      font-weight: 900;
      white-space: nowrap;
    }
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }
    th, td {
      padding: 13px 16px;
      border-bottom: 1px solid #f2dfd1;
      text-align: left;
      vertical-align: middle;
      font-size: 14px;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      background: #fffaf6;
    }
    tr:last-child td { border-bottom: 0; }
    .client strong {
      display: block;
      font-size: 16px;
    }
    .client small {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
    }
    .amount {
      font-weight: 900;
      white-space: nowrap;
    }
    .empty {
      padding: 40px 20px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      background: #fff;
      color: var(--muted);
      text-align: center;
      font-weight: 800;
    }
    .alert {
      margin-bottom: 14px;
      padding: 15px 16px;
      border: 1px solid #f4aaa2;
      border-radius: 10px;
      background: #fff1f0;
      color: #c4302b;
      font-weight: 900;
    }
    .foot {
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
    }
    .foot a {
      color: var(--accent);
      font-weight: 900;
      text-decoration: none;
    }
    @media (max-width: 720px) {
      main {
        width: min(100% - 20px, 720px);
        padding-top: 18px;
      }
      .hero {
        grid-template-columns: 1fr;
        align-items: stretch;
      }
      .summary {
        grid-template-columns: 1fr 1fr;
      }
      .summary div {
        min-width: 0;
        padding: 12px;
      }
      .summary strong {
        font-size: 23px;
      }
      table {
        min-width: 0;
      }
      thead {
        display: none;
      }
      tr {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 4px 10px;
        padding: 13px 14px;
        border-bottom: 1px solid #f2dfd1;
      }
      tr:last-child { border-bottom: 0; }
      td {
        display: block;
        padding: 0;
        border: 0;
        font-size: 13px;
      }
      td.client {
        grid-column: 1 / -1;
      }
      td.amount {
        grid-column: 2;
        grid-row: 2 / span 2;
        align-self: center;
        font-size: 16px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <h1>거래처코드 미지정 목록</h1>
        <p>거래처코드가 아직 비어 있는 보고만 담당자별로 모았습니다.</p>
      </div>
      <div class="summary" aria-label="요약">
        <div><strong>${escapeHtml(String(data.total))}</strong><span>미지정 거래처</span></div>
        <div><strong>${escapeHtml(String(ownerCount))}</strong><span>담당자</span></div>
      </div>
    </section>
    ${alert}
    <div class="owner-list">${sections}</div>
    <p class="foot">개발 확인용 원본 데이터는 <a href="?key=${escapeHtml(data.key)}&format=json">JSON으로 보기</a></p>
  </main>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  let key = "";
  let wantsJson = false;
  try {
    const requestUrl = new URL(req.url, "http://localhost");
    key = requestUrl.searchParams.get("key") || "";
    wantsJson = requestUrl.searchParams.get("format") === "json" ||
      requestUrl.searchParams.get("json") === "1";

    if (req.method !== "GET") {
      if (wantsJson) return json(res, 405, { error: "Method not allowed" });
      return html(res, 405, renderPage({ key, total: 0, owners: [], error: "지원하지 않는 요청입니다." }));
    }

    if (!ADMIN_KEY) {
      if (wantsJson) return json(res, 500, { error: "ADMIN_KEY 환경변수가 없습니다." });
      return html(res, 500, renderPage({ key, total: 0, owners: [], error: "ADMIN_KEY 환경변수가 없습니다." }));
    }

    if (key !== ADMIN_KEY) {
      if (wantsJson) return json(res, 401, { error: "관리자 비밀번호가 맞지 않습니다." });
      return html(res, 401, renderPage({ key, total: 0, owners: [], error: "관리자 비밀번호가 맞지 않습니다." }));
    }

    const reports = await supabasePaged("reports?select=id,report_date,owner,client,branch_name,type,amount,client_code&order=report_date.asc");
    const owners = groupMissingReports(reports);
    const data = {
      ok: true,
      message: "거래처코드가 아직 없는 보고 목록입니다.",
      total: owners.reduce((sum, owner) => sum + owner.count, 0),
      owners,
      key
    };

    if (wantsJson) return json(res, 200, data);
    return html(res, 200, renderPage(data));
  } catch (error) {
    if (wantsJson) return json(res, 500, { error: error.message });
    return html(res, 500, renderPage({ key, total: 0, owners: [], error: error.message }));
  }
};

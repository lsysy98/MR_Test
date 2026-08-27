const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

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
  res.end(JSON.stringify(data));
}

function requireAdmin(req) {
  const requestUrl = new URL(req.url, "http://localhost");
  const key = requestUrl.searchParams.get("key") || "";
  return Boolean(ADMIN_KEY && key === ADMIN_KEY);
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || text || "Supabase request failed.");
  return data;
}

function toEventDb(item) {
  const now = Date.now();
  return {
    id: item.id,
    event_date: item.date,
    title: item.title,
    needed_count: Number(item.neededCount || 2),
    memo: item.memo || "",
    created_at: Number(item.createdAt || now),
    updated_at: Number(item.updatedAt || now)
  };
}

function fromEventDb(row, attendees) {
  return {
    id: row.id,
    date: row.event_date,
    title: row.title,
    neededCount: Number(row.needed_count || 2),
    memo: row.memo || "",
    attendees: attendees || [],
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0)
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function cleanAttendees(value) {
  const allowed = new Set(["성진욱", "김무영", "이승엽", "김태홍", "제성규", "송진영", "이현욱"]);
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(name => String(name || "").trim())
    .filter(name => {
      if (!allowed.has(name) || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

async function loadEvents() {
  const events = await supabase("exhibition_events?select=*&order=event_date.desc,created_at.desc");
  const attendeeRows = await supabase("exhibition_attendees?select=*&order=created_at.asc");
  const attendeeMap = {};
  attendeeRows.forEach(row => {
    if (!attendeeMap[row.event_id]) attendeeMap[row.event_id] = [];
    attendeeMap[row.event_id].push(row.owner);
  });
  return events.map(row => fromEventDb(row, attendeeMap[row.id] || []));
}

module.exports = async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url, "http://localhost");

    if (req.method === "GET") {
      if (requestUrl.searchParams.get("check") === "1") {
        return json(res, 200, { ok: true });
      }
      return json(res, 200, await loadEvents());
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const now = Date.now();
      const date = String(body.date || "");
      const title = String(body.title || "").trim();
      const attendees = cleanAttendees(body.attendees);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: "date is required" });
      if (!title) return json(res, 400, { error: "title is required" });
      if (!attendees.length) return json(res, 400, { error: "attendees are required" });

      const event = {
        id: body.id || `${now}-${Math.random().toString(16).slice(2)}`,
        date,
        title,
        neededCount: Math.max(1, Math.min(7, Number(body.neededCount || attendees.length || 2))),
        memo: String(body.memo || "").trim(),
        createdAt: Number(body.createdAt || now),
        updatedAt: now
      };

      const rows = await supabase("exhibition_events?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(toEventDb(event))
      });

      await supabase(`exhibition_attendees?event_id=eq.${encodeURIComponent(event.id)}`, {
        method: "DELETE"
      });

      const attendeePayload = attendees.map(owner => ({
        id: `${event.id}-${owner}`,
        event_id: event.id,
        owner,
        created_at: now
      }));
      if (attendeePayload.length) {
        await supabase("exhibition_attendees", {
          method: "POST",
          body: JSON.stringify(attendeePayload)
        });
      }

      return json(res, 200, fromEventDb(rows[0], attendees));
    }

    if (req.method === "DELETE") {
      const id = requestUrl.searchParams.get("id") || "";
      if (!id) return json(res, 400, { error: "id is required" });
      await supabase(`exhibition_attendees?event_id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      await supabase(`exhibition_events?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};

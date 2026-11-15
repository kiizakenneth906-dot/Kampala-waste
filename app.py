import base64
import json
import os
import re
import sqlite3
import threading
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from urllib.parse import urlencode

from flask import (Flask, Response, abort, g, jsonify, render_template, request,
                   send_from_directory, session)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, template_folder=BASE_DIR, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-in-render")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  PERMANENT_SESSION_LIFETIME=timedelta(days=30),
                  MAX_CONTENT_LENGTH=3 * 1024 * 1024)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
PG = DATABASE_URL.startswith("postgres")
if PG:
    import psycopg2
    import psycopg2.extras
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "kampala_portal_v3.db"))

UGANDA = timezone(timedelta(hours=3))
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
AREAS = ["Central", "Kawempe", "Makindye", "Nakawa", "Rubaga"]
TYPES = ["Illegal dumping", "Missed pickup", "Overflowing bin", "Blocked drainage"]
STATUSES = ["Open", "Progress", "Resolved"]
DEFAULT_SCHEDULE = {"Central": ["Mon", "Thu"], "Kawempe": ["Tue", "Fri"], "Makindye": ["Wed", "Sat"],
                    "Nakawa": ["Mon", "Fri"], "Rubaga": ["Tue", "Sat"]}
CONTACT = {"phone": "0755530904", "email": "solidwaste@gmail.com"}
MAIL_FROM = os.environ.get("MAIL_FROM", CONTACT["email"])

# People saved in the database. Only these e-mails can register an account.
SEED_STAFF = [
    ("Kiiza Kenneth", "kiizakenneth@gmail.com", "administrator"),
    ("Ashaba Brian", "ashababrian@gmail.com", "collector"),
    ("Alaho Alex", "alex@gmail.com", "collector"),
]

SYSTEM_PROMPT = (
    "You are the friendly AI assistant of a Solid Waste Collection and Citizen Engagement "
    "Portal in Kampala, Uganda. Help residents report missed pickups and illegal dumping, "
    "understand schedules, waste segregation and recycling. Keep answers practical and under "
    f"120 words. For urgent issues direct people to e-mail {CONTACT['email']} or call {CONTACT['phone']}."
)


# ---------- database layer (SQLite by default, PostgreSQL when DATABASE_URL is set) ----------
class DB:
    def __init__(self):
        if PG:
            self.conn = psycopg2.connect(DATABASE_URL)
        else:
            self.conn = sqlite3.connect(DB_PATH)
            self.conn.row_factory = sqlite3.Row

    def _cur(self):
        return self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) if PG else self.conn.cursor()

    @staticmethod
    def _fix(sql):
        return sql.replace("?", "%s") if PG else sql

    def q(self, sql, params=()):
        cur = self._cur()
        cur.execute(self._fix(sql), params)
        rows = [dict(r) for r in cur.fetchall()]
        cur.close()
        return rows

    def one(self, sql, params=()):
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def x(self, sql, params=()):
        cur = self._cur()
        cur.execute(self._fix(sql), params)
        n = cur.rowcount
        self.conn.commit()
        cur.close()
        return n

    def insert(self, sql, params=()):
        cur = self._cur()
        if PG:
            cur.execute(self._fix(sql) + " RETURNING id", params)
            new_id = cur.fetchone()["id"]
        else:
            cur.execute(sql, params)
            new_id = cur.lastrowid
        self.conn.commit()
        cur.close()
        return new_id

    def close(self):
        try:
            self.conn.close()
        except Exception:
            pass


def get_db():
    if "db" not in g:
        g.db = DB()
    return g.db


@app.teardown_appcontext
def close_db(_e):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def clean_email(v):
    return re.sub(r"\s+", "", str(v or "")).lower()


def init_db():
    db = DB()
    pk = "SERIAL PRIMARY KEY" if PG else "INTEGER PRIMARY KEY AUTOINCREMENT"
    for stmt in [
        f"CREATE TABLE IF NOT EXISTS users(id {pk}, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, password_hash TEXT, photo TEXT)",
        f"""CREATE TABLE IF NOT EXISTS tickets(id {pk}, type TEXT NOT NULL, area TEXT NOT NULL, place TEXT NOT NULL,
            phone TEXT NOT NULL, details TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'Open', assigned_to INTEGER,
            demo INTEGER DEFAULT 0, created TEXT, resolved_at TEXT, expected_date TEXT, image TEXT)""",
        f"CREATE TABLE IF NOT EXISTS messages(id {pk}, ticket_id INTEGER, channel TEXT, recipient TEXT, subject TEXT, body TEXT, status TEXT, created TEXT)",
        "CREATE TABLE IF NOT EXISTS schedule(area TEXT PRIMARY KEY, days TEXT NOT NULL)",
    ]:
        db.x(stmt)
    staff = list(SEED_STAFF)
    if os.environ.get("ADMIN_EMAIL"):
        staff.append(("Administrator", clean_email(os.environ["ADMIN_EMAIL"]), "administrator"))
    for name, email, role in staff:
        db.x("INSERT INTO users(name,email,role) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING", (name, email, role))
    for area, days in DEFAULT_SCHEDULE.items():
        db.x("INSERT INTO schedule(area,days) VALUES(?,?) ON CONFLICT(area) DO NOTHING", (area, ",".join(days)))
    db.close()


init_db()


# ---------- schedule ----------
def get_schedule(db):
    out = {a: [] for a in AREAS}
    for r in db.q("SELECT area,days FROM schedule"):
        if r["area"] in out:
            out[r["area"]] = [d for d in DAYS if d in r["days"].split(",")]
    return out


def next_collection(db, area, sched=None):
    days = (sched or get_schedule(db)).get(area, [])
    today = datetime.now(UGANDA).date()
    for i in range(1, 8):
        d = today + timedelta(days=i)
        if DAYS[d.weekday()] in days:
            return d.isoformat()
    return None


def pretty(d):
    return date.fromisoformat(d).strftime("%a %d %b %Y") if d else "a date to be confirmed"


# ---------- images ----------
IMG_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")


def clean_image(v, limit=900_000):
    if not v:
        return None
    v = str(v)
    if len(v) > limit or not IMG_RE.match(v):
        raise ValueError("Photo must be a JPEG, PNG or WebP image under about 600 KB.")
    return v


def image_response(data_url):
    head, b64 = data_url.split(",", 1)
    resp = Response(base64.b64decode(b64), mimetype=head[5:].split(";")[0])
    resp.headers["Cache-Control"] = "private, max-age=300"
    return resp


# ---------- notifications (SMS and e-mail) ----------
def sms_ok():
    return bool(os.environ.get("AT_USERNAME") and os.environ.get("AT_API_KEY"))


def mail_ok():
    return bool(os.environ.get("BREVO_API_KEY"))


def send_sms(phone, text):
    user, key = os.environ["AT_USERNAME"], os.environ["AT_API_KEY"]
    host = "api.sandbox.africastalking.com" if user == "sandbox" else "api.africastalking.com"
    req = urllib.request.Request(f"https://{host}/version1/messaging",
                                 data=urlencode({"username": user, "to": phone, "message": text}).encode(),
                                 headers={"apiKey": key, "Accept": "application/json",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    urllib.request.urlopen(req, timeout=15)


def send_email(to, subject, body):
    payload = {"sender": {"name": "Kampala Solid Waste Portal", "email": MAIL_FROM},
               "to": [{"email": to}], "subject": subject, "textContent": body}
    req = urllib.request.Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(payload).encode(),
                                 headers={"api-key": os.environ["BREVO_API_KEY"], "accept": "application/json",
                                          "content-type": "application/json"})
    urllib.request.urlopen(req, timeout=15)


def _deliver(mid, channel, to, subject, body):
    try:
        send_sms(to, body) if channel == "sms" else send_email(to, subject, body)
        status = "sent"
    except Exception as exc:
        app.logger.warning("%s delivery failed: %s", channel, exc)
        status = "failed"
    try:
        d = DB()
        d.x("UPDATE messages SET status=? WHERE id=?", (status, mid))
        d.close()
    except Exception as exc:
        app.logger.warning("could not update message status: %s", exc)


def notify(db, ticket, channel, to, subject, body):
    """Saves the message and sends it in the background when a provider is configured."""
    if ticket.get("demo"):
        status = "sample"
    elif (channel == "sms" and not sms_ok()) or (channel == "email" and not mail_ok()):
        status = "not_configured"
    else:
        status = "queued"
    mid = db.insert("INSERT INTO messages(ticket_id,channel,recipient,subject,body,status,created) VALUES(?,?,?,?,?,?,?)",
                    (ticket["id"], channel, to, subject, body, status, now()))
    if status == "queued":
        threading.Thread(target=_deliver, args=(mid, channel, to, subject, body), daemon=True).start()


def email_staff(db, ticket, people, intro):
    seen = set()
    link = request.host_url
    for p in people:
        if not p or p["email"] in seen:
            continue
        seen.add(p["email"])
        body = (f"Hello {p['name']},\n\n{intro}\n\n"
                f"Report: #{ticket['id']}\nIssue: {ticket['type']}\nDivision: {ticket['area']}\nPlace: {ticket['place']}\n"
                f"Reporter phone: {ticket['phone']}\nDetails: {ticket.get('details') or '-'}\n"
                f"Photo of the problem: {'yes, open the ticket in the portal' if ticket.get('image') or ticket.get('has_image') else 'none'}\n"
                f"Expected resolution: {pretty(ticket.get('expected_date'))}\n\nOpen the portal: {link}\n\nKampala Solid Waste Portal")
        notify(db, ticket, "email", p["email"], f"Report #{ticket['id']}: {ticket['type']} in {ticket['area']}", body)


# ---------- AI helpers ----------
def ask_ai(prompt, system=SYSTEM_PROMPT):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic
        msg = anthropic.Anthropic(api_key=key).messages.create(
            model=os.environ.get("AI_MODEL", "claude-sonnet-4-6"), max_tokens=500,
            system=system, messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text
    except Exception as exc:
        app.logger.warning("AI call failed: %s", exc)
        return None


FAQ = [
    (("dump", "illegal"), "To report illegal dumping, open Report a problem, choose your division, enter the place, your phone number and (if you can) a photo. You will get a message with the expected resolution date."),
    (("not collected", "missed", "pickup", "collect"), "Sorry about the missed pickup. Check your division's collection days under Schedule, then report it so collectors can respond."),
    (("sort", "segregat", "separate", "recycl"), "Separate organic waste, plastics, paper, metal and glass, and keep hazardous waste (batteries, medical, chemicals) apart. See the Learn page."),
]


def faq_reply(text):
    t = text.lower()
    for keys, reply in FAQ:
        if any(k in t for k in keys):
            return reply
    return f"I can help with reporting problems, collection days and recycling. For urgent issues e-mail {CONTACT['email']} or call {CONTACT['phone']}."


def rule_briefing(tickets):
    un = [t for t in tickets if t["status"] != "Resolved"]
    lines = [f"Overview: {len(tickets)} reports, {sum(t['status']=='Open' for t in tickets)} open, {sum(t['status']=='Progress' for t in tickets)} in progress."]
    if un:
        a, n = Counter(t["area"] for t in un).most_common(1)[0]
        ty, m = Counter(t["type"] for t in un).most_common(1)[0]
        lines += [f"Priority 1: {a} has the most unresolved reports ({n}). Send extra collectors there.",
                  f"Priority 2: '{ty}' is the most common unresolved issue ({m}).",
                  f"Action: assign collectors to the {sum(t['status']=='Open' for t in tickets)} open report(s) first."]
    lines.append("(Rule-based summary. Set ANTHROPIC_API_KEY to enable the AI briefing.)")
    return "\n".join(lines)


# ---------- auth helpers ----------
def norm_phone(p):
    d = re.sub(r"[^\d+]", "", str(p or ""))
    if d.startswith("+256") and len(d) == 13:
        return d
    if d.startswith("256") and len(d) == 12:
        return "+" + d
    if d.startswith("0") and len(d) == 10:
        return "+256" + d[1:]
    return None


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    return get_db().one("SELECT id,name,email,role,(photo IS NOT NULL) AS has_photo FROM users WHERE id=? AND password_hash IS NOT NULL", (uid,))


def staff_required(admin=False):
    def deco(f):
        @wraps(f)
        def wrapper(*a, **k):
            u = current_user()
            if not u:
                return jsonify(error="Please log in."), 401
            if admin and u["role"] != "administrator":
                return jsonify(error="Administrators only."), 403
            g.user = u
            return f(*a, **k)
        return wrapper
    return deco


def login_user(uid):
    session.clear()
    session.permanent = True      # stays logged in for 30 days
    session["uid"] = uid


# ---------- pages ----------
@app.route("/")
def index():
    return render_template("index.html", cfg={"areas": AREAS, "types": TYPES, "days": DAYS, "contact": CONTACT})


@app.route("/<path:name>")
def public_files(name):
    if name not in ("style.css", "app.js"):
        abort(404)
    return send_from_directory(BASE_DIR, name)


@app.get("/img/staff/<int:uid>")
def staff_photo(uid):
    r = get_db().one("SELECT photo FROM users WHERE id=?", (uid,))
    if not r or not r["photo"]:
        abort(404)
    return image_response(r["photo"])


@app.get("/img/ticket/<int:tid>")
def ticket_photo(tid):
    t = get_db().one("SELECT phone,image FROM tickets WHERE id=?", (tid,))
    if not t or not t["image"]:
        abort(404)
    if not (current_user() or norm_phone(request.args.get("phone")) == t["phone"]):
        abort(403)
    return image_response(t["image"])


# ---------- public API ----------
@app.get("/api/stats")
def stats():
    c = {r["status"]: r["n"] for r in get_db().q("SELECT status, COUNT(*) AS n FROM tickets GROUP BY status")}
    return jsonify(total=sum(c.values()), open=c.get("Open", 0), progress=c.get("Progress", 0), resolved=c.get("Resolved", 0))


@app.get("/api/schedule")
def schedule_get():
    db = get_db()
    s = get_schedule(db)
    return jsonify(schedule=s, next={a: next_collection(db, a, s) for a in AREAS})


@app.post("/api/reports")
def create_report():
    d = request.get_json(silent=True) or {}
    phone, place = norm_phone(d.get("phone")), str(d.get("place", "")).strip()
    if d.get("area") not in AREAS:
        return jsonify(error="Please choose your division."), 400
    if len(place) < 2:
        return jsonify(error="Please enter the place of the problem."), 400
    if d.get("type") not in TYPES:
        return jsonify(error="Please choose the problem issue."), 400
    if not phone:
        return jsonify(error="Enter a valid Ugandan phone number, e.g. 0755530904."), 400
    try:
        image = clean_image(d.get("image"))
    except ValueError as e:
        return jsonify(error=str(e)), 400
    db = get_db()
    expected = next_collection(db, d["area"])
    col = db.one("""SELECT u.id,u.name,u.email,
                    (SELECT COUNT(*) FROM tickets t WHERE t.assigned_to=u.id AND t.status<>'Resolved') AS open_n
                    FROM users u WHERE u.role='collector' ORDER BY open_n, u.id LIMIT 1""")
    tid = db.insert("""INSERT INTO tickets(type,area,place,phone,details,assigned_to,expected_date,image,created)
                       VALUES(?,?,?,?,?,?,?,?,?)""",
                    (d["type"], d["area"], place[:200], phone, str(d.get("details", ""))[:1000],
                     col["id"] if col else None, expected, image, now()))
    t = {"id": tid, "type": d["type"], "area": d["area"], "place": place[:200], "phone": phone,
         "details": str(d.get("details", ""))[:1000], "expected_date": expected, "image": image, "demo": 0}
    when = (f"It is expected to be resolved on {pretty(expected)}, according to the {d['area']} collection schedule."
            if expected else "The administrator will confirm the resolution date.")
    sms = (f"Kampala Solid Waste Portal: report #{tid} ({d['type']} at {place[:60]}, {d['area']}) received. {when}"
           + (f" Collector: {col['name']}." if col else ""))
    notify(db, t, "sms", phone, "", sms)
    admins = db.q("SELECT name,email FROM users WHERE role='administrator'")
    email_staff(db, t, ([col] if col else []) + admins, "A new problem was reported by a resident.")
    return jsonify(id=tid, phone=phone, expected_date=expected, collector=col["name"] if col else None), 201


@app.get("/api/track")
def track():
    phone = norm_phone(request.args.get("phone"))
    if not phone:
        return jsonify(error="Enter the phone number you used when reporting."), 400
    db = get_db()
    t = db.q("""SELECT t.id,t.type,t.area,t.place,t.status,t.created,t.resolved_at,t.expected_date,t.assigned_to,
                (t.image IS NOT NULL) AS has_image, u.name AS collector_name, (u.photo IS NOT NULL) AS collector_photo
                FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.phone=? ORDER BY t.id DESC""", (phone,))
    m = db.q("SELECT ticket_id,body,created FROM messages WHERE channel='sms' AND recipient=? ORDER BY id DESC", (phone,))
    return jsonify(tickets=t, messages=m)


@app.post("/api/chat")
def chat():
    d = request.get_json(silent=True) or {}
    message = str(d.get("message", "")).strip()[:500]
    if not message:
        return jsonify(reply="Please type a question."), 400
    history = "\n".join(str(h)[:300] for h in (d.get("history") or [])[-8:])
    reply = ask_ai(f"Conversation so far:\n{history}\n\nResident: {message}\n\nReply as the Assistant.")
    return jsonify(reply=reply or faq_reply(message))


# ---------- accounts ----------
@app.get("/api/me")
def me():
    return jsonify(user=current_user())


@app.post("/api/register")
def register():
    d = request.get_json(silent=True) or {}
    email, pw = clean_email(d.get("email")), str(d.get("password", ""))
    if len(pw) < 6:
        return jsonify(error="Password must be at least 6 characters."), 400
    try:
        photo = clean_image(d.get("photo"), 400_000)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    db = get_db()
    row = db.one("SELECT id,password_hash FROM users WHERE email=?", (email,))
    if not row:
        return jsonify(error="This e-mail is not saved in the system database. Ask the administrator to add it."), 403
    if row["password_hash"]:
        return jsonify(error="This account is already registered. Please log in."), 409
    db.x("UPDATE users SET password_hash=?, photo=? WHERE id=?", (generate_password_hash(pw), photo, row["id"]))
    login_user(row["id"])
    return jsonify(user=current_user())


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    email, pw = clean_email(d.get("email")), str(d.get("password", ""))
    row = get_db().one("SELECT id,role,password_hash FROM users WHERE email=?", (email,))
    if not row:
        return jsonify(error="This e-mail is not saved in the system database."), 403
    if not row["password_hash"]:
        return jsonify(error="No account yet. Use 'First time? Register' to create your password."), 403
    if not check_password_hash(row["password_hash"], pw):
        return jsonify(error="Wrong password."), 401
    if d.get("expect") == "administrator" and row["role"] != "administrator":
        return jsonify(error="This is a collector account. Use Collector login."), 403
    login_user(row["id"])
    return jsonify(user=current_user())


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.post("/api/photo")
@staff_required()
def set_photo():
    try:
        photo = clean_image((request.get_json(silent=True) or {}).get("photo"), 400_000)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    if not photo:
        return jsonify(error="Choose a photo first."), 400
    get_db().x("UPDATE users SET photo=? WHERE id=?", (photo, g.user["id"]))
    return jsonify(ok=True)


# ---------- staff API ----------
TICKET_COLS = """t.id,t.type,t.area,t.place,t.phone,t.details,t.status,t.assigned_to,t.demo,t.created,t.resolved_at,
                 t.expected_date,(t.image IS NOT NULL) AS has_image,u.name AS assigned_name,(u.photo IS NOT NULL) AS assigned_photo"""


@app.get("/api/tickets")
@staff_required()
def list_tickets():
    return jsonify(get_db().q(f"SELECT {TICKET_COLS} FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to ORDER BY t.id DESC"))


@app.patch("/api/tickets/<int:tid>")
@staff_required()
def update_ticket(tid):
    d = request.get_json(silent=True) or {}
    db = get_db()
    t = db.one("SELECT id,type,area,place,phone,details,status,assigned_to,demo,expected_date,(image IS NOT NULL) AS has_image FROM tickets WHERE id=?", (tid,))
    if not t:
        return jsonify(error="Ticket not found."), 404
    out = {"ok": True}
    admin = g.user["role"] == "administrator"
    if "assigned_to" in d:
        if not admin:
            return jsonify(error="Only administrators can assign tickets."), 403
        aid = d["assigned_to"] or None
        person = db.one("SELECT id,name,email FROM users WHERE id=? AND role='collector'", (aid,)) if aid else None
        if aid and not person:
            return jsonify(error="Unknown collector."), 400
        db.x("UPDATE tickets SET assigned_to=? WHERE id=?", (aid, tid))
        if person and aid != t["assigned_to"]:
            email_staff(db, t, [person], "You have been assigned this report by the administrator.")
    if "expected_date" in d:
        if not admin:
            return jsonify(error="Only administrators can set the resolution date."), 403
        try:
            ed = date.fromisoformat(str(d["expected_date"])).isoformat()
        except ValueError:
            return jsonify(error="Enter a valid date."), 400
        db.x("UPDATE tickets SET expected_date=? WHERE id=?", (ed, tid))
        notify(db, t, "sms", t["phone"], "",
               f"Kampala Solid Waste Portal: update on report #{tid}. It is now expected to be resolved on {pretty(ed)}.")
    if "status" in d:
        s = d["status"]
        if s not in STATUSES:
            return jsonify(error="Invalid status."), 400
        db.x("UPDATE tickets SET status=?, resolved_at=? WHERE id=?", (s, now() if s == "Resolved" else None, tid))
        if s != "Open" and t["assigned_to"] is None and not admin:
            db.x("UPDATE tickets SET assigned_to=? WHERE id=?", (g.user["id"], tid))
        if s == "Resolved" and t["status"] != "Resolved":
            notify(db, t, "sms", t["phone"], "",
                   f"Kampala Solid Waste Portal: your report #{tid} ({t['type']} at {t['place']}, {t['area']}) "
                   "has been resolved. Thank you for helping keep Kampala clean.")
            out["message_status"] = db.one("SELECT status FROM messages WHERE ticket_id=? AND channel='sms' ORDER BY id DESC LIMIT 1", (tid,))["status"]
    return jsonify(out)


@app.post("/api/briefing")
@staff_required()
def briefing():
    rows = get_db().q("SELECT type,area,place,status FROM tickets")
    if not rows:
        return jsonify(error="No reports yet."), 400
    data = "\n".join(f"{t['type']} | {t['area']} | {t['place']} | {t['status']}" for t in rows)
    text = ask_ai("You coordinate solid waste collection in Kampala. Below are citizen reports "
                  "(issue | division | place | status). Write a briefing with: 1) top 3 priorities, "
                  "2) which divisions need extra trucks or collectors, 3) patterns, 4) two recommended "
                  "actions. Use only the data given, under 200 words, plain text.\n\n" + data)
    return jsonify(text=text or rule_briefing(rows))


@app.get("/api/messages")
@staff_required(admin=True)
def messages():
    return jsonify(get_db().q("SELECT id,ticket_id,channel,recipient,subject,body,status,created FROM messages ORDER BY id DESC LIMIT 100"))


@app.get("/api/staff")
@staff_required()
def staff_list():
    return jsonify(get_db().q("SELECT id,name,email,role,(password_hash IS NOT NULL) AS registered,(photo IS NOT NULL) AS has_photo FROM users ORDER BY id"))


@app.post("/api/staff")
@staff_required(admin=True)
def staff_add():
    d = request.get_json(silent=True) or {}
    name, email, role = str(d.get("name", "")).strip(), clean_email(d.get("email")), d.get("role")
    if len(name) < 2 or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) or role not in ("collector", "administrator"):
        return jsonify(error="Enter a name, a valid e-mail and a role."), 400
    db = get_db()
    if db.one("SELECT 1 AS x FROM users WHERE email=?", (email,)):
        return jsonify(error="That e-mail is already saved."), 409
    db.x("INSERT INTO users(name,email,role) VALUES(?,?,?)", (name[:80], email, role))
    return jsonify(ok=True), 201


@app.put("/api/schedule")
@staff_required(admin=True)
def schedule_put():
    sched = (request.get_json(silent=True) or {}).get("schedule")
    if not isinstance(sched, dict):
        return jsonify(error="Invalid schedule."), 400
    db = get_db()
    for area in AREAS:
        days = sched.get(area, [])
        if not isinstance(days, list) or any(x not in DAYS for x in days):
            return jsonify(error="Invalid days."), 400
        db.x("UPDATE schedule SET days=? WHERE area=?", (",".join(x for x in DAYS if x in days), area))
    return jsonify(ok=True)


@app.post("/api/demo")
@staff_required(admin=True)
def demo():
    db = get_db()
    if db.one("SELECT COUNT(*) AS n FROM tickets")["n"] == 0:
        n = datetime.now(timezone.utc)
        fmt = lambda days: (n - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        sample = [("Illegal dumping", "Kawempe", "Bwaise market", "Open", 0), ("Missed pickup", "Nakawa", "Ntinda", "Progress", 0),
                  ("Overflowing bin", "Central", "Kampala Road", "Resolved", 1), ("Blocked drainage", "Rubaga", "Lubaga", "Open", 1),
                  ("Missed pickup", "Makindye", "Kansanga", "Progress", 2), ("Illegal dumping", "Kawempe", "Kyebando", "Resolved", 3),
                  ("Missed pickup", "Kawempe", "Kawempe", "Open", 3), ("Overflowing bin", "Nakawa", "Bugolobi", "Resolved", 4),
                  ("Illegal dumping", "Rubaga", "Nateete", "Resolved", 5), ("Missed pickup", "Central", "Nakasero", "Open", 5),
                  ("Blocked drainage", "Makindye", "Katwe", "Progress", 6), ("Illegal dumping", "Nakawa", "Naguru", "Open", 6)]
        sched = get_schedule(db)
        for typ, area, place, status, ago in sample:
            res = fmt(max(ago - 1, 0)) if status == "Resolved" else None
            db.x("""INSERT INTO tickets(type,area,place,phone,details,status,demo,created,resolved_at,expected_date)
                    VALUES(?,?,?,?,?,?,1,?,?,?)""",
                 (typ, area, place, "+256700000000", "Sample data", status, fmt(ago), res, next_collection(db, area, sched)))
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))

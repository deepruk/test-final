"""Blocking SMTP/IMAP helpers — always call through asyncio.to_thread."""
import email
import random
import html
import imaplib
import re
import smtplib
import ssl

from lib import google_gmail
from email.header import decode_header, make_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, make_msgid, parseaddr
from urllib.parse import quote

TIMEOUT = 20
URL_RE = re.compile(r"(https?://[^\s<>\"']+)")


DEFAULTS = {"first_name": "there", "company": "your company"}
VAR_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}")


def render_vars(text: str, lead: dict, extra: dict | None = None) -> str:
    """{{key}} or {{key|fallback}} — key is a standard lead field, a CSV custom column, or an extra (unsubscribe_link)."""
    values = {k: str(v) for k, v in (lead.get("custom") or {}).items()}
    for k in ("first_name", "last_name", "company", "title", "email"):
        values[k] = lead.get(k) or ""
    values.update(extra or {})

    def sub(m: re.Match) -> str:
        key = m.group(1).strip().lower()
        fallback = m.group(2)
        val = values.get(key, "")
        if val:
            return val
        if fallback is not None:
            return fallback.strip()
        return DEFAULTS.get(key, "" if key in values else m.group(0))

    return VAR_RE.sub(sub, text)


SPIN_RE = re.compile(r"\{([^{}]*\|[^{}]*)\}")


def spin(text: str, rnd: "random.Random | None" = None) -> str:
    """Resolve spintax {Hi|Hey|Hello} (nesting allowed). Run after render_vars so {{var|fallback}} is already gone."""
    r = rnd or random
    for _ in range(20):
        new = SPIN_RE.sub(lambda m: r.choice(m.group(1).split("|")), text)
        if new == text:
            break
        text = new
    return text


def build_html(body: str, msg_id: str, base_url: str, track_opens: bool, track_clicks: bool,
               preheader: str = "") -> str:
    """Build HTML while preserving safe text escaping and stable per-message tracking IDs."""
    normalized = (body or "").replace("\r\n", "\n").replace("\r", "\n")
    escaped = html.escape(normalized)

    def link(m: re.Match) -> str:
        url = html.unescape(m.group(1))
        tracked = track_clicks and "/api/u/" not in url
        href = f"{base_url}/api/t/c/{msg_id}?u={quote(url, safe='')}" if tracked else url
        return f'<a href="{html.escape(href, quote=True)}">{html.escape(url)}</a>'

    escaped = URL_RE.sub(link, escaped)
    out = ""
    if preheader.strip():
        # Hidden preheader = inbox preview text. The nbsp padding keeps clients from
        # pulling body text into the preview after the preheader ends.
        pre = html.escape(preheader.strip())
        out += (
            '<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;'
            'height:0;width:0;overflow:hidden;mso-hide:all;">'
            f'{pre}'
            '</span>'
            '<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;'
            'height:0;width:0;overflow:hidden;mso-hide:all;">'
            + ('&nbsp;&zwnj;' * 60) +
            '</span>'
        )
    out += "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.5\">" + escaped.replace("\n", "<br>") + "</div>"
    if track_opens:
        pixel_url = f"{base_url}/api/t/o/{msg_id}.gif"
        out += f'<img src="{html.escape(pixel_url, quote=True)}" width="1" height="1" alt="" style="display:none">'
    return out


def _smtp(sender: dict) -> smtplib.SMTP:
    host, port, sec = sender["smtp_host"], int(sender["smtp_port"]), sender.get("smtp_security", "starttls")
    if sec == "ssl":
        s: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT, context=ssl.create_default_context())
    else:
        s = smtplib.SMTP(host, port, timeout=TIMEOUT)
        s.ehlo()
        if sec == "starttls":
            s.starttls(context=ssl.create_default_context())
            s.ehlo()
    s.login(sender["smtp_user"], sender["smtp_pass"])
    return s


def send_email(sender: dict, to: str, subject: str, html_body: str, text_body: str,
               in_reply_to: str | None = None, unsubscribe_url: str | None = None,
               plain_only: bool = False) -> str:
    """Send one message; returns the Message-ID header used. If plain_only, no HTML part is attached."""
    domain = sender["email"].split("@")[-1]
    message_id = make_msgid(domain=domain)
    # Plain-text-only mode drops the HTML part entirely — looks hand-typed, no tracking, no bulk-mailer fingerprint.
    msg: email.message.Message
    if plain_only:
        msg = MIMEText(text_body, "plain", "utf-8")
    else:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))
    msg["From"] = formataddr((sender.get("from_name") or "", sender["email"]))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = message_id
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    if unsubscribe_url:
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    if sender.get("auth_type") == "google_oauth":
        return google_gmail.send_message(sender, msg)
    s = _smtp(sender)
    try:
        s.sendmail(sender["email"], [to], msg.as_string())
    finally:
        try:
            s.quit()
        except Exception:
            pass
    return message_id


def test_connection(cfg: dict) -> dict:
    if cfg.get("auth_type") == "google_oauth":
        try:
            return google_gmail.test_connection(cfg)
        except Exception as e:
            message = str(e)[:300]
            return {"smtp_ok": False, "smtp_error": message, "imap_ok": False, "imap_error": message}
    res = {"smtp_ok": False, "smtp_error": "", "imap_ok": False, "imap_error": ""}
    try:
        s = _smtp(cfg)
        s.quit()
        res["smtp_ok"] = True
    except Exception as e:
        res["smtp_error"] = str(e)[:300]
    if cfg.get("imap_host"):
        try:
            m = imaplib.IMAP4_SSL(cfg["imap_host"], int(cfg.get("imap_port") or 993), timeout=TIMEOUT)
            m.login(cfg.get("imap_user") or cfg["smtp_user"], cfg.get("imap_pass") or cfg["smtp_pass"])
            m.logout()
            res["imap_ok"] = True
        except Exception as e:
            res["imap_error"] = str(e)[:300]
    else:
        res["imap_error"] = "IMAP not configured"
    return res


def _dec(v: str | None) -> str:
    if not v:
        return ""
    try:
        return str(make_header(decode_header(v)))
    except Exception:
        return v


def _text_of(msg: email.message.Message) -> str:
    if msg.is_multipart():
        html_part = None
        for part in msg.walk():
            ctype = part.get_content_type()
            if part.get("Content-Disposition", "").startswith("attachment"):
                continue
            if ctype == "text/plain":
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
            if ctype == "text/html" and html_part is None:
                html_part = part
        if html_part is not None:
            raw = html_part.get_payload(decode=True).decode(html_part.get_content_charset() or "utf-8", "replace")
            return re.sub(r"<[^>]+>", " ", raw)
        return ""
    payload = msg.get_payload(decode=True) or b""
    return payload.decode(msg.get_content_charset() or "utf-8", "replace")


def strip_quoted(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if line.startswith(">") or re.match(r"^On .+wrote:\s*$", line):
            break
        lines.append(line)
    return "\n".join(lines).strip() or text.strip()


def fetch_new(sender: dict, last_uid: int) -> tuple[list[dict], int]:
    """Fetch messages with UID > last_uid (or last 7 days on first sync). Returns (messages, max_uid)."""
    if sender.get("auth_type") == "google_oauth":
        return google_gmail.fetch_new(sender, last_uid)
    m = imaplib.IMAP4_SSL(sender["imap_host"], int(sender.get("imap_port") or 993), timeout=TIMEOUT)
    out: list[dict] = []
    max_uid = last_uid
    try:
        m.login(sender.get("imap_user") or sender["smtp_user"], sender.get("imap_pass") or sender["smtp_pass"])
        m.select("INBOX", readonly=True)
        if last_uid > 0:
            typ, data = m.uid("search", None, f"UID {last_uid + 1}:*")
        else:
            import datetime as _dt
            since = (_dt.date.today() - _dt.timedelta(days=7)).strftime("%d-%b-%Y")
            typ, data = m.uid("search", None, f"SINCE {since}")
        uids = [int(u) for u in (data[0].split() if data and data[0] else [])]
        uids = [u for u in uids if u > last_uid][-200:]
        for uid in uids:
            typ, msg_data = m.uid("fetch", str(uid), "(RFC822)")
            if not msg_data or not isinstance(msg_data[0], tuple):
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            out.append({
                "uid": uid,
                "from_email": parseaddr(msg.get("From", ""))[1].lower(),
                "from_name": _dec(parseaddr(msg.get("From", ""))[0]),
                "subject": _dec(msg.get("Subject")),
                "message_id": (msg.get("Message-ID") or "").strip(),
                "in_reply_to": (msg.get("In-Reply-To") or "").strip(),
                "references": (msg.get("References") or "").strip(),
                "body": _text_of(msg),
            })
            max_uid = max(max_uid, uid)
    finally:
        try:
            m.logout()
        except Exception:
            pass
    return out, max_uid

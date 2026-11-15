Kampala Solid Waste Collection and Citizen Engagement Portal (Flask)
Contact: 0755530904 | solidwaste@gmail.com

FILES (keep all in ONE folder): app.py, requirements.txt, index.html, style.css, app.js

RUN LOCALLY:  pip install -r requirements.txt   then   python app.py   -> http://127.0.0.1:5000
RENDER (Web Service): Build: pip install -r requirements.txt   Start: gunicorn app:app

ENVIRONMENT VARIABLES (Render > Environment)
  SECRET_KEY         long random text (keeps staff logins secure)               [recommended]
  DATABASE_URL       PostgreSQL connection string. REQUIRED for permanent data   [staff accounts,
                     photos, reports. Without it the database is wiped when Render restarts.]
  BREVO_API_KEY      sends e-mails to staff (HTTPS API, works on Render free)    [optional]
  MAIL_FROM          sender e-mail verified in Brevo (default solidwaste@gmail.com)
  AT_USERNAME, AT_API_KEY   Africa's Talking, sends real SMS to reporters        [optional]
  ADMIN_EMAIL        optional extra administrator e-mail
  ANTHROPIC_API_KEY  real AI chat and briefing                                    [optional]

STAFF IN THE DATABASE (edit SEED_STAFF in app.py if an e-mail is spelled differently):
  Kiiza Kenneth  kiizakenneth@gmail.com  administrator
  Ashaba Brian   ashababrian@gmail.com   collector
  Alaho Alex     alex@gmail.com          collector
Each person registers ONCE (with an optional photo). After that they log in, and stay logged in for 30 days.

# Guida al Deploy su cPanel (Solo Node.js + MySQL) — Giulia Beauty Studio

Questa guida spiega passo passo come attivare il backend proprietario **100% Node.js + Express + MySQL** (zero PHP) sull'hosting **cPanel** con database **MySQL**.

---

## 1. Crea il Database MySQL in cPanel

1. Accedi a **cPanel** del tuo hosting.
2. Apri **Database MySQL®** (o *Creazione guidata database MySQL*).
3. Crea un nuovo database (es. `nomeutente_giuliabeauty`).
4. Crea un nuovo utente MySQL con una **password sicura** e annota:
   - `DB_HOST` (`localhost` nella maggior parte dei server cPanel)
   - `DB_NAME` (nome database)
   - `DB_USER` (username database)
   - `DB_PASS` (password database)
5. Assegna l'utente al database selezionando **TUTTI I PRIVILEGI**.

---

## 2. Carica il progetto & configura Node.js in cPanel

1. Carica tutti i file del repository in una cartella del tuo account cPanel (es. `giulia-beauty-studio/`, fuori o dentro la root come previsto dal selettore Node.js del tuo hosting — con **Setup Node.js App** puoi metterlo in `/home/utente/giulia-beauty-studio`).
2. Apri **Setup Node.js App** (o *Application Manager*) in cPanel e clicca **Create Application**:
   - **Node.js version:** `18.x`, `20.x` o `22.x`
   - **Application mode:** `Production`
   - **Application root:** `giulia-beauty-studio`
   - **Application URL:** il tuo dominio/sottodominio (es. `giuliabeautystudio.it`)
   - **Application startup file:** `server.js`
3. Nella stessa schermata clicca **Run NPM Install** per installare `express`, `mysql2` e `dotenv` (oppure esegui `npm install` da Terminale cPanel).

---

## 3. Configura le variabili d'ambiente (`.env`)

1. Nella cartella dell'app (`giulia-beauty-studio/`) duplica `.env.example` e rinominalo in `.env` (file escluso da Git tramite `.gitignore` per non esporre mai credenziali su GitHub).
2. Compila `.env` con i dati del database MySQL creati al punto 1:
   - `DB_HOST=localhost`
   - `DB_NAME=...`
   - `DB_USER=...`
   - `DB_PASS=...`
   - `SESSION_SECRET=...` (stringa casuale lunga 32+ caratteri)
   - `IP_HASH_SALT=...` (stringa casuale per anonimizzare gli IP nei log GDPR)
   - `COOKIE_SECURE=true` (se il dominio usa HTTPS/SSL)
   - `ALLOWED_ORIGINS=https://tuodominio.it,https://www.tuodominio.it`
3. Torna in **Setup Node.js App** e clicca **Restart**.

> **Verifica veloce:** apri `https://tuodominio.it/api/health` e controlla che risponda `{"ok":true,"runtime":"nodejs","db_connected":true}`.

---

## 4. Inizializza Tabelle MySQL e Primo Utente Admin

### Metodo A — Procedura guidata web (`/api/setup`)
1. Apri nel browser `https://tuodominio.it/api/setup`.
2. Inserisci nome titolare, username/email (es. `giulia@giuliabeautystudio.it`) e password (min. 8 caratteri).
3. Premi **Crea Database e Account Titolare**: Node.js eseguirà automaticamente `backend/schema.sql` (`admin_users`, `admin_sessions`, `clients`, `appointments`, `privacy_logs`) e creerà l'account di Giulia.
4. Una volta creato il primo admin, `/api/setup` blocca automaticamente la creazione di nuovi account.

### Metodo B — Terminale + phpMyAdmin
- Puoi anche eseguire `npm run init-db` dal Terminale cPanel (o importare `backend/schema.sql` da phpMyAdmin) e poi visitare `/api/setup` per creare l'account admin.

---

## 5. Avvio in Locale (Test Sviluppo)

```bash
cp .env.example .env
# Inserisci le tue credenziali MySQL locali in .env
npm install
npm start
```

Poi apri `http://localhost:3000/` per la boutique pubblica e `http://localhost:3000/admin.html` per l'Agenda & Database Clienti.

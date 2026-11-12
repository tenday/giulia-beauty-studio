# Guida al Deploy su cPanel (MySQL + PHP) — Giulia Beauty Studio

Questa guida spiega passo passo come attivare il backend proprietario (Agenda stile Google Calendar, Database Clienti / CRM e Log Consensi Privacy GDPR) sull'hosting **cPanel** con database **MySQL**.

---

## 1. Crea il Database MySQL in cPanel

1. Accedi a **cPanel** del tuo hosting.
2. Apri **Database MySQL®** (oppure *Creazione guidata database MySQL*).
3. Crea un nuovo database (es. `nomeutente_giuliabeauty`).
4. Crea un nuovo utente MySQL con una **password sicura** e annota:
   - Host (`localhost` nella maggior parte dei server cPanel)
   - Nome database
   - Username database
   - Password database
5. Assegna l'utente al database selezionando **TUTTI I PRIVILEGI**.

---

## 2. Carica i file su cPanel (`public_html`)

Carica tutti i file del repository nella cartella pubblica del dominio (di solito `public_html/`, oppure una sottocartella come `public_html/studio/`):

- `index.html`, `styles.css`, `app.js`, `catalog.js`
- `admin.html`, `admin.css`, `admin.js`
- Cartella `assets/`
- Cartella `api/`
- Cartella `backend/`

> **Nota importante su GitHub Pages:** GitHub Pages serve solo file statici e non esegue PHP. Caricando l'intero sito su cPanel avrai sia il sito pubblico che il pannello `admin.html` e le API PHP sotto lo stesso dominio (consigliato per cookie di sessione e zero problemi CORS).  
> Se invece vuoi mantenere il frontend su GitHub Pages e solo `/api/` su cPanel, aggiorna `API_BASE` in `app.js` e `admin.js` con l'URL completo di cPanel (es. `https://tuodominio.it/api`) e aggiungi il dominio GitHub Pages in `allowed_origins` dentro `api/config.php`.

---

## 3. Configura `api/config.php`

1. Nel File Manager di cPanel entra nella cartella `api/`.
2. Duplica `config.example.php` e rinomina la copia in `config.php` (questo file è escluso da Git tramite `.gitignore` per non esporre mai le password su GitHub).
3. Modifica `api/config.php` inserendo i dati del database creato al punto 1:
   - `host`, `name`, `user`, `pass`
   - `ip_hash_salt`: una stringa casuale lunga e segreta per anonimizzare gli IP nei log GDPR (`privacy_logs`).
   - `allowed_origins`: il tuo dominio `https://...`.

---

## 4. Inizializza Tabelle e Primo Utente Admin

Hai due modi (consigliato il Metodo A):

### Metodo A — Procedura guidata automatica (`api/setup.php`)
1. Apri nel browser `https://tuodominio.it/api/setup.php`.
2. Inserisci nome, email di accesso (es. `giulia@giuliabeautystudio.it`) e password amministratore.
3. Premi **Inizializza Database e Crea Admin**: lo script eseguirà `backend/schema.sql` creando le tabelle `admin_users`, `clients`, `appointments`, `privacy_logs` e creerà l'account admin.
4. Una volta completato, `setup.php` si blocca automaticamente se esiste già un admin; per massima sicurezza puoi anche eliminarlo dal File Manager dopo il primo accesso.

### Metodo B — Import manuale via phpMyAdmin
1. Apri **phpMyAdmin** da cPanel, seleziona il tuo database e importa `backend/schema.sql`.
2. Poi apri `api/setup.php` per creare solo il primo utente amministratore.

---

## 5. Accesso all'Agenda e al Database Clienti

- **Sito pubblico clienti:** `https://tuodominio.it/`
- **Agenda Giulia & CRM Clienti:** `https://tuodominio.it/admin.html`

Funzionalità incluse nel pannello riservato:
- **Agenda stile Google Calendar:** viste **Settimana**, **Giorno** ed **Elenco**, creazione/modifica rapida appuntamenti con selettore trattamenti dal listino, cambio stato (`Confermato`, `In attesa`, `Completato`, `Annullato`, `No-show`), blocco automatico degli orari già occupati sul sito pubblico (inclusi martedì e domenica chiusi) e link rapido **Promemoria WhatsApp**.
- **Database Clienti (CRM):** anagrafica completa persistente su MySQL, storico trattamenti e spesa, campo dedicato per **Allergie / Sensibilità / Note Tecniche**, esportazione CSV/JSON.
- **Conformità Privacy GDPR:** ogni prenotazione registra in `privacy_logs` la versione dell'informativa accettata (`v2.0-2026-11`), timestamp, canale e hash IP anonimizzato, con funzione di **Cancellazione GDPR (Diritto all'oblio)** dalla scheda cliente.

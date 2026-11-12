<?php
/**
 * GIULIA BEAUTY STUDIO — One-Time Setup Wizard (Tables + First Admin User)
 * Automatically locks itself once at least one admin account exists in MySQL.
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

$config = gbs_load_config();
$pdo = gbs_get_pdo($config);

// Ensure tables exist from schema.sql
$schemaFile = dirname(__DIR__) . '/backend/schema.sql';
if (file_exists($schemaFile)) {
    $sql = file_get_contents($schemaFile);
    if ($sql !== false) {
        $statements = array_filter(array_map('trim', explode(';', $sql)));
        foreach ($statements as $stmt) {
            if ($stmt === '' || strpos($stmt, '--') === 0 || stripos($stmt, 'SET ') === 0) {
                continue;
            }
            $pdo->exec($stmt);
        }
    }
}

$adminCount = (int) $pdo->query('SELECT COUNT(*) FROM admin_users')->fetchColumn();

$message = '';
$error = '';

if ($adminCount === 0 && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $username = trim((string) ($_POST['username'] ?? ''));
    $displayName = trim((string) ($_POST['display_name'] ?? 'Giulia'));
    $password = (string) ($_POST['password'] ?? '');

    if ($username === '' || strlen($password) < 8) {
        $error = 'Inserisci un username/email valido e una password di almeno 8 caratteri.';
    } else {
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare('INSERT INTO admin_users (username, display_name, password_hash) VALUES (?, ?, ?)');
        $stmt->execute([$username, $displayName !== '' ? $displayName : 'Giulia', $hash]);
        $adminCount = 1;
        $message = 'Configurazione completata! Le tabelle MySQL e l\'account di Giulia sono pronti.';
    }
}
?>
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Setup Gestionale — Giulia Beauty Studio</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    body {
      font-family: 'Montserrat', sans-serif;
      background: linear-gradient(180deg, #fdf8f7 0%, #f4dcd9 100%);
      color: #3d1218;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      margin: 0;
    }
    .setup-card {
      background: #fffbfa;
      border: 1px solid rgba(145, 78, 86, 0.4);
      border-radius: 22px;
      padding: 36px 32px;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 20px 50px -12px rgba(74, 21, 29, 0.14);
    }
    h1 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 2rem;
      margin: 0 0 8px;
      color: #3d1218;
    }
    p { font-size: 0.88rem; color: #6e3b42; line-height: 1.6; }
    label {
      display: block;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin: 16px 0 6px;
      color: #6e3b42;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid rgba(145, 78, 86, 0.45);
      font-family: inherit;
      font-size: 16px;
    }
    .btn {
      display: inline-block;
      width: 100%;
      margin-top: 22px;
      padding: 14px 20px;
      border-radius: 999px;
      border: none;
      background: #3d1218;
      color: #fffbfa;
      font-family: inherit;
      font-size: 0.76rem;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }
    .alert {
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 0.84rem;
      margin-top: 14px;
    }
    .alert-err { background: #fde8ec; border: 1px solid #b5586b; color: #4a151d; }
    .alert-ok { background: #eef6f1; border: 1px solid #3b6e52; color: #244733; }
  </style>
</head>
<body>
  <div class="setup-card">
    <h1>♡ Giulia Beauty Studio</h1>
    <p>Inizializzazione del database MySQL proprietario (Agenda, Database Clienti &amp; Log Privacy GDPR).</p>

    <?php if ($error !== ''): ?>
      <div class="alert alert-err"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>

    <?php if ($message !== ''): ?>
      <div class="alert alert-ok"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></div>
    <?php endif; ?>

    <?php if ($adminCount > 0): ?>
      <p style="margin-top: 16px;">
        <strong>Database e accesso già configurati.</strong><br />
        Per sicurezza, la creazione di nuovi account da questa pagina è bloccata. Puoi accedere subito all'area riservata.
      </p>
      <a href="../admin.html" class="btn">Vai all'Agenda Gestionale →</a>
    <?php else: ?>
      <form method="POST">
        <label for="display_name">Nome Titolare</label>
        <input type="text" id="display_name" name="display_name" value="Giulia" required />

        <label for="username">Username o Email di Accesso</label>
        <input type="text" id="username" name="username" placeholder="es. giulia@giuliabeauty.it" required />

        <label for="password">Password Riservata (min. 8 caratteri)</label>
        <input type="password" id="password" name="password" minlength="8" required />

        <button type="submit" class="btn">Crea Database e Account Titolare</button>
      </form>
    <?php endif; ?>
  </div>
</body>
</html>

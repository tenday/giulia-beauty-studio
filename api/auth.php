<?php
/**
 * GIULIA BEAUTY STUDIO — Admin Authentication Endpoint
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

$config = gbs_load_config();
gbs_apply_cors($config);
$pdo = gbs_get_pdo($config);
gbs_start_session();

$action = (string) ($_GET['action'] ?? 'me');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'me' && $method === 'GET') {
    if (empty($_SESSION['gbs_admin_id'])) {
        gbs_json_response(['ok' => true, 'authenticated' => false]);
    }
    gbs_json_response([
        'ok' => true,
        'authenticated' => true,
        'admin' => [
            'id' => (int) $_SESSION['gbs_admin_id'],
            'username' => (string) ($_SESSION['gbs_admin_username'] ?? ''),
            'display_name' => (string) ($_SESSION['gbs_admin_name'] ?? 'Giulia'),
        ],
    ]);
}

if ($action === 'login' && $method === 'POST') {
    $body = gbs_read_json_body();
    $username = trim((string) ($body['username'] ?? ''));
    $password = (string) ($body['password'] ?? '');

    if ($username === '' || $password === '') {
        gbs_json_error('Inserisci username e password.', 400, 'CREDENTIALS_REQUIRED');
    }

    try {
        $stmt = $pdo->prepare('SELECT id, username, display_name, password_hash FROM admin_users WHERE username = ? LIMIT 1');
        $stmt->execute([$username]);
        $user = $stmt->fetch();
    } catch (PDOException $e) {
        gbs_json_error('Tabelle database non trovate. Esegui prima api/setup.php o importa backend/schema.sql.', 500, 'SCHEMA_MISSING');
    }

    if (!$user || !password_verify($password, (string) $user['password_hash'])) {
        gbs_json_error('Credenziali non valide.', 401, 'INVALID_CREDENTIALS');
    }

    session_regenerate_id(true);
    $_SESSION['gbs_admin_id'] = (int) $user['id'];
    $_SESSION['gbs_admin_username'] = (string) $user['username'];
    $_SESSION['gbs_admin_name'] = (string) $user['display_name'];

    gbs_json_response([
        'ok' => true,
        'authenticated' => true,
        'admin' => [
            'id' => (int) $user['id'],
            'username' => (string) $user['username'],
            'display_name' => (string) $user['display_name'],
        ],
    ]);
}

if ($action === 'logout' && $method === 'POST') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
    gbs_json_response(['ok' => true]);
}

if ($action === 'change_password' && $method === 'POST') {
    $admin = gbs_require_admin();
    $body = gbs_read_json_body();
    $current = (string) ($body['current_password'] ?? '');
    $next = (string) ($body['new_password'] ?? '');

    if (strlen($next) < 8) {
        gbs_json_error('La nuova password deve contenere almeno 8 caratteri.', 400);
    }

    $stmt = $pdo->prepare('SELECT password_hash FROM admin_users WHERE id = ? LIMIT 1');
    $stmt->execute([$admin['id']]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($current, (string) $row['password_hash'])) {
        gbs_json_error('La password attuale non è corretta.', 403);
    }

    $newHash = password_hash($next, PASSWORD_DEFAULT);
    $upd = $pdo->prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?');
    $upd->execute([$newHash, $admin['id']]);

    gbs_json_response(['ok' => true, 'message' => 'Password aggiornata con successo.']);
}

gbs_json_error('Azione non supportata.', 405);

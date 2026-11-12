<?php
/**
 * GIULIA BEAUTY STUDIO — Database PDO & Security Helpers
 */

declare(strict_types=1);

function gbs_load_config(): array
{
    $configPath = __DIR__ . '/config.php';
    if (!file_exists($configPath)) {
        gbs_json_error(
            'Configurazione database mancante. Copia api/config.example.php in api/config.php su cPanel e inserisci le credenziali MySQL.',
            503,
            'CONFIG_MISSING'
        );
    }

    $config = require $configPath;
    if (!is_array($config)) {
        gbs_json_error('File api/config.php non valido.', 500, 'CONFIG_INVALID');
    }

    if (!empty($config['timezone'])) {
        date_default_timezone_set((string) $config['timezone']);
    } else {
        date_default_timezone_set('Europe/Rome');
    }

    return $config;
}

function gbs_apply_cors(array $config): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = $config['allowed_origins'] ?? [];

    if ($origin !== '' && (in_array('*', $allowed, true) || in_array($origin, $allowed, true))) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    }

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function gbs_json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function gbs_json_error(string $message, int $status = 400, string $code = 'ERROR'): void
{
    gbs_json_response([
        'ok' => false,
        'code' => $code,
        'error' => $message,
    ], $status);
}

function gbs_get_pdo(array $config): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = (string) ($config['db_host'] ?? 'localhost');
    $port = (int) ($config['db_port'] ?? 3306);
    $name = (string) ($config['db_name'] ?? '');
    $user = (string) ($config['db_user'] ?? '');
    $pass = (string) ($config['db_pass'] ?? '');

    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $name);

    try {
        $pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (PDOException $e) {
        gbs_json_error('Impossibile connettersi al database MySQL. Verifica api/config.php.', 500, 'DB_CONNECTION_ERROR');
    }

    return $pdo;
}

function gbs_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        gbs_json_error('Payload JSON non valido.', 400, 'INVALID_JSON');
    }
    return $decoded;
}

function gbs_normalize_phone(string $phone): string
{
    $digits = preg_replace('/[^\d+]/', '', trim($phone));
    if ($digits === null) {
        return '';
    }
    if (strpos($digits, '00') === 0) {
        $digits = '+' . substr($digits, 2);
    }
    if ($digits !== '' && $digits[0] !== '+') {
        $digits = '+39' . $digits;
    }
    return $digits;
}

function gbs_is_closed_day(string $dateStr): bool
{
    $dt = DateTime::createFromFormat('Y-m-d', $dateStr);
    if (!$dt || $dt->format('Y-m-d') !== $dateStr) {
        return false;
    }
    $dow = (int) $dt->format('w'); // 0 = Domenica, 2 = Martedì
    return $dow === 0 || $dow === 2;
}

function gbs_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443');

    session_name('GBS_STUDIO_SESSION');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 12,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => $isHttps ? 'None' : 'Lax',
    ]);
    session_start();
}

function gbs_require_admin(): array
{
    gbs_start_session();
    if (empty($_SESSION['gbs_admin_id'])) {
        gbs_json_error('Accesso riservato. Effettua il login.', 401, 'UNAUTHORIZED');
    }
    return [
        'id' => (int) $_SESSION['gbs_admin_id'],
        'username' => (string) ($_SESSION['gbs_admin_username'] ?? 'admin'),
        'display_name' => (string) ($_SESSION['gbs_admin_name'] ?? 'Giulia'),
    ];
}

function gbs_hash_ip(array $config): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    $salt = (string) ($config['ip_salt'] ?? 'gbs-default-salt');
    return hash('sha256', $ip . '|' . $salt);
}

function gbs_generate_booking_code(PDO $pdo): string
{
    for ($i = 0; $i < 8; $i++) {
        $code = 'GBS-' . random_int(100000, 999999);
        $stmt = $pdo->prepare('SELECT id FROM appointments WHERE booking_code = ? LIMIT 1');
        $stmt->execute([$code]);
        if (!$stmt->fetch()) {
            return $code;
        }
    }
    return 'GBS-' . strtoupper(bin2hex(random_bytes(3)));
}

function gbs_time_to_minutes(string $timeStr): int
{
    $parts = explode(':', $timeStr);
    $h = isset($parts[0]) ? (int) $parts[0] : 0;
    $m = isset($parts[1]) ? (int) $parts[1] : 0;
    return ($h * 60) + $m;
}

function gbs_slot_overlaps_booked(string $slotTime, int $slotDuration, array $bookedRows): bool
{
    $slotStart = gbs_time_to_minutes($slotTime);
    $slotEnd = $slotStart + max(15, $slotDuration);

    foreach ($bookedRows as $row) {
        $bStart = gbs_time_to_minutes((string) $row['start_time']);
        $bDuration = max(15, (int) $row['duration_minutes']);
        $bEnd = $bStart + $bDuration;

        if ($slotStart < $bEnd && $bStart < $slotEnd) {
            return true;
        }
    }
    return false;
}

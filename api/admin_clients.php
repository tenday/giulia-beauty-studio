<?php
/**
 * GIULIA BEAUTY STUDIO — Admin Client Database (CRM + GDPR Dossier)
 * Protected by PHP Session Auth
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

$config = gbs_load_config();
gbs_apply_cors($config);
$pdo = gbs_get_pdo($config);
gbs_require_admin();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $id = (int) ($_GET['id'] ?? 0);

    if ($id > 0) {
        $stmt = $pdo->prepare('SELECT * FROM clients WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        $client = $stmt->fetch();
        if (!$client) {
            gbs_json_error('Cliente non trovata.', 404);
        }

        $apptStmt = $pdo->prepare(
            "SELECT id, booking_code, appointment_date, TIME_FORMAT(start_time, '%H:%i') AS start_time,
                    duration_minutes, services_summary, total_price, mode, payment_method, status, notes, created_at
             FROM appointments
             WHERE client_id = ?
             ORDER BY appointment_date DESC, start_time DESC"
        );
        $apptStmt->execute([$id]);
        $appointments = $apptStmt->fetchAll();

        $logStmt = $pdo->prepare(
            'SELECT id, appointment_id, consent_type, consent_version, accepted_at
             FROM privacy_logs
             WHERE client_id = ?
             ORDER BY accepted_at DESC'
        );
        $logStmt->execute([$id]);
        $privacyLogs = $logStmt->fetchAll();

        gbs_json_response([
            'ok' => true,
            'client' => $client,
            'appointments' => $appointments,
            'privacy_logs' => $privacyLogs,
        ]);
    }

    $q = trim((string) ($_GET['q'] ?? ''));
    $sql = "SELECT
                c.*,
                COUNT(CASE WHEN a.status <> 'cancelled' THEN a.id END) AS appointments_count,
                COALESCE(SUM(CASE WHEN a.status <> 'cancelled' THEN a.total_price ELSE 0 END), 0) AS total_spent,
                MAX(CASE WHEN a.status <> 'cancelled' THEN a.appointment_date END) AS last_visit
            FROM clients c
            LEFT JOIN appointments a ON a.client_id = c.id";

    $params = [];
    if ($q !== '') {
        $like = '%' . $q . '%';
        $sql .= ' WHERE c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.allergies_notes LIKE ?';
        $params = [$like, $like, $like, $like];
    }

    $sql .= ' GROUP BY c.id ORDER BY c.full_name ASC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $clients = $stmt->fetchAll();

    gbs_json_response([
        'ok' => true,
        'clients' => $clients,
    ]);
}

if ($method === 'POST') {
    $body = gbs_read_json_body();
    $action = (string) ($body['action'] ?? 'save');

    // GDPR Right to Erasure (Diritto all'Oblio)
    if ($action === 'delete') {
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            gbs_json_error('ID cliente non valido.', 400);
        }
        $del = $pdo->prepare('DELETE FROM clients WHERE id = ?');
        $del->execute([$id]);
        gbs_json_response(['ok' => true, 'deleted_client_id' => $id]);
    }

    $id = (int) ($body['id'] ?? 0);
    $fullName = trim((string) ($body['full_name'] ?? ''));
    $phoneRaw = trim((string) ($body['phone'] ?? ''));
    $email = trim((string) ($body['email'] ?? ''));
    $allergiesNotes = trim((string) ($body['allergies_notes'] ?? ''));
    $preferencesNotes = trim((string) ($body['preferences_notes'] ?? ''));
    $privacyAccepted = !empty($body['privacy_accepted']) ? 1 : 0;
    $marketingConsent = !empty($body['marketing_consent']) ? 1 : 0;

    if ($fullName === '' || $phoneRaw === '') {
        gbs_json_error('Nome completo e telefono sono obbligatori.', 422);
    }

    $phoneNorm = gbs_normalize_phone($phoneRaw);
    $privacyVersion = (string) ($config['privacy_version'] ?? 'v2.0-2026-11');
    $nowStr = date('Y-m-d H:i:s');

    try {
        if ($id > 0) {
            $curStmt = $pdo->prepare('SELECT privacy_accepted, privacy_accepted_at FROM clients WHERE id = ? LIMIT 1');
            $curStmt->execute([$id]);
            $cur = $curStmt->fetch();
            if (!$cur) {
                gbs_json_error('Cliente non trovata.', 404);
            }

            $acceptedAt = $cur['privacy_accepted_at'];
            if ($privacyAccepted && empty($cur['privacy_accepted'])) {
                $acceptedAt = $nowStr;
            } elseif (!$privacyAccepted) {
                $acceptedAt = null;
            }

            $upd = $pdo->prepare(
                'UPDATE clients
                 SET full_name = ?, phone = ?, phone_normalized = ?, email = ?, allergies_notes = ?, preferences_notes = ?,
                     privacy_accepted = ?, privacy_accepted_at = ?, privacy_version = ?, marketing_consent = ?
                 WHERE id = ?'
            );
            $upd->execute([
                $fullName,
                $phoneRaw,
                $phoneNorm,
                $email !== '' ? $email : null,
                $allergiesNotes !== '' ? $allergiesNotes : null,
                $preferencesNotes !== '' ? $preferencesNotes : null,
                $privacyAccepted,
                $acceptedAt,
                $privacyVersion,
                $marketingConsent,
                $id,
            ]);

            if ($privacyAccepted && empty($cur['privacy_accepted'])) {
                $log = $pdo->prepare(
                    'INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
                     VALUES (?, NULL, ?, ?, ?, ?, ?)'
                );
                $log->execute([$id, 'studio_crm_update', $privacyVersion, $nowStr, gbs_hash_ip($config), 'Admin CRM']);
            }

            gbs_json_response(['ok' => true, 'id' => $id]);
        }

        // Insert new client
        $ins = $pdo->prepare(
            'INSERT INTO clients
             (full_name, phone, phone_normalized, email, allergies_notes, preferences_notes, privacy_accepted, privacy_accepted_at, privacy_version, marketing_consent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $fullName,
            $phoneRaw,
            $phoneNorm,
            $email !== '' ? $email : null,
            $allergiesNotes !== '' ? $allergiesNotes : null,
            $preferencesNotes !== '' ? $preferencesNotes : null,
            $privacyAccepted,
            $privacyAccepted ? $nowStr : null,
            $privacyVersion,
            $marketingConsent,
        ]);
        $newId = (int) $pdo->lastInsertId();

        if ($privacyAccepted) {
            $log = $pdo->prepare(
                'INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
                 VALUES (?, NULL, ?, ?, ?, ?, ?)'
            );
            $log->execute([$newId, 'studio_crm_create', $privacyVersion, $nowStr, gbs_hash_ip($config), 'Admin CRM']);
        }

        gbs_json_response(['ok' => true, 'id' => $newId], 201);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            gbs_json_error('Esiste già una cliente registrata con questo numero di telefono.', 409);
        }
        gbs_json_error('Errore durante il salvataggio della scheda cliente.', 500);
    }
}

gbs_json_error('Metodo non consentito.', 405);

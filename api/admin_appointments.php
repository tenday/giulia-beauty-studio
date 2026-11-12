<?php
/**
 * GIULIA BEAUTY STUDIO — Admin Appointments API (Calendar CRUD)
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
    $startDate = trim((string) ($_GET['start_date'] ?? ''));
    $endDate = trim((string) ($_GET['end_date'] ?? ''));
    $status = trim((string) ($_GET['status'] ?? ''));
    $clientId = (int) ($_GET['client_id'] ?? 0);

    $where = ['1=1'];
    $params = [];

    if ($startDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $startDate)) {
        $where[] = 'a.appointment_date >= ?';
        $params[] = $startDate;
    }
    if ($endDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $endDate)) {
        $where[] = 'a.appointment_date <= ?';
        $params[] = $endDate;
    }
    if ($status !== '' && in_array($status, ['pending', 'confirmed', 'completed', 'cancelled'], true)) {
        $where[] = 'a.status = ?';
        $params[] = $status;
    }
    if ($clientId > 0) {
        $where[] = 'a.client_id = ?';
        $params[] = $clientId;
    }

    $sql = sprintf(
        "SELECT
            a.id,
            a.booking_code,
            a.client_id,
            a.appointment_date,
            TIME_FORMAT(a.start_time, '%%H:%%i') AS start_time,
            a.duration_minutes,
            a.services_json,
            a.services_summary,
            a.total_price,
            a.mode,
            a.payment_method,
            a.status,
            a.notes,
            a.privacy_accepted,
            a.privacy_accepted_at,
            a.created_at,
            c.full_name AS client_name,
            c.phone AS client_phone,
            c.email AS client_email,
            c.allergies_notes,
            c.preferences_notes,
            c.privacy_version
         FROM appointments a
         INNER JOIN clients c ON c.id = a.client_id
         WHERE %s
         ORDER BY a.appointment_date ASC, a.start_time ASC",
        implode(' AND ', $where)
    );

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    gbs_json_response([
        'ok' => true,
        'appointments' => $rows,
    ]);
}

if ($method === 'POST') {
    $body = gbs_read_json_body();
    $action = (string) ($body['action'] ?? 'create');

    if ($action === 'delete') {
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            gbs_json_error('ID appuntamento mancante.', 400);
        }
        $del = $pdo->prepare('DELETE FROM appointments WHERE id = ?');
        $del->execute([$id]);
        gbs_json_response(['ok' => true, 'deleted_id' => $id]);
    }

    if ($action === 'update') {
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            gbs_json_error('ID appuntamento mancante.', 400);
        }

        $allowedStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
        $status = (string) ($body['status'] ?? 'confirmed');
        if (!in_array($status, $allowedStatuses, true)) {
            $status = 'confirmed';
        }

        $date = trim((string) ($body['appointment_date'] ?? ''));
        $time = trim((string) ($body['start_time'] ?? ''));
        $duration = max(10, (int) ($body['duration_minutes'] ?? 60));
        $totalPrice = (float) ($body['total_price'] ?? 0);
        $notes = trim((string) ($body['notes'] ?? ''));
        $servicesSummary = trim((string) ($body['services_summary'] ?? ''));
        $servicesJson = isset($body['services']) && is_array($body['services'])
            ? json_encode($body['services'], JSON_UNESCAPED_UNICODE)
            : null;

        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}$/', $time)) {
            gbs_json_error('Data o orario non validi.', 422);
        }

        if ($servicesJson !== null) {
            $upd = $pdo->prepare(
                'UPDATE appointments
                 SET appointment_date = ?, start_time = ?, duration_minutes = ?, services_json = ?, services_summary = ?, total_price = ?, status = ?, notes = ?
                 WHERE id = ?'
            );
            $upd->execute([
                $date,
                $time . ':00',
                $duration,
                $servicesJson,
                $servicesSummary !== '' ? $servicesSummary : 'Trattamento personalizzato',
                $totalPrice,
                $status,
                $notes !== '' ? $notes : null,
                $id,
            ]);
        } else {
            $upd = $pdo->prepare(
                'UPDATE appointments
                 SET appointment_date = ?, start_time = ?, duration_minutes = ?, services_summary = ?, total_price = ?, status = ?, notes = ?
                 WHERE id = ?'
            );
            $upd->execute([
                $date,
                $time . ':00',
                $duration,
                $servicesSummary !== '' ? $servicesSummary : 'Trattamento personalizzato',
                $totalPrice,
                $status,
                $notes !== '' ? $notes : null,
                $id,
            ]);
        }

        gbs_json_response(['ok' => true, 'updated_id' => $id]);
    }

    // Create manual appointment from Admin Dashboard
    $clientId = (int) ($body['client_id'] ?? 0);
    $clientName = trim((string) ($body['client_name'] ?? ''));
    $clientPhone = trim((string) ($body['client_phone'] ?? ''));
    $clientEmail = trim((string) ($body['client_email'] ?? ''));
    $privacyAccepted = !empty($body['privacy_accepted']) ? 1 : 0;

    $date = trim((string) ($body['appointment_date'] ?? ''));
    $time = trim((string) ($body['start_time'] ?? ''));
    $duration = max(10, (int) ($body['duration_minutes'] ?? 60));
    $services = isset($body['services']) && is_array($body['services']) ? $body['services'] : [];
    $servicesSummary = trim((string) ($body['services_summary'] ?? ''));
    $totalPrice = (float) ($body['total_price'] ?? 0);
    $status = (string) ($body['status'] ?? 'confirmed');
    $mode = ($body['mode'] ?? 'booking') === 'voucher' ? 'voucher' : 'booking';
    $paymentMethod = trim((string) ($body['payment_method'] ?? 'studio'));
    $notes = trim((string) ($body['notes'] ?? ''));

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}$/', $time)) {
        gbs_json_error('Inserisci una data e un orario validi.', 422);
    }

    if (!in_array($status, ['pending', 'confirmed', 'completed', 'cancelled'], true)) {
        $status = 'confirmed';
    }

    $privacyVersion = (string) ($config['privacy_version'] ?? 'v2.0-2026-11');
    $nowStr = date('Y-m-d H:i:s');

    try {
        $pdo->beginTransaction();

        if ($clientId <= 0) {
            if ($clientName === '' || $clientPhone === '') {
                $pdo->rollBack();
                gbs_json_error('Seleziona una cliente esistente oppure inserisci Nome e Telefono della nuova cliente.', 422);
            }
            $phoneNorm = gbs_normalize_phone($clientPhone);
            $find = $pdo->prepare('SELECT id FROM clients WHERE phone_normalized = ? LIMIT 1');
            $find->execute([$phoneNorm]);
            $found = $find->fetch();

            if ($found) {
                $clientId = (int) $found['id'];
            } else {
                $insC = $pdo->prepare(
                    'INSERT INTO clients (full_name, phone, phone_normalized, email, privacy_accepted, privacy_accepted_at, privacy_version)
                     VALUES (?, ?, ?, ?, ?, ?, ?)'
                );
                $insC->execute([
                    $clientName,
                    $clientPhone,
                    $phoneNorm,
                    $clientEmail !== '' ? $clientEmail : null,
                    $privacyAccepted,
                    $privacyAccepted ? $nowStr : null,
                    $privacyVersion,
                ]);
                $clientId = (int) $pdo->lastInsertId();
            }
        }

        if ($servicesSummary === '' && count($services) > 0) {
            $names = array_map(static function ($s) {
                return is_array($s) ? (string) ($s['name'] ?? '') : '';
            }, $services);
            $servicesSummary = implode(' + ', array_filter($names));
        }
        if ($servicesSummary === '') {
            $servicesSummary = 'Appuntamento in Studio';
        }

        $bookingCode = gbs_generate_booking_code($pdo);
        $insA = $pdo->prepare(
            'INSERT INTO appointments
             (booking_code, client_id, appointment_date, start_time, duration_minutes, services_json, services_summary, total_price, mode, payment_method, status, notes, privacy_accepted, privacy_accepted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $insA->execute([
            $bookingCode,
            $clientId,
            $date,
            $time . ':00',
            $duration,
            json_encode($services, JSON_UNESCAPED_UNICODE) ?: '[]',
            mb_substr($servicesSummary, 0, 490),
            $totalPrice,
            $mode,
            $paymentMethod,
            $status,
            $notes !== '' ? $notes : null,
            $privacyAccepted,
            $nowStr,
        ]);
        $newApptId = (int) $pdo->lastInsertId();

        if ($privacyAccepted) {
            $log = $pdo->prepare(
                'INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            $log->execute([
                $clientId,
                $newApptId,
                'studio_manual_consent',
                $privacyVersion,
                $nowStr,
                gbs_hash_ip($config),
                'Admin Dashboard',
            ]);
        }

        $pdo->commit();
        gbs_json_response([
            'ok' => true,
            'id' => $newApptId,
            'booking_code' => $bookingCode,
            'client_id' => $clientId,
        ], 201);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        gbs_json_error('Impossibile creare l\'appuntamento.', 500);
    }
}

gbs_json_error('Metodo non consentito.', 405);

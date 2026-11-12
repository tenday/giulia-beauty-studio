<?php
/**
 * GIULIA BEAUTY STUDIO — Public Booking & GDPR Consent Submission
 * POST JSON -> Upserts Client in MySQL, Inserts Appointment, Logs GDPR Consent
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

$config = gbs_load_config();
gbs_apply_cors($config);
$pdo = gbs_get_pdo($config);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    gbs_json_error('Metodo non consentito.', 405);
}

$body = gbs_read_json_body();

$mode = ($body['mode'] ?? 'booking') === 'voucher' ? 'voucher' : 'booking';
$clientName = trim((string) ($body['client_name'] ?? ''));
$clientPhoneRaw = trim((string) ($body['client_phone'] ?? ''));
$clientEmail = trim((string) ($body['client_email'] ?? ''));
$notes = trim((string) ($body['notes'] ?? ''));
$paymentMethod = trim((string) ($body['payment_method'] ?? 'studio'));
$privacyAccepted = !empty($body['privacy_accepted']);
$marketingConsent = !empty($body['marketing_consent']) ? 1 : 0;

$services = $body['services'] ?? [];
$totalPrice = (float) ($body['total_price'] ?? 0);
$durationMinutes = max(0, (int) ($body['duration_minutes'] ?? 0));
$appointmentDate = trim((string) ($body['appointment_date'] ?? date('Y-m-d')));
$startTime = trim((string) ($body['start_time'] ?? '11:00'));

if (!$privacyAccepted) {
    gbs_json_error('È obbligatorio accettare l\'Informativa Privacy (GDPR) e i Termini e Condizioni.', 422, 'PRIVACY_REQUIRED');
}

if ($clientName === '' || mb_strlen($clientName) < 2) {
    gbs_json_error('Inserisci nome e cognome.', 422, 'NAME_REQUIRED');
}

$phoneNormalized = gbs_normalize_phone($clientPhoneRaw);
if ($phoneNormalized === '' || strlen(preg_replace('/\D/', '', $phoneNormalized)) < 7) {
    gbs_json_error('Inserisci un numero di telefono / WhatsApp valido.', 422, 'PHONE_REQUIRED');
}

if (!is_array($services) || count($services) === 0) {
    gbs_json_error('Seleziona almeno un trattamento o una Gift Card.', 422, 'SERVICES_REQUIRED');
}

if ($mode === 'booking') {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $appointmentDate)) {
        gbs_json_error('Data appuntamento non valida.', 422);
    }
    if (gbs_is_closed_day($appointmentDate)) {
        gbs_json_error('Il Martedì e la Domenica lo studio è chiuso. Seleziona un altro giorno.', 422, 'CLOSED_DAY');
    }
    if (!preg_match('/^\d{2}:\d{2}$/', $startTime)) {
        gbs_json_error('Orario non valido.', 422);
    }
    if ($durationMinutes < 15) {
        $durationMinutes = 30;
    }
} else {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $appointmentDate)) {
        $appointmentDate = date('Y-m-d');
    }
    if (!preg_match('/^\d{2}:\d{2}$/', $startTime)) {
        $startTime = '09:30';
    }
}

$serviceNames = [];
foreach ($services as $svc) {
    if (is_array($svc) && !empty($svc['name'])) {
        $serviceNames[] = (string) $svc['name'];
    }
}
$servicesSummary = mb_substr(implode(' + ', $serviceNames), 0, 490);
$servicesJson = json_encode($services, JSON_UNESCAPED_UNICODE);
$privacyVersion = (string) ($config['privacy_version'] ?? 'v2.0-2026-11');
$nowStr = date('Y-m-d H:i:s');

try {
    $pdo->beginTransaction();

    // Prevent concurrent double-booking for the same time range
    if ($mode === 'booking') {
        $lockStmt = $pdo->prepare(
            "SELECT TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes
             FROM appointments
             WHERE appointment_date = ?
               AND mode = 'booking'
               AND status IN ('pending', 'confirmed')
             FOR UPDATE"
        );
        $lockStmt->execute([$appointmentDate]);
        $existing = $lockStmt->fetchAll();

        if (gbs_slot_overlaps_booked($startTime, $durationMinutes, $existing)) {
            $pdo->rollBack();
            gbs_json_error(
                'Spiacenti, la fascia oraria selezionata è appena stata prenotata. Scegli un altro orario disponibile.',
                409,
                'SLOT_OCCUPIED'
            );
        }
    }

    // Upsert Client by normalized phone
    $findClient = $pdo->prepare('SELECT id, email FROM clients WHERE phone_normalized = ? LIMIT 1');
    $findClient->execute([$phoneNormalized]);
    $existingClient = $findClient->fetch();

    if ($existingClient) {
        $clientId = (int) $existingClient['id'];
        $finalEmail = $clientEmail !== '' ? $clientEmail : ($existingClient['email'] ?? null);
        $updClient = $pdo->prepare(
            'UPDATE clients
             SET full_name = ?, phone = ?, email = ?, privacy_accepted = 1, privacy_accepted_at = ?, privacy_version = ?, marketing_consent = GREATEST(marketing_consent, ?)
             WHERE id = ?'
        );
        $updClient->execute([$clientName, $clientPhoneRaw, $finalEmail, $nowStr, $privacyVersion, $marketingConsent, $clientId]);
    } else {
        $insClient = $pdo->prepare(
            'INSERT INTO clients (full_name, phone, phone_normalized, email, privacy_accepted, privacy_accepted_at, privacy_version, marketing_consent)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?)'
        );
        $insClient->execute([
            $clientName,
            $clientPhoneRaw,
            $phoneNormalized,
            $clientEmail !== '' ? $clientEmail : null,
            $nowStr,
            $privacyVersion,
            $marketingConsent,
        ]);
        $clientId = (int) $pdo->lastInsertId();
    }

    $bookingCode = gbs_generate_booking_code($pdo);
    $insAppt = $pdo->prepare(
        'INSERT INTO appointments
         (booking_code, client_id, appointment_date, start_time, duration_minutes, services_json, services_summary, total_price, mode, payment_method, status, notes, privacy_accepted, privacy_accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)'
    );
    $insAppt->execute([
        $bookingCode,
        $clientId,
        $appointmentDate,
        $startTime . ':00',
        $durationMinutes,
        $servicesJson !== false ? $servicesJson : '[]',
        $servicesSummary,
        $totalPrice,
        $mode,
        $paymentMethod,
        'pending',
        $notes !== '' ? $notes : null,
        $nowStr,
    ]);
    $appointmentId = (int) $pdo->lastInsertId();

    // Immutable GDPR Consent Log
    $ipHash = gbs_hash_ip($config);
    $userAgent = mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250);
    $logStmt = $pdo->prepare(
        'INSERT INTO privacy_logs (client_id, appointment_id, consent_type, consent_version, accepted_at, ip_hash, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $logStmt->execute([$clientId, $appointmentId, 'privacy_terms', $privacyVersion, $nowStr, $ipHash, $userAgent]);

    $pdo->commit();

    gbs_json_response([
        'ok' => true,
        'booking_code' => $bookingCode,
        'appointment_id' => $appointmentId,
        'client_id' => $clientId,
        'privacy_accepted_at' => $nowStr,
        'privacy_version' => $privacyVersion,
    ], 201);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    gbs_json_error('Errore durante il salvataggio della prenotazione.', 500, 'SAVE_FAILED');
}

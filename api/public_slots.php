<?php
/**
 * GIULIA BEAUTY STUDIO — Public Availability Check (No PII Exposed)
 * GET ?date=YYYY-MM-DD&duration=60
 */

declare(strict_types=1);

require_once __DIR__ . '/db.php';

$config = gbs_load_config();
gbs_apply_cors($config);
$pdo = gbs_get_pdo($config);

$dateStr = trim((string) ($_GET['date'] ?? ''));
$requestedDuration = max(15, min(300, (int) ($_GET['duration'] ?? 60)));

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateStr)) {
    gbs_json_error('Formato data non valido (atteso YYYY-MM-DD).', 400);
}

$closed = gbs_is_closed_day($dateStr);
$candidateSlots = ['09:30', '11:00', '14:30', '16:00', '17:30', '18:30'];

if ($closed) {
    gbs_json_response([
        'ok' => true,
        'date' => $dateStr,
        'closed' => true,
        'booked_slots' => $candidateSlots,
    ]);
}

$stmt = $pdo->prepare(
    "SELECT TIME_FORMAT(start_time, '%H:%i') AS start_time, duration_minutes
     FROM appointments
     WHERE appointment_date = ?
       AND mode = 'booking'
       AND status IN ('pending', 'confirmed')"
);
$stmt->execute([$dateStr]);
$rows = $stmt->fetchAll();

$bookedSlots = [];
foreach ($candidateSlots as $slot) {
    if (gbs_slot_overlaps_booked($slot, $requestedDuration, $rows)) {
        $bookedSlots[] = $slot;
    }
}

gbs_json_response([
    'ok' => true,
    'date' => $dateStr,
    'closed' => false,
    'booked_slots' => $bookedSlots,
]);

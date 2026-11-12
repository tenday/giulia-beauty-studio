<?php
/**
 * GIULIA BEAUTY STUDIO — CONFIGURAZIONE CPANEL & MYSQL
 *
 * ISTRUZIONI:
 * 1. Duplica questo file chiamandolo `config.php` nella stessa cartella `api/`.
 * 2. Inserisci i dati del tuo database MySQL creato su cPanel (cPanel > Database MySQL).
 * 3. NON caricare `config.php` su repository GitHub pubblici (è già escluso in .gitignore).
 */

return [
    // Host MySQL su cPanel (quasi sempre 'localhost')
    'db_host' => 'localhost',
    'db_port' => 3306,

    // Nome completo del database su cPanel (es. 'cpaneluser_giuliabeauty')
    'db_name' => 'SOSTITUISCI_NOME_DATABASE',

    // Utente MySQL su cPanel (es. 'cpaneluser_giulia_admin')
    'db_user' => 'SOSTITUISCI_UTENTE_DB',

    // Password dell'utente MySQL
    'db_pass' => 'SOSTITUISCI_PASSWORD_DB',

    // Versione corrente dell'informativa privacy (usata nei log GDPR)
    'privacy_version' => 'v2.0-2026-11',

    // Stringa segreta per anonimizzare gli indirizzi IP nei log GDPR (cambia con caratteri casuali)
    'ip_salt' => 'cambia-questa-stringa-segreta-giulia-beauty-2026',

    // Domini autorizzati per chiamate CORS (lascia ['*'] se il sito è sullo stesso dominio cPanel,
    // oppure aggiungi es. 'https://tenday.github.io' se vuoi chiamare le API da GitHub Pages)
    'allowed_origins' => [
        'https://tenday.github.io',
    ],

    // Fuso orario studio
    'timezone' => 'Europe/Rome',
];

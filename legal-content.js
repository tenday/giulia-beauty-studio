/**
 * GIULIA BEAUTY STUDIO — Canonical Legal Texts (Single Source of Truth)
 * Shared by the public storefront (index.html) and the OTP signature page (privacy-sign.html).
 */
(function (globalScope) {
  'use strict';

  const GBS_LEGAL_DOCS = Object.freeze({
    privacy: `
      <h4>Informativa sul Trattamento dei Dati Personali (Art. 13 Regolamento UE 2016/679 – GDPR)</h4>
      <p>
        La presente informativa descrive le modalità di gestione dei dati personali degli utenti che consultano il sito web e utilizzano il sistema di prenotazione e richiesta servizi di <strong>Giulia Beauty Studio</strong>.
      </p>

      <h5>1. Titolare del Trattamento</h5>
      <p>
        Il Titolare del Trattamento è <strong>Giulia Beauty Studio — Nails &amp; Makeup</strong>, con sede operativa in <strong>Via Principe Amedeo, 17 — 24040 Verdellino (BG)</strong>.<br />
        Contatto telefonico / WhatsApp: <strong>+39 331 504 5135</strong> • Profilo Instagram ufficiale: <strong>@giuliabeautystudio_bergamo</strong>.
      </p>

      <h5>2. Tipologia di Dati Trattati e Database Gestionale Proprietario</h5>
      <p>
        Attraverso il sistema di prenotazione e richiesta trattamenti (<em>Beauty Bag</em>) o in sede presso lo studio, raccogliamo esclusivamente i dati strettamente necessari:
      </p>
      <ul>
        <li><strong>Dati anagrafici e di contatto:</strong> nome, cognome, numero di telefono/WhatsApp ed eventuale indirizzo email.</li>
        <li><strong>Dati relativi all’appuntamento e ai servizi:</strong> data, orario, trattamenti scelti, eventuale dedica Gift Card e storico delle sedute.</li>
        <li><strong>Note tecniche e di sicurezza estetica:</strong> eventuali allergie, sensibilità cutanee/oculari o preferenze tecniche (es. forma unghie, formula colore) segnalate dalla cliente per garantire l’esecuzione sicura dei trattamenti.</li>
        <li><strong>Registro del consenso (Audit Log GDPR):</strong> data, ora, versione dell’informativa accettata e hash anonimizzato dell’indirizzo IP a tutela della trasparenza e conformità normativa.</li>
      </ul>

      <h5>3. Finalità, Base Giuridica e Conservazione</h5>
      <ul>
        <li><strong>Gestione agenda, prenotazioni e scheda cliente:</strong> esecuzione di misure precontrattuali e contrattuali richieste dall’interessato (Art. 6, par. 1, lett. b GDPR).</li>
        <li><strong>Tutela della salute e sicurezza nei trattamenti estetici:</strong> gestione delle note su allergie/sensibilità fornite volontariamente dalla cliente prima della seduta.</li>
        <li><strong>Comunicazioni di servizio e promemoria appuntamenti:</strong> conferme, modifiche o disdette tramite telefono o WhatsApp.</li>
        <li><strong>Adempimenti fiscali e di legge:</strong> connessi all’erogazione dei servizi (Art. 6, par. 1, lett. c GDPR).</li>
      </ul>
      <p>
        I dati sono custoditi nel database proprietario protetto di <strong>Giulia Beauty Studio</strong> su infrastruttura server dedicata, accessibile esclusivamente al personale autorizzato tramite credenziali cifrate. I dati non vengono mai venduti né ceduti a terzi per finalità pubblicitarie e sono conservati per il tempo necessario alla gestione del rapporto con la cliente e agli obblighi fiscali di legge.
      </p>

      <h5>4. Diritti dell’Interessato (Artt. 15–22 GDPR)</h5>
      <p>
        L’interessato può esercitare in ogni momento il diritto di accesso ai propri dati, di rettifica, di portabilità (esportazione scheda) o di cancellazione definitiva (<strong>Diritto all’Oblio</strong>), contattando <strong>Giulia Beauty Studio</strong> in Via Principe Amedeo, 17 – Verdellino (BG) o al numero <strong>+39 331 504 5135</strong>. È sempre fatto salvo il diritto di reclamo al Garante per la Protezione dei Dati Personali (<em>www.garanteprivacy.it</em>).
      </p>
    `.trim(),

    terms: `
      <h4>Termini e Condizioni di Prenotazione, Vendita Servizi &amp; Gift Card</h4>
      <p>
        L’utilizzo del sito e l’invio di una richiesta di prenotazione o acquisto comportano l’accettazione integrale dei seguenti Termini e Condizioni operativi di <strong>Giulia Beauty Studio</strong>.
      </p>

      <h5>1. Listino Prezzi e Trattamenti</h5>
      <p>
        Tutti i prezzi esposti nel listino digitale corrispondono al listino ufficiale di <strong>Giulia Beauty Studio</strong>, sono espressi in Euro (€) e si intendono comprensivi di imposte. La durata indicata accanto a ciascun trattamento è una stima media che può variare lievemente in base alle esigenze specifiche della cliente.
      </p>

      <h5>2. Prenotazione Appuntamenti e Giorni di Chiusura</h5>
      <p>
        Le richieste di appuntamento effettuate tramite il sito o WhatsApp (<code>+39 331 504 5135</code>) s’intendono perfezionate al momento della conferma da parte dello studio.<br />
        Lo studio osserva la chiusura settimanale nei giorni di <strong>Martedì</strong> e <strong>Domenica</strong>.
      </p>

      <h5>3. Politica di Disdetta, Spostamento e Ritardi</h5>
      <ul>
        <li><strong>Disdetta o Spostamento:</strong> Qualora non fosse possibile presentarsi all’appuntamento, è richiesto un preavviso di almeno <strong>24 ore</strong> contattando il numero <strong>+39 331 504 5135</strong>.</li>
        <li><strong>Puntualità:</strong> Si prega di presentarsi puntuali. In caso di ritardo superiore a <strong>15 minuti</strong> senza preavviso, lo studio si riserva il diritto di adattare il trattamento al tempo residuo disponibile o di riprogrammare la seduta per garantire la puntualità alle clienti successive.</li>
      </ul>

      <h5>4. Regolamento Gift Card e Voucher Regalo</h5>
      <ul>
        <li>Le <strong>Gift Card Giulia Beauty Studio</strong> hanno validità di <strong>12 mesi</strong> dalla data di emissione/acquisto.</li>
        <li>Possono essere utilizzate per qualsiasi trattamento estetico presente nel listino (Nails, Ciglia e Sopracciglia, Epilazione, Viso, Make Up) presso la sede di Via Principe Amedeo 17, Verdellino (BG).</li>
        <li>Le Gift Card non sono rimborsabili, non sono convertibili in denaro contante e non danno diritto a resto in contanti. Qualora l’importo del trattamento scelto sia inferiore al valore della Gift Card, il credito residuo resterà utilizzabile per un appuntamento successivo entro la data di scadenza.</li>
      </ul>

      <h5>5. Segnalazione di Allergie, Sensibilità o Condizioni Specifiche</h5>
      <p>
        Prima dell’inizio di qualsiasi trattamento (in particolare laminazione ciglia/sopracciglia, extension ciglia, henné, resine epilatorie, gel/acrilico e prodotti cosmetici viso/make up), è responsabilità della cliente informare l’operatrice di eventuali allergie note, ipersensibilità cutanee o oculari, assunzione di farmaci fotosensibilizzanti o stato di gravidanza.
      </p>
    `.trim(),

    cookies: `
      <h4>Informativa sull’uso dei Cookie e Tecnologie Simili</h4>
      <p>
        Questo sito web è progettato nel pieno rispetto della riservatezza dell’utente (<em>Privacy by Design</em>).
      </p>

      <h5>1. Cookie Tecnici e Archiviazione Locale (LocalStorage)</h5>
      <p>
        Il sito utilizza esclusivamente strumenti tecnici strettamente necessari al funzionamento dell’interfaccia (quali la memorizzazione locale della preferenza espressa sul banner informativo privacy/cookie tramite <code>localStorage</code>). Non vengono installati cookie di profilazione proprietari né sistemi di tracciamento pubblicitario o analytics invasivi.
      </p>

      <h5>2. Servizi di Terze Parti Incorporati</h5>
      <ul>
        <li><strong>Google Maps (Widget Mappa Interattiva):</strong> Nella sezione <em>“Ti Aspettiamo in Studio”</em> è incorporata la mappa di Google Maps per agevolare la localizzazione della sede in Via Principe Amedeo, 17 – Verdellino (BG). L’interazione con la mappa può comportare l’invio di richieste ai server di Google Ireland Limited secondo la relativa <a href="https://policies.google.com/privacy?hl=it" target="_blank" rel="noopener">Privacy Policy di Google</a>.</li>
        <li><strong>Google Fonts:</strong> Utilizzato per il caricamento dei caratteri tipografici editoriali (<em>Cormorant Garamond</em> e <em>Montserrat</em>).</li>
        <li><strong>Collegamenti Esterni (WhatsApp / Instagram):</strong> I pulsanti verso WhatsApp (Meta Platforms Ireland Ltd.) e Instagram aprono le rispettive piattaforme solo su azione volontaria dell’utente.</li>
      </ul>

      <h5>3. Gestione delle Preferenze</h5>
      <p>
        L’utente può in qualsiasi momento modificare le proprie preferenze sui cookie tramite le impostazioni del proprio browser o cliccando sul pulsante sottostante per ripristinare il banner di consenso.
      </p>
    `.trim(),
  });

  /**
   * Populates legal tab panels from GBS_LEGAL_DOCS and wires tab-switching buttons.
   * Returns a selectTab(tabKey) function.
   */
  function initLegalPanels({ tabButtons = [], panels = {}, scrollContainer = null, onSelect = null } = {}) {
    Object.entries(panels).forEach(([key, panelEl]) => {
      if (panelEl && GBS_LEGAL_DOCS[key]) {
        panelEl.innerHTML = GBS_LEGAL_DOCS[key];
      }
    });

    const buttons = Array.from(tabButtons || []);
    function selectTab(tabKey = 'privacy') {
      const targetKey = GBS_LEGAL_DOCS[tabKey] ? tabKey : 'privacy';
      buttons.forEach((btn) => {
        const isMatch = btn.dataset.legalTab === targetKey;
        btn.classList.toggle('active', isMatch);
        btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
      Object.entries(panels).forEach(([key, panelEl]) => {
        if (panelEl) panelEl.classList.toggle('active', key === targetKey);
      });
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      } else if (panels[targetKey]) {
        panels[targetKey].scrollTop = 0;
      }
      if (typeof onSelect === 'function') {
        onSelect(targetKey);
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => selectTab(btn.dataset.legalTab));
    });

    selectTab('privacy');
    return selectTab;
  }

  globalScope.GBS_LEGAL_DOCS = GBS_LEGAL_DOCS;
  globalScope.initLegalPanels = initLegalPanels;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GBS_LEGAL_DOCS, initLegalPanels };
  }
})(typeof window !== 'undefined' ? window : globalThis);

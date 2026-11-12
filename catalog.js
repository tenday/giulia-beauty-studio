/**
 * GIULIA BEAUTY STUDIO — Shared Official Service Catalog (43 Treatments)
 * Used by both Public Boutique (app.js) and Admin Agenda/CRM (admin.js)
 */

window.STUDIO_CATALOG = [
  {
    id: 'nails',
    column: 'left',
    title: 'NAILS',
    motto: 'MANI E PIEDI SEMPRE PERFETTI',
    subgroups: [
      {
        label: 'Manicure Classica & Spa',
        items: [
          { id: 'nails-1', name: 'Manicure', price: 12, duration: 30, desc: 'Cura delle cuticole, limatura armoniosa e idratazione profonda.' },
          { id: 'nails-2', name: 'Manicure con smalto', price: 15, duration: 40, desc: 'Manicure estetica completa con applicazione smalto classico brillante.' },
          { id: 'nails-3', name: 'Manicure spa', price: 20, duration: 50, desc: 'Rituale esfoliante, maschera nutriente e massaggio distensivo mani.' }
        ]
      },
      {
        label: 'Pedicure Estetica, Spa & Profonda',
        items: [
          { id: 'nails-4', name: 'Pedicure', price: 22, duration: 40, desc: 'Riordino estetico completo dell’unghia e freschezza immediata.' },
          { id: 'nails-5', name: 'Pedicure con smalto', price: 25, duration: 45, desc: 'Pedicure accurata con stesura smalto classico a scelta.' },
          { id: 'nails-6', name: 'Pedicure spa', price: 28, duration: 55, desc: 'Bagno aromatico, scrub levigante, impacco idratante e massaggio.' },
          { id: 'nails-7', name: 'Pedicure spa + smalto', price: 30, duration: 60, desc: 'Percorso benessere Spa completo per i piedi con finitura smalto.' },
          { id: 'nails-8', name: 'Pedicure estetica + semipermanente', price: 34, duration: 60, desc: 'Piedi curati e colore impeccabile a lunga tenuta.' },
          { id: 'nails-9', name: 'Pedicure profonda + semipermanente', price: 39, duration: 75, desc: 'Trattamento intensivo callosità con stesura semipermanente.' },
          { id: 'nails-10', name: 'Pedicure profonda', price: 25, duration: 50, desc: 'Cura intensiva e specifica per il benessere totale del piede.' },
          { id: 'nails-11', name: 'Pedicure profonda + smalto', price: 28, duration: 60, desc: 'Trattamento profondo abbinato a smalto classico luminoso.' }
        ]
      },
      {
        label: 'Semipermanente, Gel & Ricostruzione',
        items: [
          { id: 'nails-12', name: 'Manicure + semipermanente', price: 28, duration: 60, desc: 'Manicure sartoriale e stesura smalto semipermanente ultra-glossy.' },
          { id: 'nails-13', name: 'Manicure + semipermanente rinforzato', price: 33, duration: 70, desc: 'Base strutturata rinforzata per maggiore resistenza e bombatura naturale.' },
          { id: 'nails-14', name: 'Copertura in gel', price: 35, duration: 75, desc: 'Rinforzo in gel su unghia naturale per una tenuta impeccabile.' },
          { id: 'nails-15', name: 'Ritocco (unghie semplici)', price: 38, duration: 80, desc: 'Refill periodico in gel con finitura monocromatica o nude elegante.' },
          { id: 'nails-16', name: 'Ritocco con lavorazioni extra', price: 40, duration: 90, desc: 'Refill in gel con french, babyboomer o nail art ricercate.' },
          { id: 'nails-17', name: 'Ricostruzione', price: 45, duration: 105, desc: 'Allungamento con cartina e architettura su misura in gel.' },
          { id: 'nails-18', name: 'Ricostruzione lunga', price: 50, duration: 120, desc: 'Allungamento importante dal design slanciato e strutturato.' }
        ]
      }
    ]
  },
  {
    id: 'lashes',
    column: 'left',
    title: 'CIGLIA E SOPRACCIGLIA',
    motto: 'UNO SGUARDO CHE VALORIZZA LA TUA BELLEZZA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'lashes-1', name: 'Laminazione ciglia', price: 45, duration: 60, desc: 'Curvatura naturale, tintura e trattamento alla cheratina nutriente.' },
          { id: 'lashes-2', name: 'Laminazione sopracciglia', price: 35, duration: 45, desc: 'Definizione, stiratura e fissaggio per sopracciglia folte e ordinate.' },
          { id: 'lashes-3', name: 'Henné sopracciglia', price: 25, duration: 40, desc: 'Bio-tatuaggio naturale con effetto riempitivo su pelo e pelle.' },
          { id: 'lashes-4', name: 'Laminazione ciglia coreana', price: 50, duration: 70, desc: 'Tecnica avanzata coreana per un sollevamento panoramico ultra-delicato.' },
          { id: 'lashes-5', name: 'Extension ciglia', price: 80, duration: 110, desc: 'Applicazione sartoriale per uno sguardo intenso, magnetico e personalizzato.' },
          { id: 'lashes-6', name: 'Mappatura, forma e definizione sopracciglia + tinta', price: 30, duration: 40, desc: 'Studio dell’arcata sopraccigliare, epilazione di precisione e tintura.' }
        ]
      }
    ]
  },
  {
    id: 'epilazione',
    column: 'right',
    title: 'EPILAZIONE',
    motto: 'PELLE LISCIA, OGNI GIORNO',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'epi-1', name: 'Gamba intera', price: 22, duration: 35, desc: 'Epilazione completa gambe per una pelle liscia e vellutata.' },
          { id: 'epi-2', name: 'Mezza gamba', price: 15, duration: 25, desc: 'Epilazione accurata polpaccio e ginocchio.' },
          { id: 'epi-3', name: 'Inguine parziale', price: 10, duration: 15, desc: 'Definizione delicata della linea bikini.' },
          { id: 'epi-4', name: 'Inguine totale', price: 15, duration: 25, desc: 'Epilazione integrale eseguita con massima cura.' },
          { id: 'epi-5', name: 'Ascelle', price: 5, duration: 10, desc: 'Epilazione rapida e delicata per una freschezza prolungata.' },
          { id: 'epi-6', name: 'Braccia', price: 12, duration: 20, desc: 'Epilazione completa braccia con emulsione lenitiva finale.' },
          { id: 'epi-7', name: 'Baffetti', price: 4, duration: 10, desc: 'Rimozione delicata della peluria del labbro superiore.' },
          { id: 'epi-8', name: 'Sopracciglia', price: 6, duration: 15, desc: 'Pulizia e riordino della linea naturale delle sopracciglia.' }
        ]
      }
    ]
  },
  {
    id: 'brasiliana',
    column: 'right',
    title: 'EPILAZIONE CON BRASILIANA',
    motto: 'DELICATEZZA ED EFFICACIA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'bras-1', name: 'Inguine parziale', price: 13, duration: 20, desc: 'Cera brasiliana tiepida che ingloba il pelo senza aderire alla pelle.' },
          { id: 'bras-2', name: 'Inguine totale', price: 18, duration: 30, desc: 'Trattamento brasiliano integrale ultra-confortevole e duraturo.' },
          { id: 'bras-3', name: 'Ascelle', price: 8, duration: 15, desc: 'Ideale per pelli sensibili, riduce gli arrossamenti e ritarda la ricrescita.' },
          { id: 'bras-4', name: 'Baffetti + sopracciglia', price: 13, duration: 20, desc: 'Combo viso ultra-delicata con resina brasiliana specifica.' },
          { id: 'bras-5', name: 'Resina naso', price: 6, duration: 10, desc: 'Epilazione sicura, rapida e indolore con resina elastica.' },
          { id: 'bras-6', name: 'Resina orecchie', price: 6, duration: 10, desc: 'Finitura precisa e delicata con resina tiepida.' }
        ]
      }
    ]
  },
  {
    id: 'viso',
    column: 'right',
    title: 'VISO',
    motto: 'TRATTAMENTI SU MISURA PER UNA PELLE PIÙ LUMINOSA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'viso-1', name: 'Pulizia viso', price: 45, duration: 60, desc: 'Detersione profonda, esfoliazione, purificazione e maschera illuminante.' },
          { id: 'viso-2', name: 'Trattamento viso relax', price: 40, duration: 50, desc: 'Massaggio olistico viso-collo-décolleté con attivi idratanti e distensivi.' }
        ]
      }
    ]
  },
  {
    id: 'makeup',
    column: 'right',
    title: 'MAKE UP',
    motto: 'PER OGNI OCCASIONE, LA TUA BELLEZZA UNICA',
    subgroups: [
      {
        label: null,
        items: [
          { id: 'makeup-1', name: 'Make up sposa', price: 150, duration: 120, desc: 'Studio morfologico, prova dedicata e trucco sposa ad altissima tenuta.' },
          { id: 'makeup-2', name: 'Make up cerimonia', price: 35, duration: 50, desc: 'Trucco sofisticato e fotografico per eventi speciali, gala e cerimonie.' },
          { id: 'makeup-3', name: 'Make up giorno', price: 30, duration: 40, desc: 'Make up luminoso e raffinato per valorizzare i tuoi lineamenti.' }
        ]
      }
    ]
  }
];

window.SERVICE_MAP = new Map();
window.STUDIO_CATALOG.forEach((cat) => {
  cat.subgroups.forEach((sg) => {
    sg.items.forEach((item) => {
      window.SERVICE_MAP.set(item.id, { ...item, categoryId: cat.id, categoryTitle: cat.title });
    });
  });
});

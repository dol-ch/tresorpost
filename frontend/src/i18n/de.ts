/** German is the source of truth for keys. */
export const de = {
  "nav.send": "Senden",
  "nav.how": "So funktioniert’s",
  "nav.privacy": "Datenschutz",
  "nav.primary": "Hauptnavigation",

  "hero.title": "Geheimnis senden. Einmal lesen, dann ist es weg.",
  "hero.lead":
    "Auf deinem Gerät verschlüsselt. Der Schlüssel bleibt im Link — nie auf dem Server.",

  "footer.hosted": "Kein Tracking · gehostet in der Schweiz",
  "footer.source": "Quellcode",
  "footer.madeIn": "Mit Liebe in Luzern von",

  "theme.toggle": "Darstellung umschalten",
  "theme.toDark": "Dunkle Darstellung",
  "theme.toLight": "Helle Darstellung",

  "seo.homeTitle": "Tresorpost — quantensichere Dateiübertragung, die sich selbst vergisst",
  "seo.homeDesc":
    "Quantensichere, Ende-zu-Ende-verschlüsselte Übertragung für Text, Bilder, Video und Dateien. 256-Bit-Verschlüsselung im Browser, gehostet in der Schweiz, ohne Konten und ohne Tracking.",
  "seo.faqTitle": "So funktioniert’s — Tresorpost",
  "seo.faqDesc":
    "Wie Tresorpost Geheimnisse im Browser verschlüsselt, den Schlüssel im Link behält und den Ciphertext nach dem Lesen löscht. Gehostet in der Schweiz, kein Tracking.",
  "seo.privacyTitle": "Datenschutz — Tresorpost",
  "seo.privacyDesc":
    "Tresorpost speichert nur Ciphertext. Keine Schlüssel, keine Konten, kein Tracking. App und Object Storage in Zürich, Schweiz.",
  "seo.noindexTitle": "Tresorpost — verschlüsselte Übertragung",

  "create.placeholder": "Nachricht schreiben oder Datei ablegen (bis {cap})…",
  "create.ariaWrite": "Nachricht schreiben",
  "create.attach": "Datei anhängen",
  "create.attachAria": "Datei anhängen, bis {cap}",
  "create.upTo": "bis {cap}",
  "create.replace": "Datei ersetzen",
  "create.sentAsText": "Als Text",
  "create.sentAs": "Als {kind}",
  "create.kindImage": "Bild",
  "create.kindVideo": "Video",
  "create.kindFile": "Datei",
  "create.encryptedInBrowser": "im Browser verschlüsselt",
  "create.removeFile": "Datei entfernen",
  "create.oneThing":
    "Eine Notiz enthält eine Sache. Text löschen, sonst geht er verloren.",
  "create.selfDestruct": "Selbstzerstörung nach",
  "create.options": "Optionen",
  "create.optDefaults": "Standard",
  "create.optMax1": "max. 1 Öffnung",
  "create.optMaxN": "max. {n} Öffnungen",
  "create.optDeleteLink": "Lösch-Link",
  "create.optRecipientDelete": "Empfänger kann löschen",
  "create.limitOpens": "Anzahl Öffnungen begrenzen",
  "create.keepDeleteLink": "Privaten Lösch-Link behalten",
  "create.recipientDelete": "Empfänger kann löschen",
  "create.createError": "Link konnte nicht erstellt werden",
  "create.encrypting": "Verschlüsseln…",
  "create.uploading": "Hochladen…",
  "create.createLink": "Verschlüsselten Link erstellen",
  "create.cancel": "Abbrechen",
  "create.writeFirst": "Schreib etwas, bevor du einen Link erstellst.",
  "create.chooseFile": "Zuerst eine Datei wählen.",
  "create.tooLarge": "Datei zu gross ({size}). Maximum ist {cap}.",
  "create.networkFail":
    "Server nicht erreichbar. Bei einem grossen Bild kann der Reverse-Proxy den Body ablehnen — S3 konfigurieren oder client_max_body_size erhöhen.",
  "create.progress": "Verschlüsseln & hochladen: {done} / {total} ({pct}%)",
  "create.expiry5min": "5 Min.",
  "create.expiry1hour": "1 Stunde",
  "create.expiry1day": "1 Tag",
  "create.expiry7days": "7 Tage",

  "share.kicker": "Teilen",
  "share.title": "Dein verschlüsselter Link ist bereit",
  "share.lead":
    "Schick ihn, wie du willst — oder lass scannen. Der quantensichere 256-Bit-Schlüssel steht nur nach der # und erreicht den Server nie.",
  "share.qrAlt": "QR-Code für den verschlüsselten Link",
  "share.scan": "Zum Öffnen scannen",
  "share.copy": "Kopieren",
  "share.copied": "Kopiert",
  "share.open": "Öffnen",
  "share.emailKicker": "Link per E-Mail",
  "share.send": "Senden",
  "share.sending": "Senden…",
  "share.sent": "Gesendet.",
  "share.deleteKicker": "Diese Notiz löschen",
  "share.deleteLead":
    "Privat behalten — zerstört den Ciphertext, bevor jemand öffnet.",
  "share.delete": "Löschen",
  "share.another": "Weitere erstellen",

  "view.decrypting": "Entschlüsseln…",
  "view.nothingTitle": "Nichts hier",
  "view.nothingBody":
    "Geöffnet, gelöscht oder abgelaufen. Verschlüsselte Notizen werden auf dem Server endgültig entfernt — keine Kopie, keine Wiederherstellung.",
  "view.createOwn": "Eigene Notiz erstellen",
  "view.destroyedTitle": "Notiz zerstört",
  "view.destroyedBody":
    "Der Ciphertext ist vom Server gewischt. Wer den Link jetzt öffnet, sieht nichts.",
  "view.createAnother": "Weitere Notiz erstellen",
  "view.createNew": "Neues Geheimnis erstellen",
  "view.couldNotOpen": "Konnte nicht geöffnet werden",
  "view.error": "Fehler",
  "view.goHome": "Zur Startseite",
  "view.goneOpens": "Keine Öffnungen mehr — nach dieser Ansicht zerstört",
  "view.moreOpens1": "Noch 1 Öffnung",
  "view.moreOpensN": "Noch {n} Öffnungen",
  "view.decryptFailed":
    "Entschlüsselung fehlgeschlagen. Der Link ist beschädigt oder der Schlüssel falsch.",
  "view.streamFail":
    "Dieser Browser kann {size} nicht auf die Platte streamen. Öffne den Link in Chrome oder Edge (Streaming-Speichern).",
  "view.tooLargeOpen":
    "Diese Datei ist {size} — zu gross für den Browser. Stattdessen herunterladen.",
  "view.download": "Download",
  "view.downloadMd": "Als .md herunterladen",
  "view.decryptedLocal": "Lokal entschlüsselt",
  "view.decryptedInBrowser": "im Browser entschlüsselt",
  "view.readyPlay": "Bereit zum Abspielen",
  "view.downloaded": "Heruntergeladen",
  "view.decryptingDl": "Entschlüsseln & herunterladen",
  "view.decryptView": "Entschlüsseln & anzeigen",
  "view.decryptPlay": "Entschlüsseln & abspielen",
  "view.downloadVideo": "Video herunterladen",
  "view.downloadImage": "Bild herunterladen",
  "view.decryptDownload": "Entschlüsseln & herunterladen",
  "view.more": "Mehr",
  "view.report": "Melden",
  "view.reported": "Gemeldet",
  "view.reportTitle": "Diesen Inhalt melden?",
  "view.reportBody":
    "Das sendet den Link — inklusive Entschlüsselungsschlüssel — an die Betreiber. Sie können Datei oder Notiz öffnen. Nur Missbrauch melden, den sie sehen sollen.",
  "view.reportMsg": "Nachricht (optional)",
  "view.reportWhy": "Warum meldest du das?",
  "view.sendAdmins": "An Betreiber senden",
  "view.deleteForever": "Endgültig löschen?",
  "view.deleteForeverBody":
    "Niemand mit dem Link kann sie danach öffnen. Das lässt sich nicht rückgängig machen.",
  "view.deleting": "Löschen…",
  "view.videoFail":
    "Dieser Browser kann das Video nicht dekodieren (häufig bei AVI und manchen MOV). Datei herunterladen und in einem Player öffnen.",
  "view.selfDestructs": "Selbstzerstörung",
  "view.badge": "Lokal entschlüsselt",
  "copy.code": "Kopieren",
  "copy.copied": "Kopiert",

  "delete.title": "Diese Notiz jetzt zerstören?",
  "delete.body":
    "Das lässt sich nicht rückgängig machen. Empfänger können den Link nicht mehr öffnen.",
  "delete.yes": "Ja, löschen",
  "delete.destroyedTitle": "Notiz zerstört",
  "delete.destroyedBody":
    "Ciphertext ist vom Server entfernt. Wer den Link hat, sieht, dass er nicht mehr verfügbar ist.",
  "delete.cancel": "Abbrechen",

  "faq.title": "So funktioniert’s",
  "faq.lead": "Drei Schritte, kein Konto, nichts Lesbares verlässt dein Gerät.",
  "faq.step1t": "Du schreibst, der Browser verschlüsselt",
  "faq.step1b":
    "Ein zufälliger 256-Bit-Schlüssel entsteht auf deinem Gerät und wird nirgendwohin gesendet. Der Server erhält nur Ciphertext.",
  "faq.step2t": "Der Schlüssel reist im Link",
  "faq.step2b":
    "Alles nach der # bleibt im Browser — nie Teil der Anfrage. Schick den Link über jeden Kanal, dem du schon vertraust.",
  "faq.step3t": "Einmal öffnen, dann weg",
  "faq.step3b":
    "Nach der letzten erlaubten Öffnung oder wenn der Timer abläuft, wird der Ciphertext gelöscht. Nichts wird archiviert.",
  "faq.send": "Geheimnis senden",
  "faq.sizeQ": "Wie gross darf eine Datei sein? Gehen Bilder und Video?",
  "faq.sizeA":
    "Text, Bilder, Video und beliebige Dateien, bis {cap} pro Datei. Textnotizen haben praktisch kein Limit.",

  "privacy.title": "Datenschutz",
  "privacy.lead":
    "Kurz: Der Server hält Ciphertext, den er nicht lesen kann, und vergisst ihn planmässig. Schweizer Speicher, kein Tracking.",
  "privacy.stored": "Auf dem Server",
  "privacy.storedPayload": "Die verschlüsselte Nutzlast",
  "privacy.storedExpiry": "Ablaufzeit und restliche Öffnungen",
  "privacy.never": "Nie gespeichert",
  "privacy.neverKeys":
    "Schlüssel — sie bleiben im URL-Fragment (ausser du mailst den Link oder meldest den Inhalt)",
  "privacy.neverPlain": "Klartext, Dateinamen oder Vorschauen",
  "privacy.neverAccounts": "Konten, Tracking oder Werbe-Cookies",
  "privacy.neverEmail":
    "Empfängeradressen — E-Mail geht an SMTP und wird nicht gespeichert",
  "privacy.sovereign": "Souverän",
  "privacy.sovZurich": "App und Object Storage in Zürich",
  "privacy.sovNoAnalytics": "Kein Tracking, keine Tracker, keine Werbenetze",
  "privacy.switzerland": "Schweiz",
  "privacy.swissBody":
    "Anwendung und Object Storage laufen in Zürich. Kein Tracking und keine Replikation des Ciphertexts in Drittstaaten. Die Zustellung geht trotzdem an den Browser des Empfängers. Das Mailen eines Links nutzt SMTP, getrennt von diesem Hosting.",
  "privacy.imprint": "Impressum",
  "privacy.source": "Der Quellcode ist öffentlich — prüfen oder selbst betreiben.",
  "privacy.send": "Geheimnis senden",

  "editor.placeholder": "Nachricht schreiben oder Datei ablegen…",
  "editor.bold": "Fett  (⌘/Ctrl+B)",
  "editor.italic": "Kursiv  (⌘/Ctrl+I)",
  "editor.code": "Inline-Code",
  "editor.link": "Link",
  "editor.linkPrompt": "Link-URL (https://…)",
  "editor.h1": "Überschrift 1",
  "editor.h2": "Überschrift 2",
  "editor.bullet": "Aufzählung",
  "editor.ordered": "Nummerierte Liste",
  "editor.quote": "Zitat",
  "editor.hr": "Trennlinie",
  "editor.undo": "Rückgängig  (⌘/Ctrl+Z)",
  "editor.redo": "Wiederholen  (⌘/Ctrl+Y)",
  "editor.formatting": "Formatierung",
} as const;

export type MessageKey = keyof typeof de;

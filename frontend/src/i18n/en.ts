import type { MessageKey } from "./de";

export const en: Record<MessageKey, string> = {
  "nav.send": "Send",
  "nav.how": "How it works",
  "nav.privacy": "Privacy",
  "nav.primary": "Primary",

  "hero.title": "Send a secret. It reads once, then it’s gone.",
  "hero.lead":
    "Encrypted on your device. The key stays in the link — never on the server.",

  "footer.hosted": "No analytics · hosted in Switzerland",
  "footer.source": "Source code",
  "footer.madeIn": "Made with love in Lucerne by",

  "theme.toggle": "Toggle theme",
  "theme.toDark": "Switch to dark theme",
  "theme.toLight": "Switch to light theme",

  "seo.homeTitle": "Tresorpost — quantum-safe file transfer that forgets itself",
  "seo.homeDesc":
    "Quantum-safe, end-to-end encrypted transfer for text, images, video and files. 256-bit encryption in your browser, hosted in Switzerland, no accounts and no analytics.",
  "seo.faqTitle": "How it works — Tresorpost",
  "seo.faqDesc":
    "How Tresorpost encrypts secrets in the browser, keeps the key in the link, and deletes ciphertext after reading. Hosted in Switzerland, no analytics.",
  "seo.privacyTitle": "Privacy — Tresorpost",
  "seo.privacyDesc":
    "Tresorpost stores only ciphertext. No keys, no accounts, no analytics. App and object storage run in Zurich, Switzerland.",
  "seo.noindexTitle": "Tresorpost — encrypted transfer",

  "create.placeholder": "Write a message, or drop a file here (up to {cap})…",
  "create.ariaWrite": "Write a message",
  "create.attach": "Attach a file",
  "create.attachAria": "Attach a file, up to {cap}",
  "create.upTo": "up to {cap}",
  "create.replace": "Replace file",
  "create.sentAsText": "Sent as text",
  "create.sentAs": "Sent as {kind}",
  "create.kindImage": "Image",
  "create.kindVideo": "Video",
  "create.kindFile": "File",
  "create.encryptedInBrowser": "encrypted in your browser",
  "create.removeFile": "Remove file",
  "create.oneThing":
    "One note holds one thing. Go back and delete your text, or it will be lost.",
  "create.selfDestruct": "Self-destruct after",
  "create.options": "Options",
  "create.optDefaults": "Defaults",
  "create.optMax1": "max 1 open",
  "create.optMaxN": "max {n} opens",
  "create.optDeleteLink": "delete link",
  "create.optRecipientDelete": "recipient can delete",
  "create.limitOpens": "Limit number of opens",
  "create.keepDeleteLink": "Keep a private delete link",
  "create.recipientDelete": "Recipient can delete it",
  "create.createError": "Could not create the link",
  "create.encrypting": "Encrypting…",
  "create.uploading": "Uploading…",
  "create.createLink": "Create encrypted link",
  "create.cancel": "Cancel",
  "create.writeFirst": "Write something before creating a link.",
  "create.chooseFile": "Choose a file first.",
  "create.tooLarge": "File is too large ({size}). Max is {cap}.",
  "create.networkFail":
    "Could not reach the server. If this is a large image, the reverse proxy may be rejecting the body — configure S3 or raise client_max_body_size.",
  "create.progress": "Encrypting & uploading: {done} / {total} ({pct}%)",
  "create.expiry5min": "5 min",
  "create.expiry1hour": "1 hour",
  "create.expiry1day": "1 day",
  "create.expiry7days": "7 days",

  "share.kicker": "Share",
  "share.title": "Your encrypted link is ready",
  "share.lead":
    "Send it any way you like — or let them scan the code. The quantum-safe 256-bit key lives only after the # and never reaches the server.",
  "share.qrAlt": "QR code for the encrypted link",
  "share.scan": "Scan to open",
  "share.copy": "Copy",
  "share.copied": "Copied",
  "share.open": "Open",
  "share.emailKicker": "Email this link",
  "share.send": "Send",
  "share.sending": "Sending…",
  "share.sent": "Sent.",
  "share.deleteKicker": "Delete this note",
  "share.deleteLead":
    "Keep this private — it destroys the ciphertext before anyone opens it.",
  "share.delete": "Delete",
  "share.another": "Create another",

  "view.decrypting": "Decrypting…",
  "view.nothingTitle": "Nothing here",
  "view.nothingBody":
    "It was opened, deleted, or it expired. Encrypted notes are removed from the server for good — there is no copy and no way to recover it.",
  "view.createOwn": "Create your own note",
  "view.destroyedTitle": "Note destroyed",
  "view.destroyedBody":
    "The ciphertext has been wiped from the server. Anyone opening the link from now on will see nothing.",
  "view.createAnother": "Create another note",
  "view.couldNotOpen": "Could not open",
  "view.error": "Error",
  "view.goHome": "Go home",
  "view.goneOpens": "No more opens — destroyed after this view",
  "view.moreOpens1": "1 more open",
  "view.moreOpensN": "{n} more opens",
  "view.decryptFailed":
    "Decryption failed. The link may be corrupted or the key is wrong.",
  "view.streamFail":
    "This browser cannot stream {size} to disk. Open the link in Chrome or Edge (which support streaming saves) to download files this large.",
  "view.tooLargeOpen":
    "This file is {size} — too large to open in the browser. Download it instead.",
  "view.download": "Download",
  "view.decryptedLocal": "Decrypted locally",
  "view.decryptedInBrowser": "decrypted in your browser",
  "view.readyPlay": "Ready to play",
  "view.downloaded": "Downloaded",
  "view.decryptingDl": "Decrypting & downloading",
  "view.decryptView": "Decrypt & view",
  "view.decryptPlay": "Decrypt & play",
  "view.downloadVideo": "Download video",
  "view.downloadImage": "Download image",
  "view.decryptDownload": "Decrypt & download",
  "view.more": "More",
  "view.report": "Report",
  "view.reported": "Reported",
  "view.reportTitle": "Report this content?",
  "view.reportBody":
    "This sends the link — including the decryption key — to the site administrators. They will be able to open and view the file or note. Only report abuse you want them to see.",
  "view.reportMsg": "Message (optional)",
  "view.reportWhy": "Why are you reporting this?",
  "view.sendAdmins": "Send to administrators",
  "view.deleteForever": "Permanently delete this?",
  "view.deleteForeverBody":
    "Anyone else with the link will not be able to open it. This cannot be undone.",
  "view.deleting": "Deleting…",
  "view.videoFail":
    "This browser cannot decode this video (common for AVI and some MOV). Download the file and open it in a player.",
  "view.selfDestructs": "Self-destructs",
  "view.badge": "Decrypted locally",
  "copy.code": "Copy",
  "copy.copied": "Copied",

  "delete.title": "Destroy this note now?",
  "delete.body":
    "This cannot be undone. Recipients will no longer be able to open the share link.",
  "delete.yes": "Yes, delete it",
  "delete.destroyedTitle": "Note destroyed",
  "delete.destroyedBody":
    "Ciphertext has been removed from the server. Anyone with the share link will see that it is no longer available.",
  "delete.cancel": "Cancel",

  "faq.title": "How it works",
  "faq.lead": "Three steps, no account, nothing readable ever leaves your device.",
  "faq.step1t": "You write, your browser encrypts",
  "faq.step1b":
    "A random 256-bit key is generated on your device and never sent anywhere. The server only ever receives ciphertext.",
  "faq.step2t": "The key travels in the link",
  "faq.step2b":
    "Everything after the # stays in the browser — it is never part of the request. Send the link over any channel you already trust.",
  "faq.step3t": "It opens once, then disappears",
  "faq.step3b":
    "After the last allowed open, or when the timer runs out, the ciphertext is deleted. Nothing is archived.",
  "faq.send": "Send a secret",
  "faq.sizeQ": "How large can a file be? Can I send images and video?",
  "faq.sizeA":
    "Text, images, video and generic files are supported, up to {cap} per file. Text notes have no practical size limit.",

  "privacy.title": "Privacy",
  "privacy.lead":
    "Short version: the server holds ciphertext it cannot read, and forgets it on schedule. Swiss storage, no analytics.",
  "privacy.stored": "Stored on the server",
  "privacy.storedPayload": "The encrypted payload",
  "privacy.storedExpiry": "Expiry time and remaining opens",
  "privacy.never": "Never stored",
  "privacy.neverKeys":
    "Encryption keys — they stay in the URL fragment (unless you email the link or report the content)",
  "privacy.neverPlain": "Plaintext, filenames or previews",
  "privacy.neverAccounts": "Accounts, analytics or advertising cookies",
  "privacy.neverEmail":
    "Recipient addresses — email is handed to SMTP and not stored",
  "privacy.sovereign": "Sovereign",
  "privacy.sovZurich": "App and object storage in Zurich",
  "privacy.sovNoAnalytics": "No analytics, trackers or ad networks",
  "privacy.switzerland": "Switzerland",
  "privacy.swissBody":
    "The application and object storage run in Zurich. There is no analytics and no third-country replica of ciphertext. Delivering a note still sends it to the recipient's browser. Emailing a share link uses SMTP, which is separate from this hosting.",
  "privacy.imprint": "Imprint",
  "privacy.source": "The source code is public — audit it, or run your own instance.",
  "privacy.send": "Send a secret",

  "editor.placeholder": "Write a message, or drop a file here…",
  "editor.bold": "Bold  (⌘/Ctrl+B)",
  "editor.italic": "Italic  (⌘/Ctrl+I)",
  "editor.code": "Inline code",
  "editor.link": "Link",
  "editor.linkPrompt": "Link URL (https://…)",
  "editor.h1": "Heading 1",
  "editor.h2": "Heading 2",
  "editor.bullet": "Bullet list",
  "editor.ordered": "Numbered list",
  "editor.quote": "Quote",
  "editor.hr": "Divider",
  "editor.undo": "Undo  (⌘/Ctrl+Z)",
  "editor.redo": "Redo  (⌘/Ctrl+Y)",
  "editor.formatting": "Formatting",
};

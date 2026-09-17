import type { MessageKey } from "./de";

export const uk: Record<MessageKey, string> = {
  "nav.send": "Надіслати",
  "nav.how": "Як це працює",
  "nav.privacy": "Приватність",
  "nav.primary": "Основна навігація",

  "hero.title": "Надішли секрет. Прочитають раз — і його вже немає.",
  "hero.lead":
    "Шифрується на твоєму пристрої. Ключ лишається в посиланні — ніколи на сервері.",

  "footer.hosted": "Без аналітики · хостинг у Швейцарії",
  "footer.source": "Код",
  "footer.madeIn": "З любов’ю в Люцерні від",

  "theme.toggle": "Змінити тему",
  "theme.toDark": "Темна тема",
  "theme.toLight": "Світла тема",

  "seo.homeTitle": "Tresorpost — квантовостійка передача файлів, яка забуває себе",
  "seo.homeDesc":
    "Квантовостійка наскрізна передача тексту, зображень, відео та файлів. 256-бітне шифрування в браузері, хостинг у Швейцарії, без акаунтів і без аналітики.",
  "seo.faqTitle": "Як це працює — Tresorpost",
  "seo.faqDesc":
    "Як Tresorpost шифрує секрети в браузері, тримає ключ у посиланні й видаляє шифротекст після прочитання. Хостинг у Швейцарії, без аналітики.",
  "seo.privacyTitle": "Приватність — Tresorpost",
  "seo.privacyDesc":
    "Tresorpost зберігає лише шифротекст. Без ключів, акаунтів і аналітики. Додаток і сховище в Цюриху, Швейцарія.",
  "seo.noindexTitle": "Tresorpost — зашифрована передача",

  "create.placeholder": "Напиши повідомлення або скинь файл (до {cap})…",
  "create.ariaWrite": "Написати повідомлення",
  "create.attach": "Прикріпити файл",
  "create.attachAria": "Прикріпити файл, до {cap}",
  "create.upTo": "до {cap}",
  "create.replace": "Замінити файл",
  "create.sentAsText": "Як текст",
  "create.sentAs": "Як {kind}",
  "create.kindImage": "Зображення",
  "create.kindVideo": "Відео",
  "create.kindFile": "Файл",
  "create.encryptedInBrowser": "зашифровано в браузері",
  "create.removeFile": "Прибрати файл",
  "create.oneThing":
    "Одна нотатка — одна річ. Видали текст, інакше він загубиться.",
  "create.selfDestruct": "Самознищення через",
  "create.options": "Параметри",
  "create.optDefaults": "Типово",
  "create.optMax1": "макс. 1 відкриття",
  "create.optMaxN": "макс. {n} відкриттів",
  "create.optDeleteLink": "посилання для видалення",
  "create.optRecipientDelete": "одержувач може видалити",
  "create.limitOpens": "Обмежити кількість відкриттів",
  "create.keepDeleteLink": "Залишити приватне посилання для видалення",
  "create.recipientDelete": "Одержувач може видалити",
  "create.createError": "Не вдалося створити посилання",
  "create.encrypting": "Шифрування…",
  "create.uploading": "Завантаження…",
  "create.createLink": "Створити зашифроване посилання",
  "create.cancel": "Скасувати",
  "create.writeFirst": "Напиши щось, перш ніж створювати посилання.",
  "create.chooseFile": "Спочатку вибери файл.",
  "create.tooLarge": "Файл завеликий ({size}). Максимум — {cap}.",
  "create.networkFail":
    "Сервер недоступний. Для великого зображення reverse-proxy може відхилити тіло — налаштуй S3 або збільш client_max_body_size.",
  "create.progress": "Шифрування й вивантаження: {done} / {total} ({pct}%)",
  "create.expiry5min": "5 хв",
  "create.expiry1hour": "1 година",
  "create.expiry1day": "1 день",
  "create.expiry7days": "7 днів",

  "share.kicker": "Поділитися",
  "share.title": "Зашифроване посилання готове",
  "share.lead":
    "Надішли як зручно — або хай просканують код. Квантовостійкий 256-бітний ключ лише після # і ніколи не потрапляє на сервер.",
  "share.qrAlt": "QR-код зашифрованого посилання",
  "share.scan": "Сканувати, щоб відкрити",
  "share.copy": "Копіювати",
  "share.copied": "Скопійовано",
  "share.open": "Відкрити",
  "share.emailKicker": "Надіслати посилання поштою",
  "share.send": "Надіслати",
  "share.sending": "Надсилання…",
  "share.sent": "Надіслано.",
  "share.deleteKicker": "Видалити цю нотатку",
  "share.deleteLead":
    "Тримай це приватно — знищує шифротекст до того, як хтось відкриє.",
  "share.delete": "Видалити",
  "share.another": "Створити ще",

  "view.decrypting": "Розшифрування…",
  "view.nothingTitle": "Тут нічого немає",
  "view.nothingBody":
    "Відкрили, видалили або сплив термін. Зашифровані нотатки остаточно зникають із сервера — копії немає.",
  "view.createOwn": "Створити свою нотатку",
  "view.destroyedTitle": "Нотатку знищено",
  "view.destroyedBody":
    "Шифротекст стерто із сервера. Хто відкриє посилання тепер, нічого не побачить.",
  "view.createAnother": "Створити ще одну",
  "view.createNew": "Створити новий секрет",
  "view.couldNotOpen": "Не вдалося відкрити",
  "view.error": "Помилка",
  "view.goHome": "На головну",
  "view.goneOpens": "Більше відкриттів немає — знищено після цього перегляду",
  "view.moreOpens1": "Ще 1 відкриття",
  "view.moreOpensN": "Ще {n} відкриттів",
  "view.decryptFailed":
    "Розшифрування не вдалося. Посилання пошкоджене або ключ неправильний.",
  "view.streamFail":
    "Цей браузер не може стримити {size} на диск. Відкрий посилання в Chrome або Edge.",
  "view.tooLargeOpen":
    "Файл {size} — завеликий, щоб відкрити в браузері. Завантаж його.",
  "view.download": "Завантажити",
  "view.decryptedLocal": "Розшифровано локально",
  "view.decryptedInBrowser": "розшифровано в браузері",
  "view.readyPlay": "Готово до відтворення",
  "view.downloaded": "Завантажено",
  "view.decryptingDl": "Розшифрування й завантаження",
  "view.decryptView": "Розшифрувати й переглянути",
  "view.decryptPlay": "Розшифрувати й відтворити",
  "view.downloadVideo": "Завантажити відео",
  "view.downloadImage": "Завантажити зображення",
  "view.decryptDownload": "Розшифрувати й завантажити",
  "view.more": "Більше",
  "view.report": "Поскаржитися",
  "view.reported": "Скаргу надіслано",
  "view.reportTitle": "Поскаржитися на цей вміст?",
  "view.reportBody":
    "Це надішле посилання — разом із ключем розшифрування — адміністраторам. Вони зможуть відкрити файл чи нотатку. Скаржся лише на те, що вони мають побачити.",
  "view.reportMsg": "Повідомлення (необов’язково)",
  "view.reportWhy": "Чому скаржишся?",
  "view.sendAdmins": "Надіслати адміністраторам",
  "view.deleteForever": "Видалити остаточно?",
  "view.deleteForeverBody":
    "Інші з посиланням більше не відкриють. Це незворотно.",
  "view.deleting": "Видалення…",
  "view.videoFail":
    "Цей браузер не декодує це відео (часто AVI та деякі MOV). Завантаж файл і відкрий у програвачі.",
  "view.selfDestructs": "Самознищення",
  "view.badge": "Розшифровано локально",
  "copy.code": "Копіювати",
  "copy.copied": "Скопійовано",

  "delete.title": "Знищити цю нотатку зараз?",
  "delete.body":
    "Це незворотно. Одержувачі більше не зможуть відкрити посилання.",
  "delete.yes": "Так, видалити",
  "delete.destroyedTitle": "Нотатку знищено",
  "delete.destroyedBody":
    "Шифротекст прибрано із сервера. Хто має посилання, побачить, що його вже немає.",
  "delete.cancel": "Скасувати",

  "faq.title": "Як це працює",
  "faq.lead": "Три кроки, без акаунта, нічого читабельного не покидає пристрій.",
  "faq.step1t": "Ти пишеш, браузер шифрує",
  "faq.step1b":
    "Випадковий 256-бітний ключ виникає на пристрої і нікуди не надсилається. Сервер отримує лише шифротекст.",
  "faq.step2t": "Ключ їде в посиланні",
  "faq.step2b":
    "Усе після # лишається в браузері — ніколи не в запиті. Надішли посилання будь-яким уже довіреним каналом.",
  "faq.step3t": "Відкривають раз — і зникає",
  "faq.step3b":
    "Після останнього дозволеного відкриття або коли спливе таймер, шифротекст видаляється. Архіву немає.",
  "faq.send": "Надіслати секрет",
  "faq.sizeQ": "Якого розміру може бути файл? Чи можна зображення й відео?",
  "faq.sizeA":
    "Текст, зображення, відео та файли — до {cap} на файл. Текстові нотатки практично без ліміту.",

  "privacy.title": "Приватність",
  "privacy.lead":
    "Коротко: сервер тримає шифротекст, якого не читає, і забуває за розкладом. Швейцарське сховище, без аналітики.",
  "privacy.stored": "На сервері",
  "privacy.storedPayload": "Зашифроване навантаження",
  "privacy.storedExpiry": "Час дії та залишкові відкриття",
  "privacy.never": "Ніколи не зберігається",
  "privacy.neverKeys":
    "Ключі — вони в фрагменті URL (якщо ти не надішлеш посилання поштою чи не поскаржишся)",
  "privacy.neverPlain": "Відкритий текст, імена файлів чи прев’ю",
  "privacy.neverAccounts": "Акаунти, аналітика чи рекламні cookie",
  "privacy.neverEmail":
    "Адреси одержувачів — пошта йде в SMTP і не зберігається",
  "privacy.sovereign": "Суверенно",
  "privacy.sovZurich": "Додаток і object storage у Цюриху",
  "privacy.sovNoAnalytics": "Без аналітики, трекерів і рекламних мереж",
  "privacy.switzerland": "Швейцарія",
  "privacy.swissBody":
    "Додаток і object storage працюють у Цюриху. Немає аналітики й реплік шифротексту в треті країни. Доставка все одно йде в браузер одержувача. Надсилання посилання поштою використовує SMTP, окремо від цього хостингу.",
  "privacy.imprint": "Вихідні дані",
  "privacy.source": "Код публічний — перевір або розгорни свій екземпляр.",
  "privacy.send": "Надіслати секрет",

  "editor.placeholder": "Напиши повідомлення або скинь файл…",
  "editor.bold": "Жирний  (⌘/Ctrl+B)",
  "editor.italic": "Курсив  (⌘/Ctrl+I)",
  "editor.code": "Код у рядку",
  "editor.link": "Посилання",
  "editor.linkPrompt": "URL посилання (https://…)",
  "editor.h1": "Заголовок 1",
  "editor.h2": "Заголовок 2",
  "editor.bullet": "Маркований список",
  "editor.ordered": "Нумерований список",
  "editor.quote": "Цитата",
  "editor.hr": "Роздільник",
  "editor.undo": "Скасувати  (⌘/Ctrl+Z)",
  "editor.redo": "Повторити  (⌘/Ctrl+Y)",
  "editor.formatting": "Форматування",
};

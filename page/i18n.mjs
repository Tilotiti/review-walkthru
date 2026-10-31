// Page texts in French and English, picked from the browser language.

export const STRINGS = {
  fr: {
    next: 'Étape suivante',
    prev: 'Étape précédente',
    comment: 'Commenter',
    send: 'Envoyer à Claude',
    finish: 'Terminer la recette',
    sent: "Review envoyée. Claude te répond dans Claude Code. S'il lance un nouveau tour, il s'affichera dans cet onglet.",
    finished: 'Recette terminée. La suite se passe dans Claude Code.',
    reopen: 'Revoir quand même',
    inferred: 'déduit du diff',
    yourComments: "Commentaires sur l'étape",
    nextStep: 'Étape suivante : {title}',
    why: 'Pourquoi cette étape',
    startAt: 'Point de départ',
    skipped: 'Étapes sautées',
    accounts: 'Comptes de test',
    relayDown: 'Le relais ne répond pas. Nouvel essai dans 3 s.',
    gateInstallTitle: "L'extension Review Walkthru n'est pas active dans ce profil Chrome",
    gateInstallBody: 'Installe-la depuis le Chrome Web Store, puis recharge cette page.',
    gateInstallLink: 'Ouvrir la fiche du Chrome Web Store',
    gateUpdateTitle: "Mets à jour l'extension Review Walkthru",
    gateUpdateBody: 'Ouvre chrome://extensions, active le mode développeur et clique sur Mettre à jour, puis recharge cette page.',
    reload: 'Recharger',
    commentInApp: "Commenter dans l'app",
    shortcutHint: "{key} dans l'app : commenter un élément ou une zone",
    noCapture: "Sans capture : appuie une fois sur {key} dans l'app pour en joindre une.",
    captureFailed: "La capture n'a pas pu être enregistrée : le commentaire part sans elle.",
    zoneLabel: 'Zone {w} × {h}',
    quoted: '« {text} »',
    detected: 'Écran suivant détecté : {title}',
    shortcutInReview: "Clique d'abord dans l'app, puis appuie sur {key}.",
    grantBanner: "Autorise Review Walkthru sur {origin} pour commenter l'app et voir sa console.",
    grantButton: 'Autoriser',
    altShortcut: 'Alt+Maj+C',
    docTitle: 'Recette · PR #{n}',
    endOfRound: 'Fin du tour',
    stepOf: 'Étape {n}/{total}',
    judge: 'À juger',
    then: 'Ensuite',
    colon: ' : ', // French puts a space before the colon
    roundChanged: 'Claude a mis à jour la recette pendant ta review. La page a gardé tes cases et tes commentaires encore valables : vérifie les nouveaux points, puis renvoie.',
    validatedBefore: 'validé au tour {n}',
    add: 'Ajouter',
    cancel: 'Annuler',
    remove: 'Retirer',
    copy: 'Copier',
    dismiss: 'Fermer',
    placeholder: 'Ton commentaire',
    shortcut: '⌘↵ ou Ctrl+↵ pour ajouter',
    openInApp: "Ouvrir dans l'app",
    noScreen: "Pas d'écran : vérifie-le avec les points ci-dessous.",
    ifWrong: "Si c'est faux :",
    tagDecision: 'Décision',
    tagDoubt: 'Doute',
    tagPoint: 'Point',
    tagStep: 'Étape',
    statusValidated: 'Validée',
    statusCommented: 'Commentée',
    statusNotReached: 'Pas vue',
    goTo: 'Revoir',
    rejected: 'Le relais a refusé la review :',
    sending: 'Envoi…',
    login: 'Identifiant',
    password: 'Mot de passe'
  },
  en: {
    next: 'Next step',
    prev: 'Previous step',
    comment: 'Comment',
    send: 'Send to Claude',
    finish: 'Finish the review',
    sent: 'Review sent. Claude replies in Claude Code. If it starts a new round, it will show up in this tab.',
    finished: 'Review finished. Carry on in Claude Code.',
    reopen: 'Review it anyway',
    inferred: 'inferred from the diff',
    yourComments: 'Comments on this step',
    nextStep: 'Next step: {title}',
    why: 'Why this step',
    startAt: 'Start at',
    skipped: 'Skipped steps',
    accounts: 'Test accounts',
    relayDown: 'The relay is not answering. Retrying in 3 s.',
    gateInstallTitle: 'The Review Walkthru extension is not active in this Chrome profile',
    gateInstallBody: 'Install it from the Chrome Web Store, then reload this page.',
    gateInstallLink: 'Open the Chrome Web Store page',
    gateUpdateTitle: 'Update the Review Walkthru extension',
    gateUpdateBody: 'Open chrome://extensions, turn on Developer mode and click Update, then reload this page.',
    reload: 'Reload',
    commentInApp: 'Comment in the app',
    shortcutHint: '{key} in the app: comment on an element or an area',
    noCapture: 'No capture: press {key} once in the app to attach one.',
    captureFailed: 'The capture could not be saved: the comment goes without it.',
    zoneLabel: 'Area {w} × {h}',
    quoted: '“{text}”',
    detected: 'Next screen detected: {title}',
    shortcutInReview: 'Click in the app first, then press {key}.',
    grantBanner: 'Allow Review Walkthru on {origin} to comment on the app and see its console.',
    grantButton: 'Allow',
    altShortcut: 'Alt+Shift+C',
    docTitle: 'Review · PR #{n}',
    endOfRound: 'End of round',
    stepOf: 'Step {n}/{total}',
    judge: 'To judge',
    then: 'Then',
    colon: ': ',
    roundChanged: 'Claude updated the review while you were on it. The page kept the boxes and comments that still apply: check the new points, then send again.',
    validatedBefore: 'validated in round {n}',
    add: 'Add',
    cancel: 'Cancel',
    remove: 'Remove',
    copy: 'Copy',
    dismiss: 'Close',
    placeholder: 'Your comment',
    shortcut: '⌘↵ or Ctrl+↵ to add',
    openInApp: 'Open in the app',
    noScreen: 'No screen: check it with the points below.',
    ifWrong: 'If wrong:',
    tagDecision: 'Decision',
    tagDoubt: 'Doubt',
    tagPoint: 'Point',
    tagStep: 'Step',
    statusValidated: 'Validated',
    statusCommented: 'Commented',
    statusNotReached: 'Not seen',
    goTo: 'Go back',
    rejected: 'The relay refused the review:',
    sending: 'Sending…',
    login: 'Login',
    password: 'Password'
  }
}

export function pickLang (languages) {
  for (const tag of languages) {
    const base = String(tag).toLowerCase().split('-')[0]
    if (base in STRINGS) return base
  }
  return 'en'
}

export function t (lang, key, vars = {}) {
  const text = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key
  return text.replace(/\{(\w+)\}/g, (match, name) => name in vars ? String(vars[name]) : match)
}

// French uses the singular for 0 and 1, English only for 1.
export function counterText (lang, comments, pointsLeft) {
  const one = n => lang === 'fr' ? n <= 1 : n === 1
  if (lang === 'fr') {
    return `${comments} commentaire${one(comments) ? '' : 's'} · ${pointsLeft} point${one(pointsLeft) ? '' : 's'} à voir`
  }
  return `${comments} comment${one(comments) ? '' : 's'} · ${pointsLeft} point${one(pointsLeft) ? '' : 's'} left`
}

// French: "1 point sur 2", "2 points sur 4". In English the total carries the plural.
export function pointsSeenText (lang, seen, total) {
  if (lang === 'fr') return `${seen} point${seen <= 1 ? '' : 's'} sur ${total}`
  return `${seen} of ${total} point${total === 1 ? '' : 's'}`
}

// French uses the singular for 0 and 1, English only for 1.
const many = (lang, n) => lang === 'fr' ? n > 1 : n !== 1
const count = (lang, n, fr, en) => `${n} ${lang === 'fr' ? fr[many(lang, n) ? 1 : 0] : en[many(lang, n) ? 1 : 0]}`

// "2 erreurs · 1 avertissement · 1 requête en échec": the parts that are not zero.
export function issuesText (lang, { errors, warnings, requests }) {
  return [
    errors && count(lang, errors, ['erreur', 'erreurs'], ['error', 'errors']),
    warnings && count(lang, warnings, ['avertissement', 'avertissements'], ['warning', 'warnings']),
    requests && count(lang, requests, ['requête en échec', 'requêtes en échec'], ['failed request', 'failed requests'])
  ].filter(Boolean).join(' · ')
}

export const prefillLabel = (lang, n) => lang === 'fr'
  ? `Pré-remplir le formulaire (${count(lang, n, ['champ', 'champs'], [])})`
  : `Prefill the form (${count(lang, n, [], ['field', 'fields'])})`

// problems: selectors of the fields left empty (not found, not supported, or an account missing).
export function prefillText (lang, filled, problems) {
  const done = lang === 'fr' ? `${count(lang, filled, ['champ rempli', 'champs remplis'], [])}.` : `${count(lang, filled, [], ['field filled', 'fields filled'])}.`
  if (!problems.length) return done
  return lang === 'fr' ? `${done} Non remplis : ${problems.join(', ')}.` : `${done} Not filled: ${problems.join(', ')}.`
}

export function endIssuesText (lang, n) {
  return lang === 'fr'
    ? `${count(lang, n, ['erreur ou requête en échec', 'erreurs ou requêtes en échec'], [])} pendant ce tour : Claude ${many(lang, n) ? 'les' : 'la'} verra.`
    : `${count(lang, n, [], ['error or failed request', 'errors or failed requests'])} during this round: Claude will see ${many(lang, n) ? 'them' : 'it'}.`
}
